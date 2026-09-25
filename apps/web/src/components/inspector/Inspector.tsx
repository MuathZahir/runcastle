import { useState } from 'react'
import { trpc } from '../../trpc'
import { useEventLog } from '../../lib/events'
import { useLivePoll } from '../../lib/live'
import { Aside, DimLine, Loading, Tabs } from '../../ui'
import { IconActivity, IconDoc } from '../../icons'
import { Activity } from './Activity'
import { Knowledge } from './Knowledge'

type Tab = 'knowledge' | 'activity'

const TABS = [
  { id: 'knowledge' as const, label: 'Knowledge', icon: <IconDoc /> },
  { id: 'activity' as const, label: 'Activity', icon: <IconActivity /> },
]

/**
 * The feature's details, as the page's one right-hand aside (DESIGN.md
 * principle 1): Knowledge — the docs the sessions write — and Activity — the
 * event feed — switched by Tabs in the aside's own header. It shares the slot
 * with the feature chat: opening one closes the other, and neither is a
 * permanent rail.
 *
 * Feature-scoped for real (decision 5): every panel in here is about one
 * feature, so nothing renders it outside a feature view — and it is the
 * feature page that mounts it, in its own aside slot, with `onClose`. Mounted
 * without one (the retired shell-level rail), it renders nothing, so a
 * second details panel can never stand beside the page's own.
 */
export function Inspector({ featureId, onClose }: { featureId: string; onClose?: () => void }) {
  if (!onClose) return null
  return <InspectorAside featureId={featureId} onClose={onClose} />
}

function InspectorAside({ featureId, onClose }: { featureId: string; onClose: () => void }) {
  const [tab, setTab] = useState<Tab>('knowledge')
  const full = trpc.feature.get.useQuery({ id: featureId }, { refetchInterval: useLivePoll() })
  // One feed for both tabs, mounted here rather than inside Activity so
  // switching tabs doesn't re-accumulate it.
  const events = useEventLog(featureId)

  return (
    <Aside
      label="Details"
      title={<Tabs items={TABS} value={tab} onChange={setTab} size="sm" label="Details" />}
      onClose={onClose}
      bodyClassName="px-4 py-4"
    >
      {full.isLoading ? (
        <Loading>Loading…</Loading>
      ) : !full.data ? (
        // Hard error only when there was NEVER data — a refetch failure after
        // data exists (server restart) keeps the last-good panel rendered; the
        // page's offline line covers the outage story.
        <DimLine>{full.error?.message ?? 'Could not load the details'}</DimLine>
      ) : (
        <div key={tab} role="tabpanel" aria-label={tab === 'knowledge' ? 'Knowledge' : 'Activity'} className="animate-fade-in">
          {tab === 'knowledge' ? (
            <Knowledge featureId={featureId} docs={full.data.docs} />
          ) : (
            <Activity events={events} />
          )}
        </div>
      )}
    </Aside>
  )
}
