import { generateText } from 'ai'
import { customAlphabet } from 'nanoid'

export interface BranchNameOptions {
  description: string
  repoName?: string
  context?: string
}

export async function generateBranchName(options: BranchNameOptions): Promise<string> {
  const { description } = options
  // Branch names are metadata, not an AI task. Generate them locally so task
  // creation never depends on a separately billed Vercel AI Gateway account.
  const normalized = description
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32)
  const prefix = /\b(fix|bug|error|crash|broken)\b/i.test(description) ? 'fix'
    : /\b(docs|documentation|readme)\b/i.test(description) ? 'docs'
    : /\b(refactor|cleanup|clean up)\b/i.test(description) ? 'chore'
    : 'feature'
  const base = normalized || 'task'
  return `${prefix}/${base}`.slice(0, 49)
}
export function createFallbackBranchName(taskId: string): string {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5)
  return `agent/${timestamp}-${taskId.slice(0, 8)}`
}
