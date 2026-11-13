import type { SessionRow } from '@runcastle/core'
import type { AppCtx } from '../db/types'
import { getSessionRow } from '../launcher/sessions'
import { hasThreadLog, readThreadEvents } from './log'
import { threadName } from './naming'

/** The name the thread list shows for a thread: an epic's name for an orchestrator chat. */
export function chatName(row: SessionRow): string {
  return threadName(row, hasThreadLog(row.id) ? readThreadEvents(row.id) : [])
}

/** The name of the thread with this id, for a refusal or a line; the id itself when there is no such thread. */
export function chatNameOf(ctx: AppCtx, threadId: string): string {
  const row = getSessionRow(ctx, threadId)
  return row ? chatName(row) : threadId
}
