import type { FeatureFull } from '../../api'
import { activeSession } from '../gates'
import { resolveDraft } from './draft'
import { resolveHeadlessRun } from './headless'
import type { NextStepContext, ResolverInput } from './resolver-input'
import type { NextStep } from './types'

export * from './chat'
export * from './types'

/**
 * A started feature's step: no per-phase resolver (tickets-and-review-are-tools-not-phases
 * decision 12) — the status line picks the one primary, and Merge & ship, the one
 * transition the human makes, joins the row beside it in every state but shipped.
 */
const PLAIN: NextStep = { kick: 'NEXT STEP', secondary: [], busy: false }

export function nextStep(full: FeatureFull, ctx: NextStepContext): NextStep {
  const { feature, sessions } = full
  const input: ResolverInput = { full, ctx, live: activeSession(sessions) }

  // A parked draft and an archived feature are outside the work.
  if (feature.status === 'draft') return resolveDraft(input)
  if (feature.status === 'archived') {
    return {
      kick: 'ARCHIVED',
      title: 'Feature archived',
      desc: 'This feature is archived and out of the pipeline. Unarchive it to pick the work back up.',
      primary: { label: 'Unarchive', kind: 'unarchive' },
      secondary: [],
      busy: false,
    }
  }

  // A run with no terminal says so in every state, with Stop as its one control.
  return resolveHeadlessRun(input) ?? PLAIN
}
