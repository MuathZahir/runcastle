import { useState } from 'react'
import type { ReactNode } from 'react'
import type { FileChange } from '../../lib/chat-thread'
import {
  OLD_CHAT_WORDS,
  WORKER_KIND_WORDS,
  WORKER_STATUS_TONE,
  WORKER_STATUS_WORDS,
} from '../../lib/workers'
import type { OldChat, WorkerAssignment, WorkerKind, WorkerStatus } from '../../lib/workers'
import {
  IconActivity,
  IconAlert,
  IconArrowLeft,
  IconArrowRight,
  IconChevronRight,
  IconDoc,
  IconExternalLink,
  IconEye,
  IconGitMerge,
  IconList,
  IconLock,
  IconMessage,
  IconPlay,
  IconUser,
  IconX,
} from '../../icons'
import { BARE_BUTTON, Button, IconButton, StatusDot, cx } from '../../ui'
import { Markdown } from '../Markdown'
import { FeatureActionsMenu, type FeatureAction } from '../FeatureActionsMenu'
import { RAISED, WELL } from '../chat/thread/surfaces'
import { Delta, FilePath } from '../chat/thread/Work'

/**
 * A worker's pieces (docs/features/interactive-workers decision 21), as markup
 * over resolved values: its chat's header status and actions, the assignment
 * card atop its chat, the "Handed back" line its chat ends with, the note that
 * stands in for a composer it cannot take, and — in the lead's chat — the
 * handback card with what the lead did beneath it, and the failed notice.
 */

// ---------------------------------------------------------------------------
// The worker's chat
// ---------------------------------------------------------------------------

/**
 * The worker's status in the header row, as quiet as a feature's: a dot and
 * the word, and for a failure what failed.
 */
export function WorkerStatusLine({
  status,
  old,
  why,
}: {
  status: WorkerStatus
  /** A chat from before workers: read-only, with no status of its own. */
  old?: OldChat
  /** A few words after the status: what failed, why a queued worker is held. */
  why?: string
}) {
  return (
    <p className="m-0 flex min-w-0 items-center gap-2 text-sm text-text-tertiary" role="status">
      <StatusDot tone={old ? 'neutral' : WORKER_STATUS_TONE[status]} />
      <span className="min-w-0 truncate text-text-secondary">{old ? `${OLD_CHAT_WORDS[old]} · read-only` : WORKER_STATUS_WORDS[status]}</span>
      {why && !old && <span className="min-w-0 shrink-[100] truncate">· {why}</span>}
    </p>
  )
}

/**
 * The header's actions: "Open preview" while the worker's dev server runs
 * (decision 15), "Hand back" while it holds work it could hand back (decision
 * 5), then "…". Absent ones take no room.
 */
export function WorkerHeaderActions({
  onOpenPreview,
  onHandBack,
  menu,
}: {
  /** Set only while its dev server runs. */
  onOpenPreview?: () => void
  /** Set only while it can hand back: not handed back, landed, dropped or failed. */
  onHandBack?: () => void
  menu: FeatureAction[]
}) {
  return (
    <>
      {onOpenPreview && (
        <Button variant="ghost" icon={<IconExternalLink />} onClick={onOpenPreview}>
          Open preview
        </Button>
      )}
      {onHandBack && (
        <Button variant="secondary" icon={<IconArrowLeft />} onClick={onHandBack} title="Ask the worker to write its summary and hand its work back to the lead">
          Hand back
        </Button>
      )}
      {menu.length > 0 && <FeatureActionsMenu actions={menu} label="Worker actions" />}
    </>
  )
}

const KIND_ICON: Record<WorkerKind, ReactNode> = {
  'with-you': <IconUser size={14} />,
  'on-its-own': <IconActivity size={14} />,
  review: <IconEye size={14} />,
  'fix-drive': <IconPlay size={14} />,
  scenario: <IconList size={14} />,
}

/**
 * What the worker was asked to do, atop its chat (decision 21): its label and
 * kind, who started it, its one-line purpose, then the goal, the done-when and
 * the model. It stays at the top while the chat scrolls under it, so it folds
 * to its first two lines (`defaultOpen`: a caller folds it once the chat is long). A worker started with "+" has no assignment: the card
 * says so, and names only its model.
 */
export function AssignmentCard({ assignment, defaultOpen = true }: { assignment: WorkerAssignment; defaultOpen?: boolean }) {
  const a = assignment
  const [open, setOpen] = useState(defaultOpen)
  const facts: { label: string; value: string }[] = [
    ...(a.goal ? [{ label: 'Goal', value: a.goal }] : []),
    ...(a.doneWhen ? [{ label: 'Done when', value: a.doneWhen }] : []),
    { label: 'Model', value: a.model },
  ]
  return (
    // An opaque ground under the well, so the chat scrolling beneath it does not show through.
    <section aria-label={`Assignment: ${a.label}`} className="rounded-lg bg-surface">
      <div className={cx(WELL, 'flex flex-col px-4 py-3')}>
        <div className="flex min-w-0 items-center gap-3">
          <span className="min-w-0 truncate text-md font-medium text-text">{a.label}</span>
          {a.kind && (
            <span className="inline-flex shrink-0 items-center gap-1.5 text-xs text-text-secondary [&_svg]:text-icon">
              {KIND_ICON[a.kind]}
              {WORKER_KIND_WORDS[a.kind]}
            </span>
          )}
          <span className="flex-1" />
          <span className="shrink-0 text-xs text-text-tertiary">{a.startedBy === 'lead' ? 'Started by the lead' : 'Started by you'}</span>
          <IconButton
            size="sm"
            label={open ? 'Fold the assignment' : 'Show the assignment'}
            icon={<IconChevronRight className={cx('transition-transform duration-(--dur-2) ease-app', open && 'rotate-90')} />}
            onClick={() => setOpen(!open)}
            className="-mr-1.5"
          />
        </div>
        <p className="m-0 truncate text-sm text-text-secondary" title={a.purpose}>
          {a.kind ? a.purpose : a.purpose || 'No assignment: it knows the feature and the lead’s latest turns, and waits for you.'}
        </p>
        {open && (
          <dl className="m-0 mt-3 grid animate-fade-in grid-cols-[max-content_minmax(0,1fr)] gap-x-6 gap-y-1.5 border-t border-border-subtle pt-3 text-sm">
            {facts.map((f) => (
              <div key={f.label} className="contents">
                <dt className="text-text-tertiary">{f.label}</dt>
                <dd className="m-0 min-w-0 text-text">{f.value}</dd>
              </div>
            ))}
          </dl>
        )}
      </div>
    </section>
  )
}

/** A line across the column, its words in the middle: the thread's own dividers. */
function Rule({ children }: { children: ReactNode }) {
  return (
    <div className="flex items-center gap-3 text-xs text-text-tertiary">
      <span className="h-px flex-1 bg-border-subtle" />
      <span className="inline-flex items-center gap-1.5">{children}</span>
      <span className="h-px flex-1 bg-border-subtle" />
    </div>
  )
}

/**
 * The worker's chat ends here: its handback went to the lead (decision 21's
 * matching line), or to the orchestrator for a project drive's Scenarios worker
 * (drive-chats-become-workers decision 2).
 */
export function HandedBackLine({
  commits,
  files,
  by,
  to = 'the lead',
}: {
  commits: number
  files: number
  by?: 'you' | 'worker'
  to?: 'the lead' | 'the orchestrator'
}) {
  return (
    <Rule>
      <IconArrowLeft size={12} className="text-icon" />
      Handed back to {to}{by === 'you' ? ' at your word' : ''} · {commits} {commits === 1 ? 'commit' : 'commits'} · {files}{' '}
      {files === 1 ? 'file' : 'files'}
    </Rule>
  )
}

/**
 * What stands at the foot of a worker's chat that takes no messages, in place
 * of the composer: an old chat (decision 23), a failed worker, a settled one,
 * a drive worker between drives.
 */
export function WorkerClosedNote({ icon, title, hint }: { icon: ReactNode; title: string; hint?: ReactNode }) {
  return (
    <div className={cx(RAISED, 'flex items-start gap-2.5 px-4 py-3 text-sm')}>
      <span className="mt-0.5 inline-flex shrink-0 text-icon [&>svg]:size-4">{icon}</span>
      <span className="flex min-w-0 flex-col gap-0.5">
        <span className="text-text">{title}</span>
        {hint && <span className="text-text-tertiary">{hint}</span>}
      </span>
    </div>
  )
}

const OLD_CHAT_HINT: Record<OldChat, string> = {
  side: 'To carry it on, start a worker with “+” on the feature and paste what it needs.',
  drive: 'The drive’s chats are workers now: Fix drive or New scenario on a drive starts one.',
}

/** The note an old side or drive chat shows in place of its composer. */
export function OldChatNote({ old }: { old: OldChat }) {
  return <WorkerClosedNote icon={<IconLock />} title={`${OLD_CHAT_WORDS[old]} — read-only`} hint={OLD_CHAT_HINT[old]} />
}

// ---------------------------------------------------------------------------
// The lead's chat
// ---------------------------------------------------------------------------

/** What the lead did with a handback (decision 4). */
export type HandbackOutcome = { kind: 'landed'; into: string } | { kind: 'sent-back'; note: string } | { kind: 'dropped' }

export interface Handback {
  workerId: string
  workerLabel: string
  kind: WorkerKind | null
  /** The worker's own words, which carry any direction the human gave it. */
  summary: string
  commits: number
  /** The files it changed; the line counts only where they are known (a handback records paths). */
  files: HandbackFile[]
  /** A drive worker's: the branch its commits are already on. */
  branch?: string
  /** Absent while the lead has not acted on it yet. */
  outcome?: HandbackOutcome
}

/** A file a handback changed: its path, and its line counts when they are known. */
export type HandbackFile = Pick<FileChange, 'path'> & Partial<Pick<FileChange, 'added' | 'removed'>>

/** The delta of files whose counts are all known; absent otherwise, rather than a false "+0 −0". */
function knownDelta(files: readonly HandbackFile[]): { added: number; removed: number } | null {
  if (!files.every((f) => f.added !== undefined && f.removed !== undefined)) return null
  return { added: files.reduce((n, f) => n + (f.added ?? 0), 0), removed: files.reduce((n, f) => n + (f.removed ?? 0), 0) }
}

/** The files a handback changed, folded to one line that opens to each path. */
function HandbackFiles({ files }: { files: HandbackFile[] }) {
  const [open, setOpen] = useState(false)
  const total = knownDelta(files)
  return (
    <div className="flex flex-col border-t border-border-subtle">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className={cx(
          BARE_BUTTON,
          'flex h-9 cursor-pointer items-center gap-2 px-4 text-left text-sm text-text-secondary',
          'transition-colors duration-(--dur-1) ease-app hover:bg-surface-hover',
        )}
      >
        <IconChevronRight size={14} className={cx('shrink-0 text-icon transition-transform duration-(--dur-2) ease-app', open && 'rotate-90')} />
        <span>
          {files.length} {files.length === 1 ? 'file' : 'files'} changed
        </span>
        {total && <Delta added={total.added} removed={total.removed} />}
      </button>
      {open && (
        <ul className="m-0 flex list-none flex-col px-2 pb-2 animate-fade-in">
          {files.map((f) => (
            <li key={f.path} className="flex h-7 min-w-0 items-center gap-2 px-2">
              <IconDoc size={14} className="shrink-0 text-icon" />
              <FilePath path={f.path} />
              {f.added !== undefined && f.removed !== undefined && <Delta added={f.added} removed={f.removed} />}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

/** What the lead did, beneath the card: one quiet line, as an answered ask reads. */
export function HandbackOutcomeLine({ outcome }: { outcome: HandbackOutcome }) {
  if (outcome.kind === 'landed') {
    return (
      <p className="m-0 flex min-w-0 items-center gap-1.5 text-sm text-text-tertiary">
        <IconGitMerge size={14} className="shrink-0 text-success" />
        <span className="shrink-0 text-text-secondary">Landed</span>
        <span className="min-w-0 truncate">
          on <span className="font-mono text-xs">{outcome.into}</span>
        </span>
      </p>
    )
  }
  if (outcome.kind === 'sent-back') {
    return (
      <p className="m-0 flex min-w-0 items-start gap-1.5 text-sm text-text-tertiary">
        <IconArrowRight size={14} className="mt-[3px] shrink-0 text-icon" />
        <span className="shrink-0 text-text-secondary">Sent back:</span>
        <span className="min-w-0">{outcome.note}</span>
      </p>
    )
  }
  return (
    <p className="m-0 flex items-center gap-1.5 text-sm text-text-tertiary">
      <IconX size={14} className="shrink-0 text-icon" />
      <span className="text-text-secondary">Dropped</span>
      <span>· its sandbox and branch were removed</span>
    </p>
  )
}

/**
 * A worker's handback in the lead's chat (decisions 4, 21): who handed back and
 * what kind of work it was, its summary, its commits, the files it changed
 * (folded), a way to its chat, and beneath the card what the lead did with it.
 */
export function HandbackCard({ handback, onOpenWorker }: { handback: Handback; onOpenWorker: (workerId: string) => void }) {
  const h = handback
  return (
    <div className="flex flex-col gap-2.5 animate-rise-in">
      <article aria-label={`Handback from ${h.workerLabel}`} className={cx(WELL, 'flex flex-col overflow-hidden')}>
        <header className="flex min-w-0 items-center gap-2.5 px-4 pt-3">
          <span className="inline-flex size-4 shrink-0 items-center justify-center text-icon">
            <IconArrowLeft size={14} />
          </span>
          <span className="min-w-0 truncate text-sm text-text-secondary">
            <span className="font-medium text-text">{h.workerLabel}</span> handed back
          </span>
          <span className="flex-1" />
          <Button size="sm" variant="ghost" icon={<IconMessage />} onClick={() => onOpenWorker(h.workerId)} className="-mr-2">
            Open its chat
          </Button>
        </header>
        <p className="m-0 flex flex-wrap items-center gap-x-1.5 pl-[42px] text-xs text-text-tertiary">
          {h.kind ? WORKER_KIND_WORDS[h.kind] : 'Started by you'}
          <span aria-hidden>·</span>
          <span className="tabular-nums">
            {h.commits} {h.commits === 1 ? 'commit' : 'commits'}
          </span>
          {h.branch && (
            <>
              <span aria-hidden>·</span>
              <span className="min-w-0 truncate">
                on <span className="font-mono">{h.branch}</span>
              </span>
            </>
          )}
        </p>
        <div className="px-4 pt-2.5 pb-3.5 pl-[42px]">
          <Markdown source={h.summary} size="sm" tone="primary" />
        </div>
        {h.files.length > 0 && <HandbackFiles files={h.files} />}
      </article>
      {h.outcome && <HandbackOutcomeLine outcome={h.outcome} />}
    </div>
  )
}

/**
 * A feature's lead handing back to the orchestrator, in the orchestrator's chat
 * (agents-are-woken-only-when-it-matters decision 21): the worker handback card's
 * look, with the feature's state line where a worker's commits and files go, and
 * a way to the feature's chat.
 */
export function FeatureHandbackCard({
  title,
  state,
  summary,
  onOpenFeature,
}: {
  title: string
  /** One line of the feature's state runcastle added: ready or not, what it waits on, its latest round. */
  state: string
  summary: string
  onOpenFeature: () => void
}) {
  return (
    <article aria-label={`Handback from ${title}`} className={cx(WELL, 'flex flex-col overflow-hidden animate-rise-in')}>
      <header className="flex min-w-0 items-center gap-2.5 px-4 pt-3">
        <span className="inline-flex size-4 shrink-0 items-center justify-center text-icon">
          <IconArrowLeft size={14} />
        </span>
        <span className="min-w-0 truncate text-sm text-text-secondary">
          <span className="font-medium text-text">{title}</span> handed back
        </span>
        <span className="flex-1" />
        <Button size="sm" variant="ghost" icon={<IconMessage />} onClick={onOpenFeature} className="-mr-2">
          Open its chat
        </Button>
      </header>
      <p className="m-0 pl-[42px] pr-4 text-xs text-text-tertiary">{state}</p>
      <div className="px-4 pt-2.5 pb-3.5 pl-[42px]">
        <Markdown source={summary} size="sm" tone="primary" />
      </div>
    </article>
  )
}

/**
 * A worker that failed, in the lead's chat (decision 16): one line, the way
 * a failure reads in a thread, with the way to the worker's chat.
 */
export function WorkerFailedCard({
  workerId,
  workerLabel,
  reason,
  onOpenWorker,
}: {
  workerId: string
  workerLabel: string
  /** What failed, in words: "container stopped unexpectedly". */
  reason: string
  onOpenWorker: (workerId: string) => void
}) {
  return (
    <div role="status" className={cx(WELL, 'flex min-w-0 items-center gap-2.5 py-1.5 pr-2 pl-4 animate-rise-in')}>
      <IconAlert size={15} className="shrink-0 text-danger" />
      <span className="min-w-0 flex-1 text-sm text-danger-text">
        Worker “{workerLabel}” failed: {reason}
      </span>
      <Button size="sm" variant="ghost" icon={<IconMessage />} onClick={() => onOpenWorker(workerId)}>
        Open its chat
      </Button>
    </div>
  )
}
