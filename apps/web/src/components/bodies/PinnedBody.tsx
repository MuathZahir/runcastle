import type { EventRow, Phase } from '@runcastle/core'
import { trpc } from '../../trpc'
import type { FeatureFull, QueryResult, SettingsView } from '../../lib/api'
import { mapDocPath } from '../../lib/feature-ui'
import { rosterFromView } from '../../lib/settings'
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
  effective: Extract<Phase, 'planning'>
  events: readonly EventRow[]
  mapRailCollapsed: boolean
  onToggleMapRail: () => void
}) {
  if (full.tickets.length === 0) {
    return (
      <div className="flex h-full min-h-0 min-w-0 flex-1">
        <ArtifactPane featureId={full.feature.id} kind="decisions" docs={full.docs} mode="static" />
      </div>
    )
  }
  return (
    <div className="flex h-full min-h-0 min-w-0 flex-1 gap-4">
      {full.feature.mapped && (
        <MapRail full={full} relPath={mapDocPath(full)} collapsed={mapRailCollapsed} onToggle={onToggleMapRail} readonly />
      )}
      <PinnedTickets full={full} />
    </div>
  )
}

/**
 * The sessions that shaped the idea, quietly — one row each, with the one thing
 * the session settled when the feed can say it. Nothing here is clickable: a
 * read-only transcript viewer is a later lap.
 */
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
