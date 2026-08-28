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
    <div className="ws-lap" role="note">
      <span className="ws-lap-tag" title={lapExplainer(banner.lap)}>
        LAP {banner.lap}
      </span>
      <div className="ws-lap-body">
        <div className="ws-lap-why">{LAP_KICKOFF}</div>
        <div className="ws-lap-facts">
          {banner.startedAt !== null && <span>started {relTime(banner.startedAt)} ago</span>}
          <span>{banner.landed}</span>
        </div>
      </div>
    </div>
  )
}
