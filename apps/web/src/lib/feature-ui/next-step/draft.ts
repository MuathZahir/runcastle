import type { NextStep } from './types'
import type { ResolverInput } from './resolver-input'
import { waitingReason } from '../dependencies'

const DRAFT_BASE_BLOCKED = {
  loading: 'Loading the branch list…',
  unpicked: 'pick a branch first',
} as const

export function resolveDraft({ full, ctx }: ResolverInput): NextStep {
  // Unmerged dependencies outrank a missing base (ADR-0013): picking a branch
  // would not make Start clickable while the draft still waits.
  const blocked =
    waitingReason(full.dependsOn) ?? (ctx.draftBaseMissing ? DRAFT_BASE_BLOCKED[ctx.draftBaseMissing] : null)
  return {
    kick: 'NEXT STEP',
    title: 'Start this feature',
    desc: 'Parked as a draft — Start cuts its branch, writes the brief, and opens the ideation session.',
    primary: {
      label: 'Start',
      kind: 'startDraft',
      ...(blocked ? { disabled: blocked } : {}),
    },
    secondary: [],
    busy: false,
  }
}
