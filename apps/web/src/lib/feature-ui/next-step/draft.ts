import type { NextStep } from './types'
import type { ResolverInput } from './resolver-input'
import { waitingReason } from '../dependencies'
import { SELF_PLAN_ACTION } from './chat'

const DRAFT_BASE_BLOCKED = {
  loading: 'Loading the branch list…',
  unpicked: 'pick a branch first',
} as const

export function resolveDraft({ full, ctx }: ResolverInput): NextStep {
  // Unmerged dependencies outrank a missing base (ADR-0013): picking a branch
  // would not make Start clickable while the draft still waits.
  const blocked =
    waitingReason(full.dependsOn) ?? (ctx.draftBaseMissing ? DRAFT_BASE_BLOCKED[ctx.draftBaseMissing] : null)
  const disabled = blocked ? { disabled: blocked } : {}
  return {
    kick: 'NEXT STEP',
    title: 'Start this feature',
    desc: 'In the backlog — Start cuts its branch, writes the brief, and opens the grill with you. Plan it yourself makes the plan without you.',
    primary: { label: 'Start', kind: 'startDraft', ...disabled },
    // Beside Start, never instead of it (features-plan-themselves decision 12):
    // it starts the draft the same way, so it waits on the same thing.
    secondary: [{ ...SELF_PLAN_ACTION, ...disabled }],
    busy: false,
  }
}
