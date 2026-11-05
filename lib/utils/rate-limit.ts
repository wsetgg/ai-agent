import { db } from '@/lib/db/client'
import { tasks, taskMessages } from '@/lib/db/schema'
import { eq, gte, and, isNull, notInArray } from 'drizzle-orm'
import { getMaxMessagesPerDay } from '@/lib/db/settings'

export async function checkRateLimit(
  userId: string,
): Promise<{ allowed: boolean; remaining: number; total: number; resetAt: Date }> {
  // Get max messages per day for this user (user-specific > global > env var)
  const maxMessagesPerDay = await getMaxMessagesPerDay(userId)

  // Get start of today (UTC)
  const today = new Date()
  today.setUTCHours(0, 0, 0, 0)

  // Get end of today (UTC)
  const tomorrow = new Date(today)
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1)

  // Count each user request once. The opening prompt is also saved as a task
  // message, so counting tasks separately double-counts every new task.
  // Failed or stopped runs should not consume the daily allowance.
  const userMessagesToday = await db
    .select({ id: taskMessages.id })
    .from(taskMessages)
    .innerJoin(tasks, eq(taskMessages.taskId, tasks.id))
    .where(
      and(
        eq(tasks.userId, userId),
        eq(taskMessages.role, 'user'),
        gte(taskMessages.createdAt, today),
        isNull(tasks.deletedAt),
        notInArray(tasks.status, ['error', 'stopped']),
      ),
    )

  const count = userMessagesToday.length
  const remaining = Math.max(0, maxMessagesPerDay - count)
  const allowed = count < maxMessagesPerDay

  return {
    allowed,
    remaining,
    total: maxMessagesPerDay,
    resetAt: tomorrow,
  }
}
