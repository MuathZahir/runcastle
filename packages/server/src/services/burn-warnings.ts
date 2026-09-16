import type { ReviewFinding } from '@runcastle/core'
import type { AppCtx } from '../db/types'
import { hasPlanningDoc } from './planning'
import { getFeatureRow } from './repo'
import { undispositionedDefects } from './review-findings'
import { pendingTickets } from './tickets'

/**
 * What the human reads before clicking Burn — and what the ticket-writing
 * session hears from `complete_phase("tickets")` while it is still alive to act
 * on it (decisions §5).
 *
 * Every line here was a REFUSAL before the four-state collapse: the G3
 * review-ticket rule, the un-dispositioned earlier-lap defects rule, and the G2
 * spec file check. They are warnings now, computed server-side so the Burn
 * dialog never re-derives policy, and the button behind them stays enabled —
 * the friction is reading, never a locked door. The only two things that still
 * refuse a burn are physics: a run already burning this feature, and git safety.
 *
 * Deliberately NOT a warning: a feature with nothing pending to burn. That is a
 * no-op rather than a risk, so the Burn click is simply not offered and the
 * next-step bar asks for tickets instead.
 */
export function burnWarnings(ctx: AppCtx, featureId: string): string[] {
  const feature = getFeatureRow(ctx, featureId)
  const warnings: string[] = []

  // The one-review-ticket rule (CONTEXT.md decision #8), as a warning. A batch
  // that ships without one reaches review with nobody having looked at it —
  // silently, which is what makes it worth saying out loud.
  if (!pendingTickets(ctx, featureId).some((ticket) => ticket.kind === 'review')) {
    warnings.push(
      'no review ticket in this batch — every lap closes with one (kind: "review"). Without it ' +
        'the lap reaches review with nobody having looked at the work.',
    )
  }

  // The lap boundary's own seatbelt, downgraded from the refusal it was: lap
  // N+1 fixing a defect without telling the finding row is how the human ends
  // up clicking Iterate over a defect that no longer exists.
  const undispositioned = undispositionedDefects(ctx, featureId)
  if (undispositioned.length > 0) warnings.push(undispositionedWarning(undispositioned))

  if (!hasPlanningDoc(ctx, feature, 'spec.md')) {
    warnings.push('no spec.md on disk — this lap will burn tickets that no written spec backs.')
  }

  return warnings
}

function undispositionedWarning(defects: readonly ReviewFinding[]): string {
  const titles = defects.map((defect) => `"${defect.title}"`).join(', ')
  return (
    `${defects.length} defect${defects.length === 1 ? '' : 's'} from an earlier lap ${
      defects.length === 1 ? 'is' : 'are'
    } still un-dispositioned: ${titles} — for each, either emit this lap's ticket for it with ` +
    '`originFindingId` set (link), or call `resolve_finding` to carry it or close it as ' +
    'addressed. The human can also dismiss it from the review page.'
  )
}
