import type { NextStep } from './types'
import type { ResolverInput } from './resolver-input'

export function resolveShipped(_input: ResolverInput): NextStep {
  return {
    kick: 'SHIPPED',
    title: 'Shipped to main',
    desc: 'The branch is merged and the pipeline is complete. Ask a question anytime.',
    primary: undefined,
    secondary: [{ label: 'Ask a question', kind: 'askQuestions' }],
    busy: false,
  }
}
