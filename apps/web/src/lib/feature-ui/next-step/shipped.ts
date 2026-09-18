import { CHAT_ACTION } from './chat'
import type { NextStep } from './types'
import type { ResolverInput } from './resolver-input'

export function resolveShipped(_input: ResolverInput): NextStep {
  return {
    kick: 'SHIPPED',
    title: 'Shipped to main',
    desc: 'The branch is merged and the pipeline is complete. The chat is still here — ask it anything, or draft the next lap.',
    primary: undefined,
    secondary: [CHAT_ACTION],
    busy: false,
  }
}
