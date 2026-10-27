import type { ThreadEntry } from './chat-thread'

/**
 * The chat column's threads (chat-as-web-components decision 7): one column
 * shows one thread at a time, and the header's thread list holds every thread
 * it can show, finished ones included. Pure — which thread is the feature's
 * main chat, and the list a page offers.
 */

/** What a scenario chat was opened for: ＋ New scenario, or Fix it on one. */
export type ScenarioErrand = { kind: 'new' } | { kind: 'fix'; name: string }

export function scenarioChatLabel(errand: ScenarioErrand): string {
  return `Scenario chat · ${errand.kind === 'fix' ? `Fix ${errand.name}` : 'New scenario'}`
}

/** The switcher's id for a feature chat nobody has started yet: it has no thread id until its first message. */
export const UNSTARTED_CHAT = 'unstarted'

/** The newest thread of `role` the list holds, or null. */
export function newestThread(threads: readonly ThreadEntry[], role: ThreadEntry['role']): string | null {
  return [...threads].filter((t) => t.role === role).sort((a, b) => b.updatedAt - a.updatedAt)[0]?.id ?? null
}

/**
 * A row for a thread the page shows that the list does not hold yet (one just
 * started or opened, before the list is read again), so the switcher always
 * names what is in front.
 */
export function standIn(id: string, title: string, role: ThreadEntry['role'], now = Date.now()): ThreadEntry {
  return { id, title, role, state: 'idle', updatedAt: now, runtime: 'claude-code' }
}

/** The list with each stand-in whose thread it does not already hold. */
export function withStandIns(threads: readonly ThreadEntry[], standIns: readonly ThreadEntry[]): ThreadEntry[] {
  return [...threads, ...standIns.filter((s) => !threads.some((t) => t.id === s.id))]
}
