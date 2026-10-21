import { useState } from 'react'
import { trpc } from '../../trpc'
import { useEventLog } from '../../lib/events'
import { useLivePoll } from '../../lib/live'
import { cx, DimLine, Skeleton, SkeletonBar, Tabs } from '../../ui'
import { IconActivity, IconDoc } from '../../icons'
import { Activity } from './Activity'
import { Knowledge } from './Knowledge'

type Tab = 'knowledge' | 'activity'

const TABS = [
  { id: 'knowledge' as const, label: 'Knowledge', icon: <IconDoc /> },
  { id: 'activity' as const, label: 'Activity', icon: <IconActivity /> },
]

/**
 * The feature's details, as one of the feature page's panel views
 * (design-mode decision 5): Knowledge — the docs the sessions write — and
 * Activity — the event feed — switched by Tabs at the view's top. The panel
 * around it holds the header and the close.
 *
 * Feature-scoped for real (decision 5): every panel in here is about one
 * feature, so nothing renders it outside a feature view.
 */
export function DetailsView({ featureId }: { featureId: string }) {
  const [tab, setTab] = useState<Tab>('knowledge')
  const full = trpc.feature.get.useQuery({ id: featureId }, { refetchInterval: useLivePoll() })
  // One feed for both tabs, mounted here rather than inside Activity so
  // switching tabs doesn't re-accumulate it.
  const events = useEventLog(featureId)

  return (
    <div className="flex flex-col gap-4 px-4 py-4">
      <Tabs items={TABS} value={tab} onChange={setTab} size="sm" label="Details" className="self-start" />
      {full.isLoading ? (
        <DetailsSkeleton />
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
    </div>
  )
}

/** Title widths for the placeholder doc rows. */
const SKELETON_ROW_WIDTHS = ['w-28', 'w-20', 'w-32'] as const

/**
 * The details while the feature's first read is in flight: the Knowledge
 * tab's doc list in placeholder bars, on `ListRow`'s metrics — the doc glyph,
 * the title, the file name trailing.
 */
export function DetailsSkeleton() {
  return (
    <Skeleton label="Loading the details…">
      <div className="-mx-2 flex flex-col">
        {SKELETON_ROW_WIDTHS.map((width, i) => (
          <div key={i} className="flex min-h-10 items-center gap-3 px-3" data-skeleton="doc-row">
            <SkeletonBar className="size-4" />
            <SkeletonBar className={cx('h-3', width)} />
            <SkeletonBar className="ml-auto h-2.5 w-16" />
          </div>
        ))}
      </div>
    </Skeleton>
  )
}
