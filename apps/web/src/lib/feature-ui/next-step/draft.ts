import type { NextStep } from './types'
import type { ResolverInput } from './resolver-input'

const DRAFT_BASE_BLOCKED = {
  loading: 'Loading the branch list…',
  unpicked: 'Pick the branch to fork from under Advanced below.',
} as const

export function resolveDraft({ ctx }: ResolverInput): NextStep {
return {
  kick: 'NEXT STEP',
  title: 'Start this feature',
  desc: 'Parked as a draft — Start cuts its branch, writes the brief, and opens the grill session.',
  primary: {
    label: 'Start',
    kind: 'startDraft',
    ...(ctx.draftBaseMissing
      ? { disabled: DRAFT_BASE_BLOCKED[ctx.draftBaseMissing] }
      : {}),
  },
  secondary: [],
  busy: false,
}
}

