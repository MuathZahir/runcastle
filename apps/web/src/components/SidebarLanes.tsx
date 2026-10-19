import type { ReactNode } from 'react'
import { MAP_UNGROUPED } from '@runcastle/core'
import type { MapGroup } from '@runcastle/core'
import { NavItem, SectionLabel, Tabs } from '../ui'
import type { FeatureListItem } from '../lib/api'
import { capLane, type TriageGroup } from '../lib/feature-ui'
import type { SidebarMode } from '../lib/sidebar-mode'
import { IconCube, IconList } from '../icons'

/**
 * The sidebar's middle, as markup over resolved data (the-map-of-stories-and-
 * scenarios decisions 2, 3): the pinned {@link InboxLane}, the
 * {@link SidebarModeSwitch}, then {@link WorkLanes} or {@link MapTree}. The
 * `Sidebar` owns the queries and the row menus; these own what is drawn.
 */

/**
 * The Inbox: today's Needs you lane lifted out of the lanes and pinned in both
 * modes, so what waits on the human is never a click away. Its rows are the
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

/** The Work | Map switch under the Inbox — the app's tab set, at its small size. */
export function SidebarModeSwitch({
  mode,
  onChange,
}: {
  mode: SidebarMode
  onChange: (mode: SidebarMode) => void
}) {
  return (
    <Tabs<SidebarMode>
      label="Sidebar view"
      size="sm"
      value={mode}
      onChange={onChange}
      className="mb-3 px-0.5"
      items={[
        { id: 'work', label: 'Work' },
        { id: 'map', label: 'Map' },
      ]}
    />
  )
}

/**
 * Work: every lane but the Inbox's, exactly as the rail drew them before the
 * map — the Shipped cap with its expander, then the archived toggle.
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

/** The tree reads only a group's place in it, never its entries. */
export type MapTreeGroup = Pick<MapGroup, 'id' | 'name' | 'parentId'>

/**
 * Map: the explorer tree (decision 3) — Overview, then the product groups in
 * the model's order (parent before children, Ungrouped last), a level-2 group
 * indented under its parent, Ungrouped quiet. The selected row is the open map
 * address: `null` the Overview, a string that group, `undefined` none.
 */
export function MapTree({
  groups,
  selection,
  onOpen,
}: {
  groups: MapTreeGroup[]
  selection: string | null | undefined
  onOpen: (group: string | null) => void
}) {
  return (
    <section aria-label="Map" className="flex flex-col gap-px">
      <NavItem icon={<IconList />} label="Overview" active={selection === null} onClick={() => onOpen(null)} />
      {groups.map((g) =>
        g.id === MAP_UNGROUPED ? (
          <NavItem
            key={g.id}
            tone="quiet"
            label={g.name}
            active={selection === g.id}
            onClick={() => onOpen(g.id)}
          />
        ) : (
          <NavItem
            key={g.id}
            icon={<IconCube />}
            label={g.name}
            active={selection === g.id}
            onClick={() => onOpen(g.id)}
            className={g.parentId ? 'ml-4' : undefined}
          />
        ),
      )}
    </section>
  )
}
