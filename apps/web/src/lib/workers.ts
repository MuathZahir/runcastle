import { shownWorkerStatus } from '@runcastle/core'
import type {
  Need,
  ShownWorkerStatus,
  ThreadEntry,
  WorkerKind as CoreWorkerKind,
  WorkerRow as CoreWorkerRow,
  WorkerStatus as CoreWorkerStatus,
} from '@runcastle/core'
import type { StatusTone } from '../ui'

/**
 * Interactive workers as the web draws them (docs/features/interactive-workers).
 * A feature's lead hands work to workers: sandboxed threads, each with a label,
 * a one-line purpose, a kind and a status. These are the view shapes the
 * sidebar's worker list and a worker's chat read; the wire shape is core's
 * `WorkerRow`, and the status and kind here are its own.
 */

/**
 * Where a worker is, as the human reads it (decisions 3, 14, 16; needs-you-is-
 * the-agent-s-call decision 6): needing you, at a turn, idle between turns,
 * waiting in line for a slot, handed back to the lead, landed on the feature
 * branch, failed, or dropped. `idle` is the web's own word for a worker in
 * play with no turn running.
 */
export type WorkerStatus = ShownWorkerStatus

/**
 * A worker's status as it shows (decision 6): its own need, else Working while
 * a turn of it runs, else Idle; a settled, queued, failed or stalled worker its
 * own word. Core's, so the lead and the epic read the same (a-worker-never-
 * shows-working-with-nothing-running decision 1).
 */
export { shownWorkerStatus }

/** The line after a stalled worker's status, and its notice in the lead's chat (decision 5). */
export const WORKER_STALLED_WHY = 'stopped twice without handing back'

/** How many workers are at work, counted as their cards read them: a turn running, not a stored status (needs-you decision 6). */
export function workersAtWork(rows: readonly { status: CoreWorkerStatus; need?: Need | null; turnRunning?: boolean }[]): number {
  return rows.filter((w) => shownWorkerStatus(w) === 'working').length
}

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
  /** A chat from before workers, side or drive: a read-only transcript in Done (decision 23; drive-chats-become-workers decision 10). */
  old?: OldChat
  /** What failed, in a few words, while `status` is failed (decision 16). */
  failure?: string
  /** Why it waits, while `status` is queued behind an account error's hold (burns-become-workers decision 21). */
  heldBy?: string
  /** What it needs from the human, in its agent's own line (needs-you decision 6). */
  need?: Need
}

/**
 * A chat from before workers, kept as a read-only transcript: an old side chat
 * (interactive-workers decision 23), or an old Fix-drive or scenario chat
 * (drive-chats-become-workers decision 10).
 */
export type OldChat = 'side' | 'drive'

/** What an old chat is called in its row and its header. */
export const OLD_CHAT_WORDS: Record<OldChat, string> = { side: 'Old side chat', drive: 'Old drive chat' }

/** The old chat a thread of this role is, if it is one. */
export function oldChatOf(role: ThreadEntry['role']): OldChat | undefined {
  return role === 'side' ? 'side' : role === 'old-drive-chat' ? 'drive' : undefined
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
  /** At a turn, idle between turns, or queued for a slot. */
  working: WorkerEntry[]
  /** Handed back, landed, dropped, and old side chats: folded. */
  done: WorkerEntry[]
}

const GROUP: Record<WorkerStatus, keyof WorkerGroups> = {
  'needs-you': 'needsYou',
  failed: 'needsYou',
  working: 'working',
  idle: 'working',
  queued: 'working',
  // The lead's to act on, not the human's (decision 5): with the live workers, its amber word says it.
  stalled: 'working',
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
    groups[w.old ? 'done' : GROUP[w.status]].push(w)
  }
  const queued = (w: WorkerEntry) => Number(w.status === 'queued')
  groups.working.sort((a, b) => queued(a) - queued(b))
  return groups
}

/**
 * Whether a feature's row offers "+" New worker (workers-nest-under-their-
 * feature decision 5): only while it is in progress, never a draft, shipped or
 * archived one.
 */
export function takesNewWorkers(f: { status: 'draft' | 'active' | 'shipped' | 'archived' }): boolean {
  return f.status === 'active'
}

/** Whether any worker waits on the human: the folded feature row's amber dot. */
export function workersNeedYou(workers: readonly WorkerEntry[]): boolean {
  return workers.some((w) => !w.old && (w.status === 'needs-you' || w.status === 'failed'))
}

/** A status in words, as the chat header and the row's hover say it. */
export const WORKER_STATUS_WORDS: Record<WorkerStatus, string> = {
  working: 'Working',
  idle: 'Idle',
  queued: 'Queued',
  'needs-you': 'Needs you',
  'handed-back': 'Handed back',
  landed: 'Landed',
  failed: 'Failed',
  dropped: 'Dropped',
  stalled: 'Stalled',
}

/** A status's dot in the chat header: shape first, the hue confirms. */
export const WORKER_STATUS_TONE: Record<WorkerStatus, StatusTone> = {
  working: 'live',
  idle: 'neutral',
  queued: 'neutral',
  'needs-you': 'warning',
  'handed-back': 'accent',
  landed: 'success',
  failed: 'danger',
  dropped: 'neutral',
  stalled: 'warning',
}

/**
 * The few words after a worker's status, in its row and its chat's status
 * line: the agent's line while it needs you, what failed, or why a queued
 * worker is held (decision 21) — "Queued · held: <reason>". Undefined when its
 * status says it all.
 */
export function workerStatusWhy(w: {
  status: WorkerStatus
  need?: Need | null
  failure?: string | null
  heldBy?: string | null
}): string | undefined {
  if (w.need) return w.need.why
  if (w.status === 'failed' && w.failure) return w.failure
  if (w.status === 'stalled') return WORKER_STALLED_WHY
  if (w.status === 'queued' && w.heldBy) return `held: ${w.heldBy}`
  return undefined
}

/** The Scenarios worker's name, as the server labels it: what its chat is called before its row arrives. */
export const SCENARIOS_LABEL = 'Scenarios'

/**
 * The kind in words, on the assignment card and the handback card. A drive
 * worker's label already says which one it is ("Fix drive", "Scenarios"), so its
 * kind says where it works instead of repeating the label.
 */
export const WORKER_KIND_WORDS: Record<WorkerKind, string> = {
  'with-you': 'With you',
  'on-its-own': 'On its own',
  review: 'Review',
  'fix-drive': 'Beside the drive',
  scenario: 'Beside the drive',
}

/** Whether a worker still takes messages: everything but the settled ones and old chats. */
export function workerIsOpen(w: Pick<WorkerEntry, 'status' | 'old'>): boolean {
  return !w.old && w.status !== 'landed' && w.status !== 'dropped'
}

// ---------------------------------------------------------------------------
// From the wire
// ---------------------------------------------------------------------------

/**
 * What a worker row needs to be drawn: core's `WorkerRow`, as `worker.list`
 * serves it, with the queue hold it may wait behind, its need and whether a
 * turn of it runs.
 */
type WireWorker = Pick<
  CoreWorkerRow,
  'id' | 'label' | 'purpose' | 'kind' | 'goal' | 'doneWhen' | 'model' | 'startedBy' | 'status' | 'failure' | 'createdAt' | 'updatedAt'
> & { heldBy?: string | null; need?: Need | null; turnRunning?: boolean }

const STARTED_BY: Record<CoreWorkerRow['startedBy'], WorkerEntry['startedBy']> = { lead: 'lead', human: 'you' }

/** A worker's row, nested under its feature's sidebar row. */
export function workerEntry(w: WireWorker): WorkerEntry {
  return {
    id: w.id,
    label: w.label,
    purpose: w.purpose,
    status: shownWorkerStatus(w),
    ...(w.need ? { need: w.need } : {}),
    ...(w.kind !== 'unassigned' ? { kind: w.kind } : {}),
    startedBy: STARTED_BY[w.startedBy],
    createdAt: w.createdAt,
    updatedAt: w.updatedAt,
    ...(w.status === 'failed' && w.failure ? { failure: w.failure } : {}),
    ...(w.status === 'queued' && w.heldBy ? { heldBy: w.heldBy } : {}),
  }
}

/**
 * A chat from before workers, side or drive: a read-only transcript in Done.
 * It has no status of its own; it is drawn as done.
 */
export function oldChatEntry(t: Pick<ThreadEntry, 'id' | 'title' | 'createdAt' | 'updatedAt'>, old: OldChat): WorkerEntry {
  return { id: t.id, label: t.title, purpose: '', status: 'handed-back', startedBy: 'you', createdAt: t.createdAt, updatedAt: t.updatedAt, old }
}

/** The card pinned atop a worker's chat (decision 21). */
export function workerAssignment(w: WireWorker): WorkerAssignment {
  return {
    label: w.label,
    purpose: w.purpose,
    kind: w.kind === 'unassigned' ? null : w.kind,
    ...(w.goal ? { goal: w.goal } : {}),
    ...(w.doneWhen ? { doneWhen: w.doneWhen } : {}),
    model: w.model,
    startedBy: STARTED_BY[w.startedBy],
  }
}

/**
 * Whether the human can ask a worker to hand back (decision 5): while it works
 * or waits, or has stalled (its prompt sets it working again: a-worker-never-
 * shows-working-with-nothing-running), not once it has, landed, dropped or failed.
 */
export function workerCanHandBack(status: WorkerStatus): boolean {
  return status === 'needs-you' || status === 'working' || status === 'idle' || status === 'queued' || status === 'stalled'
}

/**
 * The open feature's nested rows: its workers, its drive workers among them
 * (drive-chats-become-workers decision 11), then its old side and drive chats.
 */
export function featureWorkerEntries(workers: readonly WireWorker[], threads: readonly ThreadEntry[]): WorkerEntry[] {
  return [
    ...workers.map(workerEntry),
    ...threads.flatMap((t) => {
      const old = oldChatOf(t.role)
      return old ? [oldChatEntry(t, old)] : []
    }),
  ]
}