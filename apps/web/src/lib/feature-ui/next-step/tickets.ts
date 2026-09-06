import { hasResumable } from '../internal'
import type { ResolverInput } from './resolver-input'
import type { NextStep } from './types'

export function resolveTickets(input: ResolverInput): NextStep {
  const { full, live, lapTicketCount: count } = input
  if (count > 0) return {
    kick: 'NEXT STEP',
    title: 'Review the tickets, then burn',
    desc: `${count} ticket${count === 1 ? '' : 's'} for this lap. Each one runs as its own sandboxed agent, in parallel, committing to the feature branch. Set a model per ticket, or for all of them, before you burn.`,
    primary: { label: `Burn ${count} ticket${count === 1 ? '' : 's'}`, kind: 'burn' },
    secondary: live ? [] : [{ label: 'Ask for changes', kind: 'revisit', hint: 'Open a session to change the tickets before burning' }],
    busy: false,
  }
  if (live) return step('WAITING', 'Emitting tickets', 'The session is breaking the spec into tickets. They appear below as they land; review them, then burn.')
  const resumable = hasResumable(full.sessions, 'ideation') || hasResumable(full.sessions, 'converge')
  return step('WAITING', 'Waiting for tickets', 'No tickets yet — a session breaks the spec into them.', { label: resumable ? 'Resume session' : 'Start session', kind: 'startGrill' })
}

function step(kick: string, title: string, desc: string, primary?: NextStep['primary']): NextStep {
  return { kick, title, desc, primary, secondary: [], busy: false }
}
