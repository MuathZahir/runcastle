import type { EventRow, Phase } from '@runcastle/core'
import { trpc } from '../../trpc'
import type { FeatureFull, QueryResult, SettingsView } from '../../lib/api'
import { mapDocPath, phaseSessions, type PhaseSessionRow } from '../../lib/feature-ui'
import { fmtDateTime } from '../../lib/format'
import { rosterFromView } from '../../lib/settings'
import { SectionTitle } from '../../ui'
import { ArtifactPane } from './grill/ArtifactPane'
import { MapRail } from './grill/MapRail'
import { TicketLedger } from './tickets/TicketLedger'

/**
 * A phase the human clicked back to, as a frozen record (decision 10). The live
 * view with two buttons hidden is what this replaces: there is no terminal, no
 * session to end, no waypoint to work and no ticket to edit here — only what the
 * phase produced, read off the docs and the feed.
 */
export function PinnedBody({
  full,
  effective,
  events,
  mapRailCollapsed,
  onToggleMapRail,
}: {
  full: FeatureFull
  effective: Extract<Phase, 'ideation' | 'spec' | 'tickets'>
  events: readonly EventRow[]
  mapRailCollapsed: boolean
  onToggleMapRail: () => void
}) {
  if (effective === 'tickets') return <PinnedTickets full={full} />
  if (effective === 'spec') {
    return (
      <div className="flex h-full min-h-0 min-w-0 flex-1">
        <ArtifactPane featureId={full.feature.id} kind="spec" docs={full.docs} mode="static" />
      </div>
    )
  }
  const sessions = phaseSessions({ full, events })
  return (
    <div className="flex h-full min-h-0 min-w-0 flex-1 gap-4">
      {full.feature.mapped && (
        <MapRail full={full} relPath={mapDocPath(full)} collapsed={mapRailCollapsed} onToggle={onToggleMapRail} readonly />
      )}
      <ArtifactPane featureId={full.feature.id} kind="decisions" docs={full.docs} mode="static">
        <SessionList sessions={sessions} />
      </ArtifactPane>
    </div>
  )
}

/**
 * The sessions that shaped the idea, quietly — one row each, with the one thing
 * the session settled when the feed can say it. Nothing here is clickable: a
 * read-only transcript viewer is a later lap.
 */
function SessionList({ sessions }: { sessions: PhaseSessionRow[] }) {
  if (sessions.length === 0) return null
  return (
    <section className="mt-6 border-t border-hairline-soft pt-3">
      <SectionTitle>Sessions · {sessions.length}</SectionTitle>
      <div className="mt-2 flex flex-col gap-1.5">
        {sessions.map((session) => (
          <div key={session.id} className="flex flex-wrap items-baseline gap-2 text-sm">
            <span className="text-text-2">{session.name}</span>
            <span className="font-mono text-xs text-text-4">
              {[
                session.startedAt === undefined ? undefined : fmtDateTime(session.startedAt),
                session.duration,
                session.fact,
              ]
                .filter(Boolean)
                .join(' · ')}
            </span>
          </div>
        ))}
      </div>
    </section>
  )
}

/**
 * The ledger as a record: lap headers, no session strip, no menus and nothing
 * editable. The roster is read for the same reason the live ledger reads it —
 * a ticket's static model chip names the runtime its model runs on — and shares
 * that query key, so this costs no extra fetch.
 */
function PinnedTickets({ full }: { full: FeatureFull }) {
  const settings: QueryResult<SettingsView> = trpc.settings.get.useQuery({
    projectId: full.feature.projectId,
  })
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto">
      <TicketLedger tickets={full.tickets} currentLap={full.feature.lap} roster={rosterFromView(settings.data)} readonly docs={full.docs} />
    </div>
  )
}
