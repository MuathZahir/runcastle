import type { LapBanner } from '../../lib/feature-ui'
import { relTime } from '../../lib/format'
import { LAP_KICKOFF, lapExplainer } from '../../lib/vocabulary'

/**
 * The lap banner (decisions.md #6) — from lap 2 on, under the workspace header:
 * which lap this is, what put the feature on it, and what the lap before it
 * landed. The user reported not knowing there WAS another lap; every surface
 * below this line is lap-scoped, so the line that says which lap comes first.
 *
 * Never rendered on lap 1 (the caller checks): no iteration ceremony on a
 * feature that merges first try, the same stance as the pipeline's lap chip.
 */
export function LapBannerRow({ banner }: { banner: LapBanner }) {
  return (
    <div className="flex items-start gap-3 border-b border-hairline bg-panel-2 px-6 py-3" role="note">
      <span
        className="shrink-0 cursor-default rounded-sm border border-accent-line px-1.5 py-0.5 font-mono text-[10.5px] tracking-wider text-accent-2"
        title={lapExplainer(banner.lap)}
      >
        LAP {banner.lap}
      </span>
      <div className="flex min-w-0 flex-col gap-0.5">
        <div className="text-sm text-text-2">{LAP_KICKOFF}</div>
        <div className="font-mono text-xs text-text-3">
          {[
            banner.startedAt === null ? undefined : `started ${relTime(banner.startedAt)} ago`,
            banner.landed,
          ]
            .filter(Boolean)
            .join(' · ')}
        </div>
      </div>
    </div>
  )
}
