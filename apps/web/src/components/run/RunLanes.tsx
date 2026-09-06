import type { ReactNode } from 'react'
import { groupByLap } from '../../lib/feature-ui'
import { laneBands } from '../../lib/feature-ui/run'
import type { LaneBandTicket } from '../../lib/feature-ui/run'
import { LapSections, SectionTitle } from '../../ui'

/**
 * The lanes as a whole: grouped by lap, then banded within each lap
 * (decisions #14b, #14d).
 *
 * A Burn burns every pending ticket across laps (decision #28a), so a lap-2 run
 * legitimately carries lap-1 leftovers; without the lap headers those arrive
 * unlabelled beside this lap's own work. Inside a lap the bands are what makes
 * a run that grew mid-flight legible — the review lane's fix wave indented
 * under its own header, the verification pass after it.
 *
 * Rendering one lane is the caller's job, so this stays free of the run's tRPC
 * reads and of everything a lane needs to know.
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
  lane: (ticket: T) => ReactNode
}) {
  return (
    <LapSections
      groups={groupByLap(tickets, currentLap)}
      currentLap={currentLap}
      meta={(g) => `${g.rows.length} lane${g.rows.length === 1 ? '' : 's'}`}
    >
      {(rows) => (
        <div className="flex flex-col gap-2">
          {laneBands(rows).map((band) => (
            <div key={band.kind} className="flex flex-col gap-2">
              {band.title && (
                <div className="mt-2 border-l-2 border-ph-review/40 pl-3">
                  <SectionTitle>{band.title}</SectionTitle>
                </div>
              )}
              <div className={`flex flex-col gap-2${band.kind === 'plain' ? '' : ' pl-3'}`}>
                {band.rows.map(lane)}
              </div>
            </div>
          ))}
        </div>
      )}
    </LapSections>
  )
}
