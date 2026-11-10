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
import { BARE_BUTTON, Button, StatusDot, cx } from '../../ui'
import { Markdown } from '../Markdown'
import { FeatureActionsMenu, type FeatureAction } from '../FeatureActionsMenu'
import { INSET, RAISED, WELL } from '../chat/thread/surfaces'
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

/** A worker's kind as a 14px glyph: the assignment card's, the workers card's rows. */
export const WORKER_KIND_ICON: Record<WorkerKind, ReactNode> = {
  'with-you': <IconUser size={14} />,
  'on-its-own': <IconActivity size={14} />,
  review: <IconEye size={14} />,
  'fix-drive': <IconPlay size={14} />,
  scenario: <IconList size={14} />,
}

/**
 * The one line a worker is known by (calmer-worker-chats decision 10): the
 * purpose its lead wrote for it, or, without one, the first line of its goal.
 * Empty when it has neither (a worker started with "+").
 */
export function workerLine(w: { purpose: string; goal?: string | undefined }): string {
  return w.purpose.trim() || (w.goal ?? '').trim().split('\n', 1)[0]!.trim()
}

/**
 * How tall a long text in a card may grow before it scrolls: a handback's
 * report opened, an assignment opened (calmer-worker-chats decisions 2, 3).
 * The same cap for both, so no card takes over the column.
 */
const CAPPED_BOX = cx(INSET, 'max-h-96 overflow-y-auto [scrollbar-width:thin] [scrollbar-color:var(--color-border-strong)_transparent]')

/**
 * What the worker was asked to do, pinned atop its chat (decision 21;
 * calmer-worker-chats decision 3). Folded — as it starts — it is one line:
 * the kind's glyph, the worker's name and its purpose; a click anywhere on it
 * opens it. Open, it adds its kind and who started it, then the goal, the
 * done-when and the model in a box that scrolls past the cap, so pinned it
 * never covers the conversation. A worker started with "+" has no assignment:
 * the line says so, and the box names only its model.
 */
export function AssignmentCard({ assignment, defaultOpen = false }: { assignment: WorkerAssignment; defaultOpen?: boolean }) {
  const a = assignment
  const [open, setOpen] = useState(defaultOpen)
  // The goal and done-when are the lead's Markdown; the model is a name.
  const facts: { label: string; value: string; prose?: boolean }[] = [
    ...(a.goal ? [{ label: 'Goal', value: a.goal, prose: true }] : []),
    ...(a.doneWhen ? [{ label: 'Done when', value: a.doneWhen, prose: true }] : []),
    { label: 'Model', value: a.model },
  ]
  const line = workerLine(a) || (a.kind ? '' : 'No assignment: it knows the feature and the lead’s latest turns, and waits for you.')
  const startedBy = a.startedBy === 'lead' ? 'Started by the lead' : 'Started by you'
  return (
    // An opaque ground under the well, so the chat scrolling beneath it does not show through.
    <section aria-label={`Assignment: ${a.label}`} className="rounded-lg bg-surface">
      <div className={cx(WELL, 'flex flex-col')}>
        <button
          type="button"
          aria-expanded={open}
          aria-label={`${open ? 'Fold' : 'Show'} the assignment: ${a.label}`}
          onClick={() => setOpen(!open)}
          className={cx(
            BARE_BUTTON,
            'group/head flex h-10 min-w-0 cursor-pointer items-center gap-2.5 rounded-lg px-4 text-left',
            'transition-colors duration-(--dur-1) ease-app hover:bg-surface-hover',
          )}
        >
          <span className="inline-flex shrink-0 text-icon" title={a.kind ? WORKER_KIND_WORDS[a.kind] : startedBy}>
            {a.kind ? WORKER_KIND_ICON[a.kind] : <IconUser size={14} />}
          </span>
          <span className="max-w-[45%] shrink-0 truncate text-md font-medium text-text">{a.label}</span>
          <span className="min-w-0 flex-1 truncate text-sm text-text-secondary" title={line}>
            {line}
          </span>
          <IconChevronRight
            size={14}
            className={cx('shrink-0 text-icon transition-transform duration-(--dur-2) ease-app', open && 'rotate-90')}
          />
        </button>
        {open && (
          <div className="flex min-w-0 flex-col gap-2 px-4 pb-3.5 pl-[42px] animate-fade-in">
            <p className="m-0 text-xs text-text-tertiary">
              {a.kind ? `${WORKER_KIND_WORDS[a.kind]} · ${startedBy}` : startedBy}
            </p>
            <div data-assignment-box className={cx(CAPPED_BOX, 'px-3.5 py-3')}>
              <dl className="m-0 grid grid-cols-[max-content_minmax(0,1fr)] gap-x-6 gap-y-2 text-sm">
                {facts.map((f) => (
                  <div key={f.label} className="contents">
                    <dt className="text-text-tertiary">{f.label}</dt>
                    <dd className="m-0 min-w-0 break-words text-text">
                      {f.prose ? <Markdown source={f.value} size="sm" tone="primary" /> : f.value}
                    </dd>
                  </div>
                ))}
              </dl>
            </div>
          </div>
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
  branch,
}: {
  commits: number
  files: number
  by?: 'you' | 'worker'
  to?: 'the lead' | 'its epic'
  /** The branch a drive worker's commits landed on (decision 3): named so a commit on main is never a surprise. */
  branch?: string
}) {
  return (
    <Rule>
      <IconArrowLeft size={12} className="text-icon" />
      Handed back to {to}{by === 'you' ? ' at your word' : ''} · {commits} {commits === 1 ? 'commit' : 'commits'} · {files}{' '}
      {files === 1 ? 'file' : 'files'}
      {branch ? ` · on ${branch}` : ''}
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

/** Past this many characters a report's first paragraph is clamped to four lines until opened. */
const LONG_FIRST = 420

/**
 * A report cut where its first paragraph ends (calmer-worker-chats decision
 * 2): the text up to the first blank line — a heading alone is taken with the
 * block after it, and a code fence is never cut — then the rest.
 */
export function splitReport(source: string): { first: string; rest: string } {
  const blocks = source.trim().split(/\n\s*\n/)
  let n = 1
  if (/^#{1,6}\s/.test(blocks[0] ?? '') && !blocks[0]!.includes('\n') && blocks.length > 1) n = 2
  // An open fence keeps its blocks together up to its close.
  while (n < blocks.length && (blocks.slice(0, n).join('\n\n').match(/^```/gm)?.length ?? 0) % 2 === 1) n++
  return { first: blocks.slice(0, n).join('\n\n'), rest: blocks.slice(n).join('\n\n') }
}

/**
 * A handback's report, capped (calmer-worker-chats decisions 2, 9): its first
 * paragraph (four lines at most while folded), then "Show more", which opens
 * the rest in a box that scrolls past the cap, so the card never takes over
 * the screen. The worker's handback and the lead's to the orchestrator share it.
 */
export function CappedReport({ source }: { source: string }) {
  const [open, setOpen] = useState(false)
  const { first, rest } = splitReport(source)
  const long = first.length > LONG_FIRST
  return (
    <div className="flex min-w-0 flex-col items-start gap-2">
      <Markdown source={first} size="sm" tone="primary" className={cx('w-full', !open && long && '[&>p]:line-clamp-4')} />
      {open && rest && (
        <div data-report-box className={cx(CAPPED_BOX, 'w-full px-3.5 py-3 animate-fade-in')}>
          <Markdown source={rest} size="sm" tone="primary" />
        </div>
      )}
      {(rest || long) && (
        <button
          type="button"
          aria-expanded={open}
          onClick={() => setOpen(!open)}
          className="cursor-pointer text-sm text-text-tertiary underline-offset-2 hover:text-text-secondary hover:underline"
        >
          {open ? 'Show less' : 'Show more'}
        </button>
      )}
    </div>
  )
}

/**
 * A worker's handback in the lead's chat (decisions 4, 21): who handed back and
 * what kind of work it was, its report capped to its first paragraph, its
 * commits, the files it changed (folded), a way to its chat, and beneath the card what the lead did with it.
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
          <CappedReport source={h.summary} />
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
        <CappedReport source={summary} />
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
