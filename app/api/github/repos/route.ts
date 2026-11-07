import { NextRequest, NextResponse } from 'next/server'
import { getUserGitHubToken } from '@/lib/github/user-token'

interface GitHubRepo {
  name: string
  full_name: string
  description?: string
  private: boolean
  clone_url: string
  updated_at: string
  language?: string
  owner: {
    login: string
  }
}

function formatRepo(repo: GitHubRepo) {
  return {
    name: repo.name,
    full_name: repo.full_name,
    description: repo.description,
    private: repo.private,
    clone_url: repo.clone_url,
    updated_at: repo.updated_at,
    language: repo.language,
  }
}

export async function GET(request: NextRequest) {
  try {
    const token = await getUserGitHubToken(request)

    if (!token) {
      return NextResponse.json({ error: 'GitHub not connected' }, { status: 401 })
    }

    const owner = new URL(request.url).searchParams.get('owner')?.trim()

    if (!owner) {
      return NextResponse.json({ error: 'Owner parameter is required' }, { status: 400 })
    }

    const headers = {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github.v3+json',
    }

    const perPage = 100

    // First query the repositories this token can actually access. GitHub's
    // /user/repos endpoint includes owned, collaborator, and organization-member
    // repositories; filtering by owner preserves private collaborator access.
    const accessibleRepos: GitHubRepo[] = []
    let page = 1

    while (true) {
      const response = await fetch(
        `https://api.github.com/user/repos?sort=name&direction=asc&per_page=${perPage}&page=${page}&visibility=all&affiliation=owner,collaborator,organization_member`,
        { headers },
      )

      if (!response.ok) {
        const status = response.status === 401 ? 401 : response.status === 403 ? 403 : 502
        return NextResponse.json(
          {
            error:
              status === 401
                ? 'GitHub authorization has expired. Reconnect your GitHub account to continue.'
                : status === 403
                  ? 'GitHub denied access. Reconnect your account or check repository permissions.'
                  : 'Unable to list repositories available to your GitHub account.',
            reconnectRequired: status === 401 || status === 403,
          },
          { status },
        )
      }

      const repos: GitHubRepo[] = await response.json()
      accessibleRepos.push(
        ...repos.filter((repo) => repo.owner.login.toLowerCase() === owner.toLowerCase()),
      )

      if (repos.length < perPage) {
        break
      }

      page += 1
    }

    if (accessibleRepos.length > 0) {
      const uniqueRepos = accessibleRepos.filter(
        (repo, index, self) => index === self.findIndex((item) => item.full_name === repo.full_name),
      )
      uniqueRepos.sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()))
      return NextResponse.json(uniqueRepos.map(formatRepo))
    }

    // Preserve the previous ability to browse public repositories owned by
    // someone else when the current user has no direct affiliation with them.
    const orgResponse = await fetch(`https://api.github.com/orgs/${encodeURIComponent(owner)}`, { headers })
    const isOrganization = orgResponse.ok
    const publicRepos: GitHubRepo[] = []
    page = 1

    while (true) {
      const endpoint = isOrganization
        ? `https://api.github.com/orgs/${encodeURIComponent(owner)}/repos?sort=name&direction=asc&per_page=${perPage}&page=${page}`
        : `https://api.github.com/users/${encodeURIComponent(owner)}/repos?sort=name&direction=asc&per_page=${perPage}&page=${page}`

      const response = await fetch(endpoint, { headers })

      if (!response.ok) {
        if (response.status === 404) {
          return NextResponse.json([])
        }
        const status = response.status === 401 ? 401 : response.status === 403 ? 403 : 502
        return NextResponse.json(
          {
            error:
              status === 401
                ? 'GitHub authorization has expired. Reconnect your GitHub account to continue.'
                : status === 403
                  ? 'GitHub denied access. Reconnect your account or check repository permissions.'
                  : 'Unable to fetch repositories for this owner.',
            reconnectRequired: status === 401 || status === 403,
          },
          { status },
        )
      }

      const repos: GitHubRepo[] = await response.json()
      publicRepos.push(...repos)

      if (repos.length < perPage) {
        break
      }

      page += 1
    }

    const uniqueRepos = publicRepos.filter(
      (repo, index, self) => index === self.findIndex((item) => item.full_name === repo.full_name),
    )
    uniqueRepos.sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()))

    return NextResponse.json(uniqueRepos.map(formatRepo))
  } catch (error) {
    console.error('Error fetching GitHub repositories:', error)
    return NextResponse.json({ error: 'Failed to fetch repositories' }, { status: 500 })
  }
}
