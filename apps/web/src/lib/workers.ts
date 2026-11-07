import type { WorkerKind as CoreWorkerKind, WorkerStatus as CoreWorkerStatus } from '@runcastle/core'
import type { StatusTone } from '../ui'

/**
 * Interactive workers as the web draws them (docs/features/interactive-workers).
 * A feature's lead hands work to workers: sandboxed threads, each with a label,
 * a one-line purpose, a kind and a status. These are the view shapes the
 * sidebar's worker list and a worker's chat read; the wire shape is core's
 * `WorkerRow`, and the status and kind here are its own.
 */

/**
 * Where a worker is (decisions 3, 14, 16): at a turn, waiting in line for a
 * slot, waiting on the human, handed back to the lead, landed on the feature
 * branch, failed, or dropped.
 */
export type WorkerStatus = CoreWorkerStatus

/**
 * Taste work the human iterates on, or work that runs in the background
 * (decision 5). A worker the human started with "+" has none: core's
 * `unassigned` is drawn as no kind.
 */
export type WorkerKind = Exclude<CoreWorkerKind, 'unassigned'>

/** One worker, as a row of the open feature's worker list. */
export interface WorkerEntry {
  id: string
  /** Its short name: "Header", "Thread list". */
  label: string
  /** One line on what it does, muted under the label. */
  purpose: string
  status: WorkerStatus
  /** Absent for a worker the human started with "+": it has no assignment. */
  kind?: WorkerKind
  /** Who started it: the lead from its plan or chat, or the human with "+" (decision 7). */
  startedBy: 'lead' | 'you'
  /** When it started: the order inside a group, which a status change alone moves it out of. */
  createdAt: number
  /** When it last moved, for "4m", "2d". */
  updatedAt: number
  /** A side chat from before workers: a read-only transcript in Done (decision 23). */
  oldSideChat?: boolean
  /** What failed, in a few words, while `status` is failed (decision 16). */
  failure?: string
}

/** What a worker was asked to do: the card pinned atop its chat (decision 21). */
export interface WorkerAssignment {
  label: string
  purpose: string
  /** Null for a worker the human started with "+": no assignment, no goal. */
  kind: WorkerKind | null
  goal?: string
  doneWhen?: string
  /** The model it runs on, as the human named it ("Opus 5.5"). */
  model: string
  startedBy: 'lead' | 'you'
}

/** The worker list's groups (decision 3), each in start order, newest first. */
export interface WorkerGroups {
  /** Waiting on the human, or failed: someone must act. */
  needsYou: WorkerEntry[]
  /** At a turn, or queued for a slot. */
  working: WorkerEntry[]
  /** Handed back, landed, dropped, and old side chats: folded. */
  done: WorkerEntry[]
}

const GROUP: Record<WorkerStatus, keyof WorkerGroups> = {
  'needs-you': 'needsYou',
  failed: 'needsYou',
  working: 'working',
  queued: 'working',
  'handed-back': 'done',
  landed: 'done',
  dropped: 'done',
}

/**
 * Sort workers into the list's groups. A failed worker sits with the ones that
 * need the human, since the lead or the human must act on it; an old side
 * chat is always done. Inside a group the newest started comes first, so only
 * a status change moves a row; queued workers follow the working ones, in line.
 */
export function workerGroups(workers: readonly WorkerEntry[]): WorkerGroups {
  const groups: WorkerGroups = { needsYou: [], working: [], done: [] }
  for (const w of [...workers].sort((a, b) => b.createdAt - a.createdAt)) {
    groups[w.oldSideChat ? 'done' : GROUP[w.status]].push(w)
  }
  const queued = (w: WorkerEntry) => Number(w.status === 'queued')
  groups.working.sort((a, b) => queued(a) - queued(b))
  return groups
}

/** Whether any worker waits on the human: the folded feature row's amber dot. */
export function workersNeedYou(workers: readonly WorkerEntry[]): boolean {
  return workers.some((w) => !w.oldSideChat && (w.status === 'needs-you' || w.status === 'failed'))
}

/** A status in words, as the chat header and the row's hover say it. */
export const WORKER_STATUS_WORDS: Record<WorkerStatus, string> = {
  working: 'Working',
  queued: 'Queued',
  'needs-you': 'Needs you',
  'handed-back': 'Handed back',
  landed: 'Landed',
  failed: 'Failed',
  dropped: 'Dropped',
}

/** A status's dot in the chat header: shape first, the hue confirms. */
export const WORKER_STATUS_TONE: Record<WorkerStatus, StatusTone> = {
  working: 'live',
  queued: 'neutral',
  'needs-you': 'warning',
  'handed-back': 'accent',
  landed: 'success',
  failed: 'danger',
  dropped: 'neutral',
}

/** The kind in words, on the assignment card. */
export const WORKER_KIND_WORDS: Record<WorkerKind, string> = {
  'with-you': 'With you',
  'on-its-own': 'On its own',
}

/** Whether a worker still takes messages: everything but the settled ones and old side chats. */
export function workerIsOpen(w: Pick<WorkerEntry, 'status' | 'oldSideChat'>): boolean {
  return !w.oldSideChat && w.status !== 'landed' && w.status !== 'dropped'
}
