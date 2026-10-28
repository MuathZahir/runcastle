import { DEFAULT_RUNTIME, liveEvents, type SessionRow, type ThreadEvent } from '@runcastle/core'
import type { AppCtx } from '../db/types'
import { deriveTitle } from '../services/conversations'
import { tryGetFeature } from '../services/repo'

/**
 * What a thread is called (chat-as-web-components decision 14): by what it is
 * about, never by its kind, and never by runcastle's own words.
 *
 * A title the runtime generates summarises the conversation's start, and once
 * runcastle's opening or a kickoff reached the conversation — sent alone, held
 * for the human's first message (decision 12), riding a resumed chat's prompt,
 * or begun in a terminal before the log — that start is runcastle's words
 * ("Runcastle project skill session"). Such a title names nothing; the human's
 * first message names the thread instead.
 */

/** What a thread with nothing said in it yet is called. */
export const NEW_CHAT_NAME = 'New chat'

/**
 * Whether the runtime's generated title may name the thread: only when the
 * human's own words are all runcastle ever said to that conversation — no
 * prompt of runcastle's, and nothing it `briefed` the agent with besides.
 * A command (Compact now) is no prompt of anyone's.
 */
export function runtimeMayName(events: readonly ThreadEvent[]): boolean {
  if (events.some((e) => e.type === 'briefed')) return false
  const said = events.filter((e) => e.type === 'prompt' && !e.hidden)
  return said.length > 0 && said.every((e) => e.type === 'prompt' && e.source === 'human')
}

/** What the thread's feature is called, for a main chat nobody has written in. */
export interface ThreadAbout {
  featureTitle?: string
}

/** The {@link ThreadAbout} of a row's feature; nothing for a project's thread. */
export function threadAbout(ctx: AppCtx, featureId: string | null | undefined): ThreadAbout {
  const feature = featureId ? tryGetFeature(ctx, featureId) : null
  return feature ? { featureTitle: feature.title } : {}
}

/**
 * A thread nobody has said anything in, named for what it is doing: planning
 * while a self-planning run is on, else a feature's main chat is named after
 * its feature, and an errand thread after its errand.
 */
function errandName(row: SessionRow, events: readonly ThreadEvent[], about: ThreadAbout): string | null {
  // The run clears the purpose as it ends (`lifecycle.ts`), finished or stopped.
  if (row.purpose === 'self-plan') return 'Planning by itself'
  if (row.kind === 'chat' && about.featureTitle) return about.featureTitle
  if (row.kind === 'scenario') return row.purpose === 'scenario-setup' ? 'Scenario: setting scenarios up' : 'Scenario: writing scenarios'
  if (row.kind === 'drive-fix') return 'Fix: the test drive'
  if (events.some((e) => e.type === 'prompt' && e.source === 'runcastle' && !e.hidden)) return 'Working by itself'
  return null
}

/** The human's first message, cleaned and shortened; null before they wrote. */
function firstMessage(row: SessionRow, events: readonly ThreadEvent[]): string | null {
  // A message a rewind cut away no longer names the thread.
  const said = liveEvents(events).flatMap((e) => (e.type === 'prompt' && e.source === 'human' ? [{ role: 'user' as const, text: e.text }] : []))
  return deriveTitle(said, row.runtime ?? DEFAULT_RUNTIME, row.kind)
}

/**
 * A logged thread's name: the human's rename, which wins over everything; a
 * branch's "Branch of <parent>" until the human writes in it, then its own
 * first message; else the runtime's generated title when {@link runtimeMayName},
 * else the human's first message, else what it is doing, else {@link NEW_CHAT_NAME}.
 *
 * A row's title is a rename made before renames were marked, or a generated
 * title the host stored — except one that repeats a generated title the runtime
 * may not give, which an earlier host stored on the row.
 */
export function threadName(row: SessionRow, events: readonly ThreadEvent[], about: ThreadAbout = {}): string {
  // A branch's log begins with its parent's, whose rename is the parent's.
  const branchAt = events.map((e) => e.type).lastIndexOf('branched')
  const own = events.slice(branchAt + 1)
  const renamed = own.flatMap((e) => (e.type === 'title' && e.renamed ? [e.title] : [])).at(-1)
  if (renamed) return renamed
  const branched = events[branchAt]
  if (branched?.type === 'branched') return firstMessage(row, own) ?? `Branch of ${branched.from}`
  const mayName = runtimeMayName(events)
  const generated = events.flatMap((e) => (e.type === 'title' ? [e.title] : []))
  if (row.title && (mayName || !generated.includes(row.title))) return row.title
  if (mayName && generated.length) return generated.at(-1)!
  return firstMessage(row, events) ?? errandName(row, events, about) ?? NEW_CHAT_NAME
}
