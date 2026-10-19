import type { Meta, StoryObj } from '@storybook/react-vite'
import { MAP_UNGROUPED } from '../../../packages/core/src/map'
import { FeatureRow } from '../../../apps/web/src/components/Sidebar'
import {
  InboxLane,
  MapTree,
  SidebarModeSwitch,
  WorkLanes,
  type MapTreeGroup,
} from '../../../apps/web/src/components/SidebarLanes'
import type { FeatureListItem } from '../../../apps/web/src/lib/api'
import { sidebarLanes } from '../../../apps/web/src/lib/feature-ui'
import type { SidebarMode } from '../../../apps/web/src/lib/sidebar-mode'
import { listItem } from '../../../apps/web/test/fixtures'

const feature = (id: string, title: string, over: Partial<FeatureListItem> = {}): FeatureListItem => ({
  ...listItem({ id, ...over }),
  title,
})

const FEATURES = [
  feature('coupons', 'Coupons', { phase: 'review' }),
  feature('guest', 'Guest checkout', { phase: 'planning' }),
  feature('reset', 'Password reset', { phase: 'building', activeRun: true }),
  feature('history', 'Order history', { phase: 'building' }),
  feature('gifts', 'Gift cards', { status: 'draft' }),
  feature('addresses', 'Saved addresses', { status: 'shipped', phase: 'shipped' }),
]

const GROUPS: MapTreeGroup[] = [
  { id: 'auth', name: 'Auth' },
  { id: 'checkout', name: 'Checkout' },
  { id: 'checkout/coupons', name: 'Coupons', parentId: 'checkout' },
  { id: 'checkout/payment', name: 'Payment', parentId: 'checkout' },
  { id: MAP_UNGROUPED, name: 'Ungrouped' },
]

const row = (f: FeatureListItem) => (
  <FeatureRow key={f.id} f={f} active={false} onSelect={() => undefined} actions={[]} />
)

/**
 * The sidebar's middle as the Sidebar draws it: the pinned Inbox, the
 * Work | Map switch, then the Work lanes or the Map tree.
 */
function InboxAndSwitch({
  features,
  mode,
  mapSelection,
}: {
  features: FeatureListItem[]
  mode: SidebarMode
  mapSelection?: string | null
}) {
  const { inbox, lanes } = sidebarLanes(features)
  return (
    <div className="flex w-(--sidebar-w) flex-col p-2">
      <InboxLane features={inbox} renderRow={row} />
      <SidebarModeSwitch mode={mode} onChange={() => undefined} />
      {mode === 'work' ? (
        <WorkLanes
          lanes={lanes}
          renderRow={row}
          showAllShipped={false}
          onToggleShipped={() => undefined}
          archivedCount={0}
          showArchived={false}
          onToggleArchived={() => undefined}
        />
      ) : (
        <MapTree groups={GROUPS} selection={mapSelection} onOpen={() => undefined} />
      )}
    </div>
  )
}

/** The Inbox pinned above the Work | Map switch, in either mode. */
const meta = {
  title: 'Sidebar/InboxAndSwitch',
  component: InboxAndSwitch,
  args: { features: FEATURES, mode: 'work' },
} satisfies Meta<typeof InboxAndSwitch>

export default meta
type Story = StoryObj<typeof meta>

/** Work: the Inbox's waiting rows, then the remaining lanes. */
export const WorkMode: Story = {}

/** Nothing waits on the human: the Inbox is one quiet row. */
export const NothingNeedsYou: Story = {
  args: { features: FEATURES.filter((f) => f.id !== 'coupons' && f.id !== 'guest') },
}

/** Map: the group tree, two levels deep, with a level-2 group open. */
export const MapModeWithSelectedGroup: Story = {
  args: { mode: 'map', mapSelection: 'checkout/coupons' },
}
