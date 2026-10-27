import { isStoppableHeadlessRun } from '@runcastle/core'
import { isHeadlessRun } from '../session'
import type { ResolverInput } from './resolver-input'
import type { NextStep } from './types'

/**
 * The bar around a run on the feature with no terminal (features-plan-themselves
 * decision 11, whole-cuts-plan-themselves "The page"): while one is up, a working
 * bar whose one control is Stop — its thread is an ordinary one to open and
 * watch (chat-as-web-components decision 6) — in whichever state the feature
 * is in. A lead
 * woken headless is not such a run: it took Go or a round's news, and a Stop
 * that ended it would drop that — the status row's Stop is how the lead halts.
 *
 * After a `relay` or an older `start-lap` run that the server said stopped before it
 * was finished, a stopped-short bar whose way on is the chat, until a newer chat
 * of this feature exists. A self-planning run's stopped-short bar is planning's own:
 * it is read off the tickets step, not off the exit.
 */
export function resolveHeadlessRun(input: ResolverInput): NextStep | null {
  const { live, full, ctx } = input
  if (live && isStoppableHeadlessRun(live)) {
    const working = WORKING[live.purpose === 'relay' || live.purpose === 'start-lap' ? live.purpose : 'self-plan']
    return {
      ...working,
      primary: { label: 'Stop', kind: 'stopHeadlessRun' },
      secondary: [],
      busy: true,
    }
  }

  const { sessions } = full
  if (live) return null
  const latest = sessions.filter((s) => s.kind === 'chat').at(-1)
  if (
    !latest ||
    latest.status !== 'ended' ||
    (latest.purpose !== 'relay' && latest.purpose !== 'start-lap') ||
    !isHeadlessRun(latest) ||
    !ctx.unfinishedRuns?.includes(latest.id)
  )
    return null
  return {
    kick: 'STOPPED',
    title: STOPPED[latest.purpose],
    desc: 'Chat picks up what it had done.',
    primary: { label: 'Resume session', kind: 'chat' },
    secondary: [{ label: 'Merge & ship', kind: 'merge' }],
    busy: false,
  }
}

const WORKING: Record<'self-plan' | 'relay' | 'start-lap', Pick<NextStep, 'kick' | 'title' | 'desc'>> = {
  'self-plan': {
    kick: 'PLANNING ITSELF',
    title: 'Planning itself',
    desc: 'Planning by itself — open the thread to watch; the plan appears below as it is written.',
  },
  relay: {
    kick: 'WORKING',
    title: 'Working on a change the orchestrator sent back',
    desc: 'Working by itself — open the thread to watch; the docs and tickets update as it works.',
  },
  'start-lap': {
    kick: 'PLANNING ITSELF',
    title: 'Planning more work itself',
    desc: 'Planning by itself — open the thread to watch; the new tickets appear below as they are written.',
  },
}

const STOPPED: Record<'relay' | 'start-lap', string> = {
  relay: 'The orchestrator’s change stopped before it was finished',
  'start-lap': 'Planning stopped before its tickets were ready',
}
