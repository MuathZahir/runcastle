import { isSelfPlanRun } from '../session'
import type { ResolverInput } from './resolver-input'
import type { NextStep } from './types'

/**
 * The bar around a self-planning run (features-plan-themselves decision 11): while
 * one is up, a working bar whose one control is Stop — its thread is an ordinary
 * one to open and watch (chat-as-web-components decision 6) — in whichever state
 * the feature is in. A lead woken by Go or a round's news is an ordinary chat
 * and never reads this way: the status row's Stop is how the lead halts.
 */
export function resolveSelfPlan(input: ResolverInput): NextStep | null {
  const { live } = input
  if (!live || !isSelfPlanRun(live)) return null
  return {
    kick: 'PLANNING ITSELF',
    title: 'Planning itself',
    desc: 'Planning by itself — open the thread to watch; the plan appears below as it is written.',
    primary: { label: 'Stop', kind: 'stopSelfPlan' },
    secondary: [],
    busy: true,
  }
}
