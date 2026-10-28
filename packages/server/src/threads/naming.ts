import { DEFAULT_RUNTIME, liveEvents, type SessionRow, type ThreadEvent } from '@runcastle/core'
import { selfPlanKickoffFor } from '../launcher/runtimes/skills'
import { deriveTitle } from '../services/conversations'

/**
 * What a thread is called (chat-as-web-components decision 14): by what it is
 * about, never by its kind, and never by runcastle's own words.
 *
 * Since decision 12 a thread's opening briefing rides in its first prompt, so a
 * title the runtime generated for that conversation summarises the briefing
 * ("Runcastle project skill session"). Such a title names nothing; the human's
 * first message names the thread instead.
 */

/** What a thread with nothing said in it yet is called. */
export const NEW_CHAT_NAME = 'New chat'

/**
 * Whether the runtime's generated title may name the thread: only when the
 * first prompt the agent got was the human's own, with no runcastle opening.
 * A command (Compact now) is no prompt of anyone's.
 */
export function runtimeMayName(events: readonly ThreadEvent[]): boolean {
  const first = liveEvents(events).find((e) => e.type === 'prompt' && !e.hidden)
  return first?.type === 'prompt' && first.source === 'human'
}

/** What the feature's main chat is called once a self-planning run in it is over, as the thread list's role names it. */
export const MAIN_CHAT_NAME = 'Feature chat'

/** A thread nobody has said anything in, named for what it is doing. */
function errandName(row: SessionRow, events: readonly ThreadEvent[]): string | null {
  if (row.purpose === 'self-plan') return 'Planning by itself'
  // The run is over (finished or stopped): the thread is the lead's chat again.
  const planned = selfPlanKickoffFor(row.runtime ?? DEFAULT_RUNTIME)
  if (row.kind === 'chat' && events.some((e) => e.type === 'prompt' && e.source === 'runcastle' && e.text.includes(planned))) return MAIN_CHAT_NAME
  if (row.kind === 'scenario') return row.purpose === 'scenario-setup' ? 'Scenario: setting scenarios up' : 'Scenario: writing scenarios'
  if (row.kind === 'drive-fix') return 'Fix: the test drive'
  if (events.some((e) => e.type === 'prompt' && e.source === 'runcastle' && !e.hidden)) return 'Working by itself'
  return null
}

/**
 * A logged thread's name: the human's rename, else the runtime's generated
 * title when {@link runtimeMayName}, else the human's first message cleaned
 * and shortened, else what it is doing, else {@link NEW_CHAT_NAME}.
 *
 * A row's title is the human's rename — except one that repeats a generated
 * title the runtime may not give, which an earlier host stored on the row.
 */
export function threadName(row: SessionRow, events: readonly ThreadEvent[]): string {
  const mayName = runtimeMayName(events)
  const generated = events.flatMap((e) => (e.type === 'title' ? [e.title] : []))
  if (row.title && (mayName || !generated.includes(row.title))) return row.title
  if (mayName && generated.length) return generated.at(-1)!
  const said = events.flatMap((e) => (e.type === 'prompt' && e.source === 'human' ? [{ role: 'user' as const, text: e.text }] : []))
  return deriveTitle(said, row.runtime ?? DEFAULT_RUNTIME, row.kind) ?? errandName(row, events) ?? NEW_CHAT_NAME
}
