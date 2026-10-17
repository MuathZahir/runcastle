import { isHeadlessRun } from '../session'
import type { ResolverInput } from './resolver-input'
import type { NextStep } from './types'

/**
 * The bar around a run on the feature with no terminal (features-plan-themselves
 * decision 11, whole-cuts-plan-themselves "The page"): while one is up, a working
 * bar whose one control is Stop — there is nothing to chat with, and a chat
 * launch is refused beside it — in whichever state the feature is in.
 *
 * After a `relay` or a lap planning itself that the server said stopped before it
 * was finished, a stopped-short bar whose way on is the chat, until a newer chat
 * of this lap exists. A self-planning run's stopped-short bar is planning's own:
 * it is read off the lap's tickets step, not off the exit.
 */
export function resolveHeadlessRun(input: ResolverInput): NextStep | null {
  const { live, full, ctx } = input
  if (live && isHeadlessRun(live)) {
    const working = WORKING[live.purpose === 'relay' || live.purpose === 'start-lap' ? live.purpose : 'self-plan']
    return {
      ...working,
      primary: { label: 'Stop', kind: 'stopHeadlessRun' },
      secondary: [],
      busy: true,
    }
  }

  const { feature, sessions } = full
  if (live || (feature.phase !== 'planning' && feature.phase !== 'review')) return null
  const latest = sessions.filter((s) => s.kind === 'chat' && s.lap === feature.lap).at(-1)
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
    desc: 'No terminal to watch; the plan appears below as it is written.',
  },
  relay: {
    kick: 'WORKING',
    title: 'Working on a change the orchestrator sent back',
    desc: 'No terminal to watch; the docs and tickets update as it works.',
  },
  'start-lap': {
    kick: 'PLANNING ITSELF',
    title: 'Planning the next lap itself',
    desc: 'No terminal to watch; the lap’s tickets appear below as they are written.',
  },
}

const STOPPED: Record<'relay' | 'start-lap', string> = {
  relay: 'The orchestrator’s change stopped before it was finished',
  'start-lap': 'Planning the next lap stopped before its tickets were ready',
}
