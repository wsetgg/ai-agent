import { NextResponse } from 'next/server'
import { getServerSession } from '@/lib/session/get-server-session'

export const runtime = 'nodejs'
export const maxDuration = 30

export async function POST() {
  const session = await getServerSession()
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const apiKey = process.env.NVIDIA_API_KEY
  if (!apiKey) {
    return NextResponse.json({ error: 'NVIDIA_API_KEY is not configured in this deployment' }, { status: 503 })
  }

  const startedAt = Date.now()
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 20000)

  try {
    const response = await fetch('https://integrate.api.nvidia.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'minimaxai/minimax-m3.1-flash',
        messages: [{ role: 'user', content: 'Reply OK' }],
        max_tokens: 10,
        stream: false,
      }),
      signal: controller.signal,
      cache: 'no-store',
    })

    const data = await response.json().catch(() => null)
    if (!response.ok) {
      const providerMessage =
        typeof data?.error?.message === 'string'
          ? data.error.message.slice(0, 500)
          : 'NVIDIA returned a non-success response'
      return NextResponse.json(
        { success: false, providerStatus: response.status, message: providerMessage, latencyMs: Date.now() - startedAt },
        { status: 502 },
      )
    }

    const reply = data?.choices?.[0]?.message?.content
    return NextResponse.json({
      success: typeof reply === 'string',
      providerStatus: response.status,
      model: data?.model ?? 'minimaxai/minimax-m3.1-flash',
      reply: typeof reply === 'string' ? reply.slice(0, 200) : null,
      latencyMs: Date.now() - startedAt,
      usage: data?.usage
        ? { promptTokens: data.usage.prompt_tokens, completionTokens: data.usage.completion_tokens, totalTokens: data.usage.total_tokens }
        : null,
    })
  } catch (error) {
    const timedOut = error instanceof Error && error.name === 'AbortError'
    return NextResponse.json(
      { success: false, message: timedOut ? 'NVIDIA request timed out after 20 seconds' : 'NVIDIA request failed', latencyMs: Date.now() - startedAt },
      { status: 502 },
    )
  } finally {
    clearTimeout(timeout)
  }
}
