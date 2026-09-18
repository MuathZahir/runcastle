import type { FindingStatus, TicketKind } from '@runcastle/core'
import { Button, SectionTitle } from '../../ui'
import {
  lapTrail,
  type ReviewPassFigure,
  type TrailEntry,
  type TrailOutcome,
  type TrailPass,
} from '../../lib/feature-ui'
import { fmtDateTime, relTimeAgo } from '../../lib/format'

/**
 * The lap trail (decisions 4–5): one entry per lap, newest first, every lap
 * visible.
 *
 * It replaces the stage's "Earlier recordings (N)" popover, which was the
 * latest-only page's escape hatch — a click away, and silent about everything
 * but the video. The complaint it answers is that "lap 2 found six defects, lap
 * 3 verified nothing" was not readable at a glance, so the band states per lap
 * what burned, how each pass went, what it left to watch, and what it found.
 *
 * It is history and nothing else. The stage above stays the viewer — it plays
 * the latest recording from whatever lap, and a click on a pass's recording here
 * stages it there rather than opening a second player. The notes rail keeps the
 * open work; a defect count here is a figure, never a row to act on, and
 * observations render only in the Full account (review-arrival-is-legible d8).
 */

const CHIP = 'inline-flex items-center rounded-pill border bg-panel px-3 py-1 font-mono text-xs'

/**
 * The outcome chip's words and colour — a whole literal class per outcome, not
 * an interpolated one, so Tailwind's scanner can see it (STYLE.md). Null where
 * the pass recorded no verdict at all: a pre-feature pass and a lap nothing has
 * finished in both get no chip rather than an invented one.
 */
function outcomeChip(outcome: TrailOutcome): { label: string; className: string } | null {
  switch (outcome.kind) {
    case 'verified':
      return {
        label: outcome.mode ? `Verified · ${outcome.mode}` : 'Verified',
        className: 'border-ok/45 text-ok',
      }
    case 'unverified':
      return { label: 'Unverified', className: 'border-warn/45 text-warn' }
    case 'could-not-run':
      return { label: 'Could not run', className: 'border-warn/45 text-warn' }
    case 'none':
      return null
  }
}

/** One pass's line: what kind of pass it was, how it ran, and what it decided. */
function passLine(pass: TrailPass): string {
  const parts = [pass.passKind === 'verification' ? 'verification' : 'review']
  if (pass.mode) parts.push(`${pass.mode} mode`)
  if (pass.couldNotRun) parts.push('could not run')
  else if (pass.verdict) parts.push(pass.verdict)
  return parts.join(' · ')
}

function LapEntry({
  entry,
  staged,
  onStage,
  onViewRun,
}: {
  entry: TrailEntry
  staged: string | null
  onStage: (ticketId: string) => void
  onViewRun?: () => void
}) {
  const chip = outcomeChip(entry.outcome)
  const { found, fixed, carried } = entry.defects

  return (
    <li className="rounded-lg border border-hairline bg-panel p-4">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1.5">
        <span className="text-sm font-semibold text-text">Lap {entry.lap}</span>
        {entry.completedAt !== null && (
          <span className="font-mono text-xs text-text-3" title={fmtDateTime(entry.completedAt)}>
            reviewed {relTimeAgo(entry.completedAt)}
          </span>
        )}
        {chip && <span className={`${CHIP} ${chip.className}`}>{chip.label}</span>}
        <span className="flex-1" />
        {/* What burned, as a figure — the run view holds the lanes themselves. */}
        {onViewRun ? (
          <Button size="xs" onClick={onViewRun}>
            {entry.burned} ticket{entry.burned === 1 ? '' : 's'} burned
          </Button>
        ) : (
          <span className="font-mono text-xs text-text-3">
            {entry.burned} ticket{entry.burned === 1 ? '' : 's'} burned
          </span>
        )}
      </div>

      {/* The line runcastle filled for a lap that verified nothing (decision 5)
          — never the agent's own prose, which is in the Full account. */}
      {entry.outcome.kind === 'unverified' && (
        <div className="mt-2 flex flex-col gap-1">
          {entry.outcome.line && (
            <span className="font-mono text-xs text-warn">{entry.outcome.line}</span>
          )}
          {entry.outcome.reason && (
            <span className="font-mono text-xs text-text-3">{entry.outcome.reason}</span>
          )}
        </div>
      )}

      {entry.passes.length > 0 && (
        <ul className="mt-3 flex list-none flex-col gap-1 p-0">
          {entry.passes.map((pass) => (
            <li key={pass.ticketId} className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-xs text-text-2">
                #{pass.seq} · {passLine(pass)}
              </span>
              {pass.videoUrl && (
                <Button
                  size="xs"
                  aria-pressed={staged === pass.ticketId}
                  onClick={() => onStage(pass.ticketId)}
                >
                  Recording
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}

      <div className="mt-3 font-mono text-xs text-text-3">
        {found} defect{found === 1 ? '' : 's'} found · {fixed} fixed · {carried} carried ·{' '}
        {entry.notes} test note{entry.notes === 1 ? '' : 's'}
      </div>
    </li>
  )
}

export function ReviewTrail({
  passes,
  tickets,
  findings,
  notes,
  currentLap,
  staged,
  onStage,
  onViewRun,
}: {
  /** Every review pass this feature ran, from the artifacts feed. */
  passes: readonly ReviewPassFigure[]
  /** The feature's tickets — what burned, and what the feed cannot say. */
  tickets: readonly { id: string; lap: number; kind?: TicketKind; status: string; digest?: string }[]
  findings: readonly {
    lap: number
    kind: 'defect' | 'observation'
    status: FindingStatus
    fixTicketId?: string | null
  }[]
  notes: readonly { lap: number }[]
  currentLap: number
  /** The recording the stage is playing, so its row reads as the picked one. */
  staged: string | null
  /** Put this pass's recording on the stage — the page owns which one is up. */
  onStage: (ticketId: string) => void
  /** Go to the run view, where the lap's lanes are. Absent where it cannot. */
  onViewRun?: () => void
}) {
  // Nothing has ever been reviewed: the trail would be a bordered box saying a
  // lap exists, which the page says already (decision 6's no-dead-cards rule).
  if (passes.length === 0) return null
  const entries = lapTrail({ passes, tickets, findings, notes, currentLap })

  return (
    <section id="lap-trail" className="flex flex-col gap-4">
      <div className="flex items-baseline gap-3">
        <SectionTitle>Lap trail</SectionTitle>
        <span className="font-mono text-xs text-text-3">
          {entries.length} lap{entries.length === 1 ? '' : 's'} · newest first
        </span>
      </div>
      <ul className="flex list-none flex-col gap-3 p-0">
        {entries.map((entry) => (
          <LapEntry
            key={entry.lap}
            entry={entry}
            staged={staged}
            onStage={onStage}
            {...(onViewRun ? { onViewRun } : {})}
          />
        ))}
      </ul>
    </section>
  )
}
