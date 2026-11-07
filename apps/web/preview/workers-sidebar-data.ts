import type { FeatureListItem } from '../src/lib/api'
import type { ThreadEntry } from '../src/lib/chat-thread'
import type { WorkerEntry } from '../src/lib/workers'
import { busyFeatures } from './sidebar-data'

/**
 * Sample data for /preview/workers-sidebar.html (interactive-workers decision
 * 3): the busy project, its "Sidebar refresh" feature open, its lead having
 * handed the redesign to workers. Every worker is made up.
 */

const now = Date.now()
const MIN = 60_000
const HOUR = 60 * MIN
const DAY = 24 * HOUR

/** The open feature. */
export const OPEN_TITLE = 'Sidebar refresh'

/**
 * The project as the sidebar shows it. With a worker waiting on the human the
 * open feature waits on them too; with only its lead, it is simply in progress.
 */
export function featuresWith(workersNeedYou: number): FeatureListItem[] {
  return busyFeatures.map((f) =>
    f.title === OPEN_TITLE
      ? {
          ...f,
          liveSession: null,
          waitingReason: null,
          need:
            workersNeedYou > 0
              ? { kind: 'answer', words: workersNeedYou === 1 ? 'A worker needs you' : `${workersNeedYou} workers need you`, held: false, since: now - 4 * MIN }
              : null,
        }
      : f,
  )
}

export const LEAD = 'thread_lead'

export const lead: ThreadEntry = {
  id: LEAD,
  title: 'Plan the sidebar refresh with me',
  role: 'main',
  state: 'idle',
  createdAt: now - 2 * DAY,
  updatedAt: now - 6 * MIN,
  runtime: 'claude-code',
}

function w(
  id: string,
  label: string,
  purpose: string,
  status: WorkerEntry['status'],
  startedAgo: number,
  movedAgo: number,
  over: Partial<WorkerEntry> = {},
): WorkerEntry {
  return {
    id,
    label,
    purpose,
    status,
    kind: 'with-you',
    startedBy: 'lead',
    createdAt: now - startedAgo,
    updatedAt: now - movedAgo,
    ...over,
  }
}

export const HEADER = 'worker_header'
export const THREADS = 'worker_threads'
export const COUNTS = 'worker_counts'

/** Two waiting on the human, two working and one queued, three done. */
export const mixed: WorkerEntry[] = [
  w(HEADER, 'Header', 'Project switcher, search and the new-chat button', 'needs-you', 3 * HOUR, 4 * MIN),
  w(THREADS, 'Thread list', 'The open feature’s rows: two lines, status marks', 'needs-you', 2 * HOUR, 12 * MIN),
  w('worker_data', 'Worker list data', 'Serve each feature’s workers to the sidebar', 'working', 90 * MIN, 1 * MIN, { kind: 'on-its-own' }),
  w('worker_dots', 'Amber dot rule', 'Light a folded feature’s dot when a worker needs you', 'working', 70 * MIN, 2 * MIN, {
    kind: 'on-its-own',
  }),
  w(COUNTS, 'Shelf counts', 'Count wells in both themes', 'queued', 20 * MIN, 20 * MIN, { kind: 'on-its-own' }),
  w('worker_backdrop', 'Halftone backdrop', 'The dots behind the head', 'handed-back', 5 * HOUR, 40 * MIN),
  w('worker_icons', 'Shelf icons', 'Backlog, Shipped and Archived glyphs', 'landed', 6 * HOUR, 2 * HOUR),
  w('worker_grain', 'Try a film grain', 'Started by you', 'dropped', 7 * HOUR, 3 * HOUR, { kind: undefined, startedBy: 'you' }),
]

/** Done unfolded: one landed, one dropped, one old side chat among them. */
export const doneOpen: WorkerEntry[] = [
  ...mixed.slice(0, 4),
  w('side_old', 'Why does the bay draw square corners?', '', 'handed-back', 4 * DAY, 4 * DAY, {
    oldSideChat: true,
    kind: undefined,
    startedBy: 'you',
  }),
  ...mixed.slice(5),
]

/** One failed worker: with the ones that need someone to act. */
export const failed: WorkerEntry[] = [
  w('worker_data', 'Worker list data', 'Serve each feature’s workers to the sidebar', 'failed', 90 * MIN, 3 * MIN, {
    kind: 'on-its-own',
    failure: 'container stopped unexpectedly',
  }),
  w(HEADER, 'Header', 'Project switcher, search and the new-chat button', 'needs-you', 3 * HOUR, 4 * MIN),
  w('worker_dots', 'Amber dot rule', 'Light a folded feature’s dot when a worker needs you', 'working', 70 * MIN, 2 * MIN, {
    kind: 'on-its-own',
  }),
  w('worker_icons', 'Shelf icons', 'Backlog, Shipped and Archived glyphs', 'landed', 6 * HOUR, 2 * HOUR),
]
