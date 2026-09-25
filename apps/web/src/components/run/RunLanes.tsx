import type { ReactNode } from 'react'
import { groupByLap } from '../../lib/feature-ui'
import { laneBands } from '../../lib/feature-ui/run'
import type { LaneBandTicket } from '../../lib/feature-ui/run'
import { LapSections, SectionLabel } from '../../ui'

/**
 * The lanes as a whole: grouped by lap, then banded within each lap
 * (decisions #14b, #14d), as one ruled list.
 *
 * A Burn burns every pending ticket across laps (decision #28a), so a lap-2 run
 * legitimately carries lap-1 leftovers; without the lap headers those arrive
 * unlabelled beside this lap's own work. Inside a lap the bands are what makes
 * a run that grew mid-flight legible — the review lane's fix wave under its own
 * heading, the verification pass after it.
 *
 * Rendering one lane is the caller's job, so this stays free of the run's tRPC
 * reads and of everything a lane needs to know. The caller gets each lane's
 * position down the whole run, for the first render's stagger.
 */
export function RunLanes<T extends LaneBandTicket & { lap: number }>({
  tickets,
  currentLap,
  lane,
}: {
  tickets: readonly T[]
  /** The feature's own lap — what decides whether lap headers show at all. */
  currentLap: number
  /** Renders one lane, keyed by the caller (as the ticket ledger's rows are). */
  lane: (ticket: T, index: number) => ReactNode
}) {
  let position = 0
  return (
    // A container: each lane drops its trailing facts as the column narrows
    // (an open aside), so the title keeps the room.
    <div className="@container flex flex-col border-t border-border-subtle">
      <LapSections
        groups={groupByLap(tickets, currentLap)}
        currentLap={currentLap}
        meta={(g) => `${g.rows.length} lane${g.rows.length === 1 ? '' : 's'}`}
        headClassName="mt-2 px-2"
      >
        {(rows) => (
          <div className="flex flex-col">
            {laneBands(rows).map((band) => (
              <div key={band.kind} className="flex flex-col">
                {band.title && <SectionLabel className="mt-4 px-2">{band.title}</SectionLabel>}
                {band.rows.map((t) => lane(t, position++))}
              </div>
            ))}
          </div>
        )}
      </LapSections>
    </div>
  )
}
