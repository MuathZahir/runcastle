import type { DrivePrerequisite } from '../../lib/api'
import { Notice } from './Notice'

/**
 * Why a review on this machine cannot drive, standing under the Review row
 * BEFORE the next burn — the trail only says so after a pass has run Gates
 * (review-as-a-lap-trail decision 8). One line naming each missing piece and
 * what to do about it; the review's own prose is the tooltip. Nothing when
 * every piece is present.
 */
export function DrivePrerequisitesNotice({ missing }: { missing: readonly DrivePrerequisite[] }) {
  if (missing.length === 0) return null
  return (
    <Notice
      tone="warning"
      role="status"
      title={
        <span title={missing.map((m) => m.reason).join('; ')}>
          Walkthrough videos off on this machine: {missing.map((m) => m.notice).join('; ')}
        </span>
      }
    />
  )
}
