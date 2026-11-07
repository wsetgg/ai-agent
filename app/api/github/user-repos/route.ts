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

interface GitHubSearchResult {
  total_count: number
  incomplete_results: boolean
  items: GitHubRepo[]
}

export async function GET(request: NextRequest) {
  try {
    const token = await getUserGitHubToken(request)

    if (!token) {
      return NextResponse.json({ error: 'GitHub not connected' }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const page = parseInt(searchParams.get('page') || '1', 10)
    const perPage = parseInt(searchParams.get('per_page') || '25', 10)
    const search = searchParams.get('search') || ''

    // Get authenticated user
    const userResponse = await fetch('https://api.github.com/user', {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github.v3+json',
      },
    })

    if (!userResponse.ok) {
      return NextResponse.json({ error: 'Failed to fetch user' }, { status: 401 })
    }

    const user = await userResponse.json()
    const username = user.login

    // Search only repositories that this OAuth token can actually access.
    // GitHub's repository search endpoint cannot express collaborator access
    // cleanly, so filter the authenticated /user/repos listing instead.
    if (search.trim()) {
      const matchingRepos: GitHubRepo[] = []
      const normalizedSearch = search.trim().toLowerCase()
      let searchPage = 1

      while (true) {
        const searchUrl = `https://api.github.com/user/repos?sort=updated&direction=desc&per_page=100&page=${searchPage}&visibility=all&affiliation=owner,collaborator,organization_member`
        const searchResponse = await fetch(searchUrl, {
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: 'application/vnd.github.v3+json',
          },
        })

        if (!searchResponse.ok) {
          const status = searchResponse.status === 401 ? 401 : searchResponse.status === 403 ? 403 : 502
          return NextResponse.json(
            {
              error:
                status === 401
                  ? 'GitHub authorization has expired. Reconnect your GitHub account to continue.'
                  : status === 403
                    ? 'GitHub denied access. Reconnect your account or check repository permissions.'
                    : 'Unable to search repositories available to your GitHub account.',
              reconnectRequired: status === 401 || status === 403,
            },
            { status },
          )
        }

        const accessibleRepos: GitHubRepo[] = await searchResponse.json()
        matchingRepos.push(
          ...accessibleRepos.filter(
            (repo) =>
              repo.name.toLowerCase().includes(normalizedSearch) ||
              repo.full_name.toLowerCase().includes(normalizedSearch),
          ),
        )

        if (accessibleRepos.length < 100) {
          break
        }

        searchPage += 1
      }

      const offset = (page - 1) * perPage
      const slicedRepos = matchingRepos.slice(offset, offset + perPage)

      return NextResponse.json({
        repos: slicedRepos.map((repo) => ({
          name: repo.name,
          full_name: repo.full_name,
          owner: repo.owner.login,
          description: repo.description,
          private: repo.private,
          clone_url: repo.clone_url,
          updated_at: repo.updated_at,
          language: repo.language,
        })),
        page,
        per_page: perPage,
        has_more: matchingRepos.length > page * perPage,
        total_count: matchingRepos.length,
        username,
      })
    }

    // No search query - fetch repos sorted by updated_at (most recent first) for pagination
    // We use a larger page size and handle deduplication ourselves
    const githubPerPage = 100
    const githubPage = Math.ceil((page * perPage) / githubPerPage)

    // Fetch user's repos (owned repos, sorted by recently updated)
    const apiUrl = `https://api.github.com/user/repos?sort=updated&direction=desc&per_page=${githubPerPage}&page=${githubPage}&visibility=all&affiliation=owner,collaborator,organization_member`

    const response = await fetch(apiUrl, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github.v3+json',
      },
    })

    if (!response.ok) {
      throw new Error('Failed to fetch repositories')
    }

    const repos: GitHubRepo[] = await response.json()

    // Calculate the offset within the GitHub page
    const offsetInGithubPage = ((page - 1) * perPage) % githubPerPage
    const slicedRepos = repos.slice(offsetInGithubPage, offsetInGithubPage + perPage)

    // Check if there are more repos
    const hasMore = repos.length === githubPerPage || slicedRepos.length === perPage

    return NextResponse.json({
      repos: slicedRepos.map((repo) => ({
        name: repo.name,
        full_name: repo.full_name,
        owner: repo.owner.login,
        description: repo.description,
        private: repo.private,
        clone_url: repo.clone_url,
        updated_at: repo.updated_at,
        language: repo.language,
      })),
      page,
      per_page: perPage,
      has_more: hasMore,
      username,
    })
  } catch (error) {
    console.error('Error fetching user repositories:', error)
    return NextResponse.json({ error: 'Failed to fetch repositories' }, { status: 500 })
  }
}
