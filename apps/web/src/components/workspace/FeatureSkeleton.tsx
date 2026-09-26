import { PHASE_ORDER } from '../../lib/feature-ui'
import { Page, PageTopbar, cx } from '../../ui'

/** The shared loading state's wait: a fast load shows nothing at all. */
const DELAYED = 'animate-fade-in [animation-delay:300ms]'

/** One placeholder bar; the caller gives it its size and shape. */
function Bone({ className }: { className: string }) {
  return <span className={cx('block shrink-0 rounded-sm bg-surface-selected', className)} />
}

/** Label and value widths for the summary rows: Review · Checks · Test drive · Tickets · Laps. */
const SUMMARY_ROWS = [
  ['w-12', 'w-28'],
  ['w-12', 'w-40'],
  ['w-16', 'w-24'],
  ['w-12', 'w-32'],
  ['w-10', 'w-6'],
] as const

/**
 * The feature page while its first read is in flight: the page's own shape in
 * quiet placeholder bars — the crumb, the title, the branch line, one step per
 * phase, and the summary rows — laid out on the same metrics as
 * `FeatureHeader` and `PropertyList`, so the real page lands where the bars
 * were. Like `Loading`, it waits 300ms before fading in. The bars' breathing
 * is the page's only progress indicator, so each breathing element is marked
 * `data-progress` and keeps a slow pulse under reduced motion (`theme.css`).
 */
export function FeatureSkeleton() {
  return (
    <>
      <PageTopbar
        leading={
          <span aria-hidden="true" className={DELAYED}>
            <span data-progress="" className="block animate-breathe">
              <Bone className="h-3 w-40" />
            </span>
          </span>
        }
      />
      <Page>
        <div role="status" className={DELAYED}>
          <span className="sr-only">Loading feature…</span>
          <div aria-hidden="true" data-progress="" className="animate-breathe">
            <div className="flex h-7 items-center" data-skeleton="title">
              <Bone className="h-5 w-2/5" />
            </div>
            <div className="mt-2 flex h-4 items-center gap-1.5" data-skeleton="branch">
              <Bone className="size-3.5" />
              <Bone className="h-2.5 w-64" />
            </div>
            <div className="mt-5 -ml-2 flex items-center gap-x-0.5">
              {PHASE_ORDER.map((phase, i) => (
                <div key={phase} className="flex items-center gap-x-0.5">
                  {i > 0 && <span className="mx-0.5 h-px w-3 bg-border-subtle" />}
                  <div className="flex h-(--control-sm) items-center gap-1.5 px-2" data-skeleton="step">
                    <Bone className="size-3.5 rounded-full" />
                    <Bone className="h-2.5 w-14" />
                  </div>
                </div>
              ))}
            </div>
            <div className="mt-10 grid grid-cols-[max-content_minmax(0,1fr)] gap-x-6 gap-y-1.5">
              {SUMMARY_ROWS.map(([label, value], i) => (
                <div key={i} className="contents" data-skeleton="row">
                  <div className="flex min-h-6 items-center">
                    <Bone className={cx('h-3', label)} />
                  </div>
                  <div className="flex min-h-6 items-center">
                    <Bone className={cx('h-3', value)} />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </Page>
    </>
  )
}
