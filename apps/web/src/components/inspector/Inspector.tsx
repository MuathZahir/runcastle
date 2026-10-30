import type { ReactNode } from 'react'
import { trpc } from '../../trpc'
import { useEventLog } from '../../lib/events'
import { useLivePoll } from '../../lib/live'
import { cx, DimLine, Disclosure, Skeleton, SkeletonBar } from '../../ui'
import { IconActivity } from '../../icons'
import { Activity } from './Activity'
import { Knowledge } from './Knowledge'

/**
 * The feature's details, as one of the feature page's panel views
 * (the-feature-s-right-panel decision 9): one column — the feature's facts
 * (`facts`, from the page: the branch, when it started, what it waits on),
 * then its docs, then the activity feed, closed. A doc opened from the list
 * (`onOpenDoc`, its relPath) is read in place by the panel (decision 7).
 *
 * Feature-scoped for real (design-mode decision 5): every part is about one
 * feature, so nothing renders it outside a feature view.
 */
export function DetailsView({
  featureId,
  facts,
  notes,
  onOpenDoc,
}: {
  featureId: string
  facts?: ReactNode
  /**
   * The notes for the agent, under the docs, while the drive has not taken
   * them (the-feature-s-right-panel decision 20); the page passes them only
   * while they are open.
   */
  notes?: ReactNode
  onOpenDoc: (relPath: string) => void
}) {
  const full = trpc.feature.get.useQuery({ id: featureId }, { refetchInterval: useLivePoll() })
  // Mounted here rather than inside Activity, so closing and reopening the
  // section doesn't re-accumulate the feed.
  const events = useEventLog(featureId)

  return (
    <div className="flex flex-col px-6 pt-5 pb-10">
      {facts}
      {full.isLoading ? (
        <DetailsSkeleton />
      ) : !full.data ? (
        // Hard error only when there was NEVER data — a refetch failure after
        // data exists (server restart) keeps the last-good panel rendered; the
        // page's offline line covers the outage story.
        <DimLine>{full.error?.message ?? 'Could not load the details'}</DimLine>
      ) : (
        <Knowledge docs={full.data.docs} onOpen={(doc) => onOpenDoc(doc.relPath)} />
      )}
      {notes && <div className="mt-10">{notes}</div>}
      <Disclosure
        className="mt-10"
        title="Activity" icon={<IconActivity />} aside={events.length > 0 ? String(Math.min(events.length, 50)) : undefined}>
        <Activity events={events} />
      </Disclosure>
    </div>
  )
}

/** Title widths for the placeholder doc rows. */
const SKELETON_ROW_WIDTHS = ['w-28', 'w-20', 'w-32'] as const

/**
 * The details while the feature's first read is in flight: the doc list in
 * placeholder bars, on `ListRow`'s metrics — the doc glyph, the title, the
 * age trailing.
 */
export function DetailsSkeleton() {
  return (
    <Skeleton label="Loading the details…">
      <div className="-mx-2 flex flex-col">
        {SKELETON_ROW_WIDTHS.map((width, i) => (
          <div key={i} className="flex min-h-11 items-center gap-3 px-3" data-skeleton="doc-row">
            <SkeletonBar className="size-4" />
            <SkeletonBar className={cx('h-3', width)} />
            <SkeletonBar className="ml-auto h-2.5 w-12" />
          </div>
        ))}
      </div>
    </Skeleton>
  )
}
