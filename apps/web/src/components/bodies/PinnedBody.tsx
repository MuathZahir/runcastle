import type { EventRow, Phase } from '@runcastle/core'
import { trpc } from '../../trpc'
import type { FeatureFull, QueryResult, SettingsView } from '../../lib/api'
import { mapDocPath } from '../../lib/feature-ui'
import { rosterFromView } from '../../lib/settings'
import { PageSection } from '../../ui'
import { ArtifactPane } from './grill/ArtifactPane'
import { MapRail } from './grill/MapRail'
import { TicketLedger } from './tickets/TicketLedger'

/**
 * A phase the human clicked back to, as a frozen record (decision 10). The live
 * view with two buttons hidden is what this replaces: there is no terminal, no
 * session to end, no waypoint to work and no ticket to edit here — only what the
 * phase produced, read off the docs and the feed. It reads as a document in
 * the page column: sections separated by air, each with its title.
 */
export function PinnedBody({
  full,
  effective: _effective,
  events: _events,
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
    return <ArtifactPane featureId={full.feature.id} kind="decisions" docs={full.docs} mode="static" />
  }
  return (
    <>
      <PageSection title="Tickets">
        <PinnedTickets full={full} />
      </PageSection>
      {full.feature.mapped && (
        <PageSection title="Map">
          <MapRail
            full={full}
            relPath={mapDocPath(full)}
            collapsed={mapRailCollapsed}
            onToggle={onToggleMapRail}
            readonly
            layout="section"
          />
        </PageSection>
      )}
    </>
  )
}

/**
 * The ledger as a record: lap headers, no session strip, no menus and nothing
 * editable. The roster is read for the same reason the live ledger reads it —
 * a ticket's static model names the runtime its model runs on — and shares
 * that query key, so this costs no extra fetch. Also the page's Tickets view.
 */
export function PinnedTickets({ full }: { full: FeatureFull }) {
  const settings: QueryResult<SettingsView> = trpc.settings.get.useQuery({
    projectId: full.feature.projectId,
  })
  return (
    <TicketLedger
      tickets={full.tickets}
      currentLap={full.feature.lap}
      roster={rosterFromView(settings.data)}
      readonly
      docs={full.docs}
    />
  )
}
