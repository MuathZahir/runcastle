import type { ReactNode } from 'react'
import { NavItem, SectionLabel } from '../ui'
import type { FeatureListItem } from '../lib/api'
import { capLane, type TriageGroup } from '../lib/feature-ui'

/**
 * The sidebar's middle, as markup over resolved data: the pinned
 * {@link InboxLane}, then the {@link WorkLanes}. The `Sidebar` owns the
 * queries and the row menus; these own what is drawn.
 */

/**
 * The Inbox: today's Needs you lane lifted out of the lanes and pinned above
 * them, so what waits on the human is never a click away. Its rows are the
 * feature rows themselves; empty, it is one quiet row.
 */
export function InboxLane({
  features,
  renderRow,
}: {
  features: FeatureListItem[]
  renderRow: (f: FeatureListItem) => ReactNode
}) {
  return (
    <section aria-label="Inbox" className="mb-3 flex flex-col gap-px">
      <SectionLabel count={features.length > 0 ? features.length : undefined} className="px-2.5">
        Inbox
      </SectionLabel>
      {features.length > 0 ? features.map(renderRow) : <NavItem tone="quiet" label="Nothing needs you" />}
    </section>
  )
}

/**
 * Work: every lane but the Inbox's — the Shipped cap with its expander, then
 * the archived toggle.
 */
export function WorkLanes({
  lanes,
  renderRow,
  showAllShipped,
  onToggleShipped,
  archivedCount,
  showArchived,
  onToggleArchived,
}: {
  lanes: TriageGroup[]
  renderRow: (f: FeatureListItem) => ReactNode
  showAllShipped: boolean
  onToggleShipped: () => void
  archivedCount: number
  showArchived: boolean
  onToggleArchived: () => void
}) {
  return (
    <>
      {lanes.map((g) => {
        const lane = capLane(g, showAllShipped)
        return (
          <section key={g.key} aria-label={g.label} className="mb-3 flex flex-col gap-px">
            {/* The lane's true total, capped or not — the count is what the
                lane HOLDS, and the expander says what it is showing. */}
            <SectionLabel count={g.features.length} className="px-2.5">
              {g.label}
            </SectionLabel>
            {lane.visible.map(renderRow)}
            {lane.expanderLabel && <NavItem tone="quiet" label={lane.expanderLabel} onClick={onToggleShipped} />}
          </section>
        )
      })}
      {archivedCount > 0 && (
        <NavItem
          tone="quiet"
          label={showArchived ? 'Hide archived' : 'Show archived'}
          meta={archivedCount}
          onClick={onToggleArchived}
        />
      )}
    </>
  )
}
