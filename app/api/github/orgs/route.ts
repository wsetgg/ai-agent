import { NextRequest, NextResponse } from 'next/server'
import { getUserGitHubToken } from '@/lib/github/user-token'

export async function GET(req: NextRequest) {
  try {
    const token = await getUserGitHubToken(req)

    if (!token) {
      return NextResponse.json({ error: 'GitHub not connected' }, { status: 401 })
    }

    const response = await fetch('https://api.github.com/user/orgs', {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github.v3+json',
      },
    })

    if (!response.ok) {
      const status = response.status === 401 ? 401 : response.status === 403 ? 403 : 502
      return NextResponse.json(
        {
          error:
            status === 401
              ? 'GitHub authorization has expired. Reconnect your GitHub account to continue.'
              : status === 403
                ? 'GitHub denied access. Reconnect your account or check its permissions.'
                : 'Unable to fetch GitHub organizations.',
          reconnectRequired: status === 401 || status === 403,
        },
        { status },
      )
    }

    const orgs = await response.json()

    interface GitHubOrg {
      login: string
      name?: string
      avatar_url: string
    }

    return NextResponse.json(
      (orgs as GitHubOrg[]).map((org) => ({
        login: org.login,
        name: org.name || org.login,
        avatar_url: org.avatar_url,
      })),
    )
  } catch (error) {
    console.error('Error fetching GitHub organizations:', error)
    return NextResponse.json({ error: 'Failed to fetch organizations' }, { status: 500 })
  }
}
