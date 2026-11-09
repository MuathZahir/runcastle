import { appendThreadEvent, readThreadEvents } from './log'
import { givenNames } from './naming'

/**
 * An epic's name (orchestrator-chats-become-epics decisions 12, 13): the name an
 * Orchestrator chat gives itself, a `title` event marked `by: 'orchestrator'`.
 * It outranks every name but the human's rename (`naming.ts`), which it never
 * overwrites. The 1–3 word style is the project skill's; the server only caps
 * the length.
 */

/** The longest name an epic may take. */
export const EPIC_NAME_MAX = 40

/** What naming an epic did: named it, or left the human's name alone. */
export type EpicNamed = { named: true; name: string } | { named: false; humanName: string }

/**
 * Name `threadId`'s chat `name` (already checked), unless the human renamed it.
 * The append publishes the thread's live signal, so the list reads it again.
 */
export function writeEpicName(threadId: string, name: string): EpicNamed {
  const { renamed } = givenNames(readThreadEvents(threadId))
  if (renamed !== undefined) return { named: false, humanName: renamed }
  appendThreadEvent(threadId, { type: 'title', title: name, by: 'orchestrator' })
  return { named: true, name }
}
