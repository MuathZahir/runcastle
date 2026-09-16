import { hasResumable } from '../internal'
import { burnWarningLine } from './burn-warnings'
import type { ResolverInput } from './resolver-input'
import type { NextStep } from './types'

export function resolveTickets(input: ResolverInput): NextStep {
  const { full, live, lapTicketCount: count } = input
  const { feature } = full
  // Tickets land before the session is done with them: it emits placeholder
  // contexts and enriches each afterwards, so the ledger on screen is not yet
  // what a burn would run. The server refuses the click until
  // `complete_phase(tickets)` stamps the lap — this only reflects that, and
  // reflects its escape hatch too: with no session alive there is nothing left
  // to race, so the button arms as it always did.
  const ready = feature.ticketsReadyLap === feature.lap || !live
  if (count > 0 && !ready) return step('WAITING', 'Finishing the tickets', 'The session is finishing the tickets — enriching them, then closing out the phase. Burn arms the moment it does.')
  // The other road into a burn reads the shape of what it would run — and what
  // the docs digest will cost every ticket in it — in the same words the build
  // phase's bar uses (`burn-warnings.ts`). A session that left a ticket with
  // nothing in its context is the same problem as a quick change that arrived
  // with nothing in any of them, and docs grown past the budget are paid by both
  // roads alike. A warning only: the Burn below is unchanged, and "Ask for
  // changes" is the road to fixing it.
  const shape = burnWarningLine(input)
  if (count > 0) return {
    kick: 'NEXT STEP',
    title: 'Review the tickets, then burn',
    desc: `${count} ticket${count === 1 ? '' : 's'} for this lap. Each one runs as its own sandboxed agent, in parallel, committing to the feature branch. Set a model per ticket, or for all of them, before you burn.`,
    primary: { label: `Burn ${count} ticket${count === 1 ? '' : 's'}`, kind: 'burn' },
    secondary: live ? [] : [{ label: 'Ask for changes', kind: 'revisit', hint: 'Open a session to change the tickets before burning' }],
    busy: false,
    ...(shape ? { note: shape } : {}),
  }
  if (live) return step('WAITING', 'Emitting tickets', 'The session is breaking the spec into tickets. They appear below as they land; review them, then burn.')
  const resumable = hasResumable(full.sessions, 'ideation') || hasResumable(full.sessions, 'converge')
  return step('WAITING', 'Waiting for tickets', 'No tickets yet — a session breaks the spec into them.', { label: resumable ? 'Resume session' : 'Start session', kind: 'startGrill' })
}

function step(kick: string, title: string, desc: string, primary?: NextStep['primary']): NextStep {
  return { kick, title, desc, primary, secondary: [], busy: false }
}
