import { useState } from 'react'
import type { ReactNode } from 'react'
import { cx, LINK, Spinner, StatusDot } from '../ui'
import { Popover, PopoverContent, PopoverTrigger } from '../ui/popover'
import { FLOATING_ITEM, FLOATING_ITEM_DEFAULT, FLOATING_LABEL, FLOATING_SEPARATOR } from '../ui/floating'
import { IconClock } from '../icons'
import { relTime } from '../lib/format'
import type { WorkerKind } from '../lib/workers'

/**
 * The machine's one line (one-number-for-how-many-build-at-once decisions 3, 8,
 * 9): how many workers and reviews are mid-turn against the limit, and how many
 * wait for a place, across every project. A quiet line in the sidebar's foot;
 * it opens the whole line-up — those working, then those waiting in their
 * order. A worker held by its account's usage limit is skipped in the order
 * and says why. Props only: the caller resolves the line.
 */

/** One worker or review in the line. */
export interface QueueEntry {
  /** The worker's id: its chat. */
  id: string
  label: string
  kind?: WorkerKind
  /** Its feature; none for a worker that belongs to no feature. */
  featureId?: string | null
  featureTitle?: string | null
  projectId: string
  projectName: string
  /** Working since, or waiting since: when it took or asked for a place. */
  since: number
  /** Why it is skipped in the order (decision 9): "usage limit until 14:00". */
  heldBy?: string
}

export interface WorkQueueProps {
  /** How many may work at once (decision 1). */
  limit: number
  /** Mid-turn now, longest working first. */
  working: QueueEntry[]
  /** Waiting for a place, in the order they asked; held ones keep their spot but take no number. */
  waiting: QueueEntry[]
  /** The open project: other projects' entries name theirs. Absent on the portfolio home, where every entry does. */
  currentProjectId?: string
  /** An entry: its worker's chat. */
  onOpen: (entry: QueueEntry) => void
  /** The footer's "Change in Settings": the setting itself (decision 7). */
  onOpenSettings?: () => void
  /** For tests and design pages: the clock the ages read. */
  now?: number
}

/** The line's words: "2 of 2 working · 3 waiting". */
export function queueWords(limit: number, working: number, waiting: number): string {
  return `${working} of ${limit} working${waiting > 0 ? ` · ${waiting} waiting` : ''}`
}

/** Each waiting entry's place, 1 = next; a held entry has none (decision 9). */
export function queuePlaces(waiting: readonly QueueEntry[]): (number | null)[] {
  let place = 0
  return waiting.map((e) => (e.heldBy ? null : ++place))
}

/** Hidden when nothing works or waits (decision 8). */
export function WorkQueue({ limit, working, waiting, currentProjectId, onOpen, onOpenSettings, now = Date.now() }: WorkQueueProps) {
  const [open, setOpen] = useState(false)
  if (working.length === 0 && waiting.length === 0) return null
  const words = queueWords(limit, working.length, waiting.length)
  const places = queuePlaces(waiting)
  const pick = (e: QueueEntry) => {
    setOpen(false)
    onOpen(e)
  }
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          data-work-queue
          aria-label={`${words.replace(' · ', ', ')}: show the line`}
          className={cx(
            'flex h-8 w-full shrink-0 cursor-pointer items-center gap-2 rounded-md px-2.5 text-left text-sm',
            'transition-colors duration-(--dur-1) ease-app hover:bg-surface-hover data-[state=open]:bg-surface-hover',
          )}
        >
          <span className="inline-flex size-4 shrink-0 items-center justify-center">
            {working.length > 0 ? <StatusDot tone="live" /> : <IconClock size={12} className="text-icon" />}
          </span>
          <span className="min-w-0 truncate text-text-secondary">
            {working.length} of {limit} working
            {waiting.length > 0 && <span className="text-text-tertiary"> · {waiting.length} waiting</span>}
          </span>
        </button>
      </PopoverTrigger>
      <PopoverContent
        side="top"
        align="start"
        sideOffset={6}
        className="w-80"
        aria-label="Workers working and waiting, on this machine"
        tabIndex={-1}
        // The panel takes the focus, not its first row: a row lights only where the pointer or the keyboard goes.
        onOpenAutoFocus={(e) => {
          e.preventDefault()
          ;(e.currentTarget as HTMLElement).focus()
        }}
      >
        {working.length > 0 && (
          <>
            <QueueHeading label="Working" count={`${working.length} of ${limit}`} />
            {working.map((e) => (
              <QueueRow key={e.id} entry={e} mark={<Spinner size="sm" />} currentProjectId={currentProjectId} now={now} onOpen={pick} />
            ))}
          </>
        )}
        {waiting.length > 0 && (
          <>
            <QueueHeading label="Waiting" count={String(waiting.length)} />
            {waiting.map((e, i) => {
              const place = places[i]
              return (
                <QueueRow
                  key={e.id}
                  entry={e}
                  waiting
                  mark={
                    place ? (
                      <span className="text-xs text-text-tertiary tabular-nums" aria-label={`${place} in line`}>
                        {place}
                      </span>
                    ) : (
                      <IconClock size={12} className="text-icon" aria-label="Held" />
                    )
                  }
                  currentProjectId={currentProjectId}
                  now={now}
                  onOpen={pick}
                />
              )
            })}
          </>
        )}
        <div className={FLOATING_SEPARATOR} />
        <p className="m-0 flex items-center gap-1 px-2.5 py-1.5 text-xs text-text-tertiary">
          <span>Limit: {limit} at once</span>
          <span aria-hidden>·</span>
          <button
            type="button"
            className={LINK}
            onClick={() => {
              setOpen(false)
              onOpenSettings?.()
            }}
          >
            Change in Settings
          </button>
        </p>
      </PopoverContent>
    </Popover>
  )
}

function QueueHeading({ label, count }: { label: string; count: string }) {
  return (
    <div className={cx(FLOATING_LABEL, 'flex items-baseline gap-1.5')}>
      <span>{label}</span>
      <span className="font-normal tabular-nums">{count}</span>
    </div>
  )
}

/** Whether to name the kind: a review whose label does not already say so. */
const namesKind = (e: QueueEntry) => e.kind === 'review' && !/^review\b/i.test(e.label)

/**
 * One entry: its mark (a spinner working, its place waiting, a clock held),
 * its label and age, then its feature — its kind before it when a Review, its
 * project after it when another project's — and a held one's reason.
 */
function QueueRow({
  entry: e,
  mark,
  waiting = false,
  currentProjectId,
  now,
  onOpen,
}: {
  entry: QueueEntry
  mark: ReactNode
  waiting?: boolean
  currentProjectId: string | undefined
  now: number
  onOpen: (e: QueueEntry) => void
}) {
  const age = waiting ? (e.heldBy ? 'Held for' : 'Waiting for') : 'Working for'
  const where = [namesKind(e) && 'Review', e.featureTitle, e.projectId !== currentProjectId && e.projectName].filter(Boolean).join(' · ')
  return (
    <button
      type="button"
      onClick={() => onOpen(e)}
      title={`${e.label} — open its chat`}
      className={cx(FLOATING_ITEM, FLOATING_ITEM_DEFAULT, 'items-start py-1.5')}
    >
      <span className="inline-flex h-5 w-4 shrink-0 items-center justify-center">{mark}</span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="flex min-w-0 items-baseline gap-2">
          <span className="min-w-0 flex-1 truncate">{e.label}</span>
          <span className="shrink-0 text-xs text-text-tertiary tabular-nums" title={`${age} ${relTime(e.since, now)}`}>
            {relTime(e.since, now)}
          </span>
        </span>
        <span className="truncate text-xs text-text-tertiary">{where}</span>
        {e.heldBy && <span className="text-xs text-pretty text-text-secondary">held: {e.heldBy}</span>}
      </span>
    </button>
  )
}
