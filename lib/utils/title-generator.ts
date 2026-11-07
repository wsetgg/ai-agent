export interface TitleGenerationOptions {
  prompt: string
  repoName?: string
  context?: string
}

/**
 * Task titles are lightweight metadata. Keep generation local so creating a
 * task never depends on Vercel AI Gateway credits or a second AI provider.
 */
export async function generateTaskTitle(options: TitleGenerationOptions): Promise<string> {
  return createFallbackTitle(options.prompt)
}

export function createFallbackTitle(prompt: string): string {
  const cleaned = prompt.replace(/\s+/g, ' ').trim()
  if (cleaned.length <= 60) return cleaned
  const sentenceEnd = cleaned.search(/[.!?]\s/)
  if (sentenceEnd > 0 && sentenceEnd <= 57) return cleaned.slice(0, sentenceEnd + 1)
  return cleaned.slice(0, 57).trimEnd() + '...'
}
