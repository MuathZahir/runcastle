import type { ReactNode } from 'react'
import type { TicketKind } from '@runcastle/core'
import { CheckLine } from '../../ui'
import {
  statusChips,
  type CheckRow,
  type CheckTone,
  type LapChipFigure,
  type ReviewArtifactFigure,
  type StatusChip,
} from '../../lib/feature-ui'
import { Markdown } from '../Markdown'

/**
 * The returning human's TL;DR (decision 18b): one line of chips carrying the
 * review outcome with its freshness stamp, the checks, where this lap stands and
 * what the run did. Every chip is a way in — a disclosure that expands, or an
 * anchor into the band it summarises — because the strip's job is to replace the
 * scrolling, not to be another thing to read.
 *
 * The chips themselves come from {@link statusChips}, so the ordering, the
 * "reviewed 2 laps ago" wording and the rule that a review ticket is never
 * counted as landed work all live in one tested derivation rather than in this
 * markup.
 *
 * "No review ran this lap" is not a row in a card any more (decision 19b): it is
 * the amber limiting case of the review chip's stamp, which is where a human
 * looking for "can I trust what is on this page" already is.
 */
const CHIP_TONE: Record<CheckTone, string> = {
  ok: 'border-ok/45 text-ok',
  warn: 'border-warn/45 text-warn',
  danger: 'border-danger/45 text-danger',
  idle: 'border-hairline text-text-3',
}

const CHIP_DOT: Record<CheckTone, string> = {
  ok: 'bg-ok',
  warn: 'bg-warn',
  danger: 'bg-danger',
  idle: 'bg-text-3',
}

const CHIP_BASE =
  'inline-flex items-center gap-2 rounded-pill border bg-panel px-3 py-1 font-mono text-xs'

function Dot({ tone }: { tone: CheckTone }) {
  return <span className={`size-2 shrink-0 rounded-pill ${CHIP_DOT[tone]}`} aria-hidden="true" />
}

/** A chip that opens in place — its detail is on this page, not in another band. */
function ChipDisclosure({ chip, children }: { chip: StatusChip; children: ReactNode }) {
  return (
    <details className="group relative">
      <summary className={`${CHIP_BASE} ${CHIP_TONE[chip.tone]} cursor-pointer list-none`}>
        <Dot tone={chip.tone} />
        {chip.label}
      </summary>
      <div className="absolute top-[calc(100%+6px)] left-0 z-20 w-90 rounded-md border border-hairline-strong bg-panel-3 p-3 text-sm text-text-2 shadow-menu">
        {children}
      </div>
    </details>
  )
}

/** A chip that takes the eye to the band it is about. */
function ChipAnchor({ chip, href }: { chip: StatusChip; href: string }) {
  return (
    <a className={`${CHIP_BASE} ${CHIP_TONE[chip.tone]} no-underline`} href={href}>
      <Dot tone={chip.tone} />
      {chip.label}
    </a>
  )
}

/** A chip that is only a statement — nothing on this page to open or go to. */
function ChipStatic({ chip }: { chip: StatusChip }) {
  return (
    <span className={`${CHIP_BASE} ${CHIP_TONE[chip.tone]}`}>
      <Dot tone={chip.tone} />
      {chip.label}
    </span>
  )
}

export function StatusStrip({
  artifact,
  currentLap,
  landedSince,
  tickets,
  checks,
  runState,
  verification,
  lap,
  laterLaps,
  readonly,
  driveLap,
  shipped = false,
}: {
  /** The latest COMPLETED review pass, or null when none has finished. */
  artifact: Pick<ReviewArtifactFigure, 'lap'> | null
  currentLap: number
  /** Implementation tickets that landed after that pass — decision 19's stamp. */
  landedSince: number
  tickets: readonly { kind?: TicketKind; status: string; lap?: number }[]
  checks: readonly CheckRow[]
  runState: string
  verification?: { state: 'running' | 'failed'; reason?: string }
  lap: LapChipFigure
  /** The scope this spec deliberately deferred, in the spec's own words. */
  laterLaps: string | null
  readonly: boolean
  /** The lap the branch was last driven in; omit where the strip is not to say. */
  driveLap?: number | null
  /**
   * The shipped record's own strip: the lap chip states what shipped rather than
   * where the feature stands, and the chips are statements — the open-work and
   * full-accounts bands this strip anchors into are not on that page.
   */
  shipped?: boolean
}) {
  const chips = statusChips({
    artifact,
    currentLap,
    landedSince,
    tickets,
    checks: { passed: checks.filter((row) => row.tone === 'ok').length, total: checks.length },
    runState,
    ...(verification ? { verification } : {}),
    ...(driveLap === undefined ? {} : { driveLap }),
    shipped,
  })

  return (
    <div className="flex flex-wrap items-center gap-2">
      {chips.map((chip) => {
        switch (chip.key) {
          case 'drive':
            return <ChipStatic key={chip.key} chip={chip} />
          case 'review':
            return shipped ? (
              <ChipStatic key={chip.key} chip={chip} />
            ) : (
              <ChipAnchor key={chip.key} chip={chip} href="#open-work" />
            )
          case 'run':
            return shipped ? (
              <ChipStatic key={chip.key} chip={chip} />
            ) : (
              <ChipAnchor key={chip.key} chip={chip} href="#full-accounts" />
            )
          case 'checks':
            return (
              <ChipDisclosure key={chip.key} chip={chip}>
                {checks.map((row) => (
                  <CheckLine key={row.key} row={row} />
                ))}
              </ChipDisclosure>
            )
          case 'lap':
            return (
              <ChipDisclosure key={chip.key} chip={chip}>
                {/* Tense-accurate (decision 27a): the past tense only once the
                    lap's own session has actually run. */}
                <div>{lap.story}.</div>
                {lap.promotedFromEarlier > 0 && (
                  <div className="mt-2 text-text-3">
                    Includes {lap.promotedFromEarlier} ticket
                    {lap.promotedFromEarlier === 1 ? '' : 's'} promoted in an earlier lap.
                  </div>
                )}
                {laterLaps && (
                  <div className="mt-4">
                    <div className="text-text-3">
                      {readonly
                        ? `The spec kept this out of lap ${currentLap} on purpose, and it was still deferred when this feature shipped.`
                        : `The spec kept this out of lap ${currentLap} on purpose. Start lap ${currentLap + 1} from the next step to take it on — or ship what landed, if lap ${currentLap} is enough.`}
                    </div>
                    <Markdown source={laterLaps} className="mt-2" />
                  </div>
                )}
              </ChipDisclosure>
            )
        }
      })}
    </div>
  )
}
