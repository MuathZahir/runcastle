import { PHASE_ORDER } from '../../lib/feature-ui'
import { Page, PageTopbar, Skeleton, SkeletonBar, cx } from '../../ui'

/** Label and value widths for the summary rows: Review · Tickets · Test drive. */
const SUMMARY_ROWS = [
  ['w-12', 'w-40'],
  ['w-12', 'w-32'],
  ['w-16', 'w-24'],
] as const

/**
 * The feature page while its first read is in flight: the page's own shape in
 * a {@link Skeleton} — the crumb, the title, the branch line, one step per
 * phase, and the summary rows — laid out on the same metrics as
 * `FeatureHeader` and `PropertyList`, so the real page lands where the bars
 * were.
 */
export function FeatureSkeleton() {
  return (
    <>
      <PageTopbar
        leading={
          <Skeleton>
            <SkeletonBar className="h-3 w-40" />
          </Skeleton>
        }
      />
      <Page>
        <Skeleton label="Loading feature…">
          <div className="flex h-7 items-center" data-skeleton="title">
            <SkeletonBar className="h-5 w-2/5" />
          </div>
          <div className="mt-2 flex h-4 items-center gap-1.5" data-skeleton="branch">
            <SkeletonBar className="size-3.5" />
            <SkeletonBar className="h-2.5 w-64" />
          </div>
          <div className="mt-5 -ml-2 flex items-center gap-x-0.5">
            {PHASE_ORDER.map((phase, i) => (
              <div key={phase} className="flex items-center gap-x-0.5">
                {i > 0 && <span className="mx-0.5 h-px w-3 bg-border-subtle" />}
                <div className="flex h-(--control-sm) items-center gap-1.5 px-2" data-skeleton="step">
                  <SkeletonBar className="size-3.5 rounded-full" />
                  <SkeletonBar className="h-2.5 w-14" />
                </div>
              </div>
            ))}
          </div>
          <div className="mt-10 grid grid-cols-[max-content_minmax(0,1fr)] gap-x-6 gap-y-1.5">
            {SUMMARY_ROWS.map(([label, value], i) => (
              <div key={i} className="contents" data-skeleton="row">
                <div className="flex min-h-6 items-center">
                  <SkeletonBar className={cx('h-3', label)} />
                </div>
                <div className="flex min-h-6 items-center">
                  <SkeletonBar className={cx('h-3', value)} />
                </div>
              </div>
            ))}
          </div>
        </Skeleton>
      </Page>
    </>
  )
}
