import type { FeatureListItem } from '../src/lib/api'
import type { ThreadEntry } from '../src/lib/chat-thread'
import { heldFeatures as holdsOf, threadIsActive } from '../src/lib/sidebar-threads'
import { busyFeatures } from './sidebar-data'

/**
 * Sample data for /preview/active-threads.html: an Orchestrator with 78 threads,
 * of which a handful are active, and the busy project's features held by them.
 * The topics are real generated titles from this repo's own threads.
 */

const now = Date.now()
const MIN = 60_000
const HOUR = 60 * MIN
const DAY = 24 * HOUR

function t(id: string, title: string, startedAgo: number, movedAgo: number, over: Partial<ThreadEntry> = {}): ThreadEntry {
  return { id, title, role: 'project', state: 'idle', createdAt: now - startedAgo, updatedAt: now - movedAgo, runtime: 'claude-code', ...over }
}

export const NOTES = 'thread_notes'
export const MOBILE = 'thread_mobile'
export const VPS = 'thread_vps'
export const DESIGN = 'thread_design'
export const OLD = 'thread_old'

/** When the human last wrote. */
const lastHumanAt: Record<string, number> = {
  [NOTES]: now - 20 * MIN,
  [VPS]: now - 3 * HOUR,
  [DESIGN]: now - 3 * DAY,
  [MOBILE]: now - 2 * DAY,
}

const FILLER = [
  'GitHub Action publish errors',
  'Runcastle container pooling',
  'Runcastle grilling prompts onboarding',
  'Concurrent test drives across projects',
  'Runcastle WSL performance research',
  'Runcastle desktop app feasibility',
]

/** Every thread of the project: the fold's sample, 78 of them like this repo's. */
export const allThreads: ThreadEntry[] = [
  t(NOTES, 'Project notes triage', 2 * HOUR, 2 * MIN, { state: 'working' }),
  t(VPS, 'Running Runcastle on a remote VPS', 6 * HOUR, 3 * HOUR),
  t(MOBILE, 'Runcastle mobile remote access', 2 * DAY, 40 * MIN, { state: 'waiting' }),
  t(DESIGN, 'Sidebar design alignment across app', 3 * DAY, 3 * DAY),
  t(OLD, 'Runcastle desktop app feasibility', 5 * DAY, 5 * DAY),
  ...Array.from({ length: 73 }, (_, i) =>
    t(`thread_${i}`, FILLER[i % FILLER.length]!, (6 + i) * DAY, (6 + i) * DAY),
  ),
]

const holdings: Record<string, string> = {
  'Sidebar refresh': NOTES,
  'Rounds see blockers outside the round': NOTES,
  'Prepare reruns stale checks': NOTES,
  'Changelog file per release': MOBILE,
  'Scenario fixtures for drives': DESIGN,
  'Note capture keeps drafts': DESIGN,
  'Dark terminal palette': NOTES,
  // A backlog feature it cut: held, and not counted.
  'Export a feature as PDF': VPS,
}

/** The busy project, with its holders. */
export const heldFeatures: FeatureListItem[] = busyFeatures.map((f) => {
  const heldBy = holdings[f.title]
  return heldBy ? { ...f, heldBy, ...(f.title === 'Dark terminal palette' ? { status: 'active' as const } : {}) } : f
})

export { holdsOf }

/** The real rule, over the sample's times. */
export function isActive(t: ThreadEntry, current: string | null, features: readonly FeatureListItem[], at = now): boolean {
  const written = lastHumanAt[t.id]
  return threadIsActive({ ...t, ...(written === undefined ? {} : { lastHumanAt: written }) }, { current, features, now: at })
}
