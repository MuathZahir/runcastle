import type { NextStep } from './types'
import type { ResolverInput } from './resolver-input'

export function resolveSpec(input: ResolverInput): NextStep {
  const { live, resumableGrill, canAdvance } = input
  if (live) {
    return {
      kick: 'GRILL LIVE',
      title: 'Writing the spec',
      desc: 'The spec takes shape beside the conversation — the session advances the phase when it’s written.',
      primary: undefined,
      secondary: [],
      busy: false,
    }
  }
  if (canAdvance) {
    return {
      kick: 'NEXT STEP',
      title: 'Refine the spec, or approve it',
      desc: 'The spec is written — reopen the grill to work on it, or approve it to move into tickets.',
      primary: {
        label: resumableGrill ? 'Resume grill' : 'Open grill',
        kind: 'startGrill',
      },
      secondary: [{ label: 'Approve spec → tickets', kind: 'advance' }],
      busy: false,
    }
  }
  return {
    kick: 'NEXT STEP',
    title: 'Write the spec',
    desc: resumableGrill
      ? 'No spec yet — resume the grill conversation to draft it.'
      : 'No spec yet — open a grill session to draft it.',
    primary: {
      label: resumableGrill ? 'Resume grill' : 'Open grill',
      kind: 'startGrill',
    },
    secondary: [],
    busy: false,
  }
}
