import type { ThreadItem, ToolCall } from '../src/lib/chat-thread'

/**
 * Sample chat for /preview/autopilot-feature.html (epics-on-autopilot
 * decisions 3, 8, 16, 20, 22): the lead of "Checkout page", one of the three
 * features the epic "Checkout flow" runs on autopilot. The epic's lines come
 * in as orchestrator messages; the lead reports back with `hand_back`. Made up.
 */

export const EPIC = { id: 'chat_checkout', title: 'Checkout flow', color: 'violet', icon: 'credit-card' } as const
export const FEATURE = 'Checkout page'
/** What "End autopilot" gives back: every feature the epic runs. */
export const LOCKED_FEATURES = ['Checkout page', 'Saved cards', 'Receipt emails']

export type StateKey = 'locked-working' | 'locked-idle' | 'confirm-end' | 'ended'

export const STATES: { key: StateKey; label: string; hint: string }[] = [
  {
    key: 'locked-working',
    label: 'Locked, working',
    hint: 'The epic runs this feature: no message box, no Stop, Test drive or Merge. The lock note sends you to the epic.',
  },
  { key: 'locked-idle', label: 'Locked, idle', hint: 'The lead told the epic it is ready to test. Still locked: the epic decides what reaches you.' },
  { key: 'confirm-end', label: 'Confirm end', hint: '“End autopilot” from the lock note: it names the epic and the features you get back.' },
  { key: 'ended', label: 'Ended', hint: 'Autopilot is off: one quiet line says so, the message box and the buttons are back.' },
]

let n = 0
const call = (kind: ToolCall['kind'], title: string, status: ToolCall['status'] = 'completed'): ToolCall => ({ id: `c${++n}`, kind, title, status })
const tools = (...calls: ToolCall[]) => ({ kind: 'tools' as const, id: `s${++n}`, calls })

/** A line from the epic: an orchestrator message, which the chat shows under "Epic". */
function fromEpic(id: string, text: string): ThreadItem {
  return {
    kind: 'user',
    id,
    from: 'runcastle',
    text: `From the epic "${EPIC.title}", not the human: ${text}`,
    display: { orchestrator: [{ text }] },
  }
}

/** The chat so far: the epic approved the plan, the lead built, the epic passed on a fact from a sibling. */
const SO_FAR: ThreadItem[] = [
  fromEpic(
    'u1',
    'Your plan is approved: the human handed their decisions to autopilot for this run. Build it, and tell me when it is ready to test.',
  ),
  {
    kind: 'work',
    id: 'w1',
    seconds: 214,
    steps: [
      tools(call('read', 'Read docs/features/checkout-page/plan.md'), call('search', 'Search "OrderSummary"'), call('read', 'Read src/cart/summary.tsx')),
      tools(call('edit', 'Edit src/checkout/OrderSummary.tsx'), call('edit', 'Edit src/checkout/CheckoutPage.tsx'), call('execute', 'Run bun test checkout')),
    ],
  },
  {
    kind: 'agent',
    id: 'a1',
    text: 'The order summary is in: items, shipping and the total, with the coupon line folded under the total. Next is the pay step.',
    turnSeconds: 231,
  },
  fromEpic(
    'u2',
    'Saved cards lands a PaymentMethod type today, in src/payments/methods.ts. Build the pay step on it rather than a type of your own.',
  ),
  {
    kind: 'work',
    id: 'w2',
    seconds: 96,
    steps: [tools(call('read', 'Read src/payments/methods.ts'), call('edit', 'Edit src/checkout/PayStep.tsx'), call('execute', 'Run bun run typecheck'))],
  },
  {
    kind: 'agent',
    id: 'a2',
    text: 'Switched the pay step to `PaymentMethod`. Saved cards show first, then “Add a card”. Writing the tests for an empty wallet now.',
    turnSeconds: 104,
  },
]

/** Working: a turn under way, step by step. */
const LIVE: ThreadItem = {
  kind: 'work',
  id: 'w3',
  seconds: 38,
  live: true,
  steps: [
    tools(call('edit', 'Edit src/checkout/PayStep.test.tsx'), call('execute', 'Run bun test PayStep')),
    tools(call('edit', 'Edit src/checkout/PayStep.tsx', 'in_progress')),
  ],
}

/** Idle: the tests pass, and the lead told its epic, not the human. */
const READY: ThreadItem[] = [
  {
    kind: 'work',
    id: 'w3',
    seconds: 142,
    steps: [
      tools(call('edit', 'Edit src/checkout/PayStep.test.tsx'), call('execute', 'Run bun test PayStep'), call('execute', 'Run bun run typecheck')),
      tools(call('other', 'Hand back to the epic: ready to test')),
    ],
  },
  {
    kind: 'agent',
    id: 'a3',
    text: 'Ready to test. The pay step covers an empty wallet, an expired card and a declined one. I told the epic; it decides when you drive it.',
    turnSeconds: 151,
  },
]

/** Ended: one quiet line, and nothing else: the lead had nothing open to re-ask. */
const ENDED: ThreadItem[] = [{ kind: 'notice', id: 'n1', text: 'Autopilot ended · this feature is yours again' }]

export function itemsFor(state: StateKey): ThreadItem[] {
  if (state === 'locked-working') return [...SO_FAR, LIVE]
  if (state === 'ended') return [...SO_FAR, ...READY, ...ENDED]
  return [...SO_FAR, ...READY]
}
