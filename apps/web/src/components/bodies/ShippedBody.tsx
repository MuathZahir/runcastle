import type { FeatureFull } from '../../lib/api'
import { useEventLog } from '../../lib/events'
import { shippedQaSessions } from '../../lib/feature-ui'
import { relTime } from '../../lib/format'
import { IconBranch, IconCheck } from '../../icons'
import { SessionPanel } from '../SessionPanel'

/**
 * The shipped phase body (app-redesign): a calm confirmation that the branch is
 * merged. The "merged when" reads from the real activity log (the shipped/merge
 * event); the full history stays in the inspector's activity feed.
 *
 * "Ask a question" is a shipped action, so its terminal joins the hero here —
 * under it, so the confirmation keeps the top of the body. The panel only renders
 * for a Q&A conversation worth showing (see {@link shippedQaSessions}); a shipped
 * feature nobody has asked anything is the hero alone, as it always was.
 */
export function ShippedBody({ full }: { full: FeatureFull }) {
  const events = useEventLog(full.feature.id)
  const merged = [...events]
    .reverse()
    .find((e) => e.type === 'feature.shipped' || e.type === 'merge.conflict' || e.type === 'feature.status')
  const when = merged && merged.type === 'feature.shipped' ? relTime(merged.ts) : ''

  return (
    <div className="shipped-body">
      <div className="shipped-hero">
        <div className="shipped-check">
          <IconCheck size={17} />
        </div>
        <div className="shipped-title">Shipped to main</div>
        <div className="shipped-meta">
          <IconBranch size={12} />
          {full.feature.branch}
          {when ? ` · merged ${when} ago` : ''}
        </div>
        <div className="shipped-sub">
          The branch is merged and the pipeline is complete. The full history lives in the
          Activity tab.
        </div>
      </div>

      <SessionPanel
        featureId={full.feature.id}
        sessions={shippedQaSessions(full.sessions)}
        className="shipped-session"
      />
    </div>
  )
}
