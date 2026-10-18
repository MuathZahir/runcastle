import type { ReactNode } from 'react'
import { laneBands } from '../../lib/feature-ui/run'
import type { LaneBandTicket } from '../../lib/feature-ui/run'
import { SectionLabel } from '../../ui'

/**
 * The lanes as a whole: one round's tickets, banded (decisions #14b, #14d), as
 * one ruled list. A run is one round (decision 16), so there is nothing to
 * group by above the bands — they are what makes a run that grew mid-flight
 * legible: the review lane's fix wave under its own heading, the verification
 * pass after it.
 *
 * Rendering one lane is the caller's job, so this stays free of the run's tRPC
 * reads and of everything a lane needs to know. The caller gets each lane's
 * position down the whole run, for the first render's stagger.
 */
export function RunLanes<T extends LaneBandTicket>({
  tickets,
  lane,
}: {
  tickets: readonly T[]
  /** Renders one lane, keyed by the caller (as the ticket ledger's rows are). */
  lane: (ticket: T, index: number) => ReactNode
}) {
  let position = 0
  return (
    // A container: each lane drops its trailing facts as the column narrows
    // (an open aside), so the title keeps the room.
    <div className="@container flex flex-col border-t border-border-subtle">
      {laneBands(tickets).map((band) => (
        <div key={band.kind} className="flex flex-col">
          {band.title && <SectionLabel className="mt-4 px-2">{band.title}</SectionLabel>}
          {band.rows.map((t) => lane(t, position++))}
        </div>
      ))}
    </div>
  )
}
