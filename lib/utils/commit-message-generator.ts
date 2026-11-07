import { generateText } from 'ai'

export interface CommitMessageOptions {
  description: string
  repoName?: string
  context?: string
}

export async function generateCommitMessage(options: CommitMessageOptions): Promise<string> {
  // Keep commit metadata deterministic and avoid requiring Vercel AI Gateway
  // billing for a feature that does not need a language model.
  return createFallbackCommitMessage(options.description)
}
export function createFallbackCommitMessage(description: string): string {
  // If description is short enough, use it as the commit message
  if (description.length <= 72) {
    return description
  }

  // Otherwise, truncate and add ellipsis
  return description.substring(0, 69) + '...'
}
