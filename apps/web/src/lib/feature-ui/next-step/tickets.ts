import type { NextStep } from './types'
import type { ResolverInput } from './resolver-input'

export function resolveTickets(input: ResolverInput): NextStep {
  const { live, resumableGrill, ticketCount: t } = input
  if (t > 0) {
    return {
      kick: 'NEXT STEP',
      title: 'Review & burn the tickets',
      // "the agent", not a runtime: each ticket may carry its own model
      // (decision 4), so this batch can span both runtimes.
      desc: 'Each ticket is one atomic task the agent will implement. Review them, then burn.',
      // Burn stays primary even while a session is live: `emit_tickets` lands
      // one batch, so a non-zero count means the cards are ready to review.
      primary: { label: `Burn ${t} ticket${t === 1 ? '' : 's'}`, kind: 'burn' },
      // Revisit resumes the grilling conversation to amend docs/tickets —
      // only offered when no session is live (one terminal per feature).
      secondary: live ? [] : [{ label: 'Revisit', kind: 'revisit' }],
      busy: false,
    }
  }
  if (live) {
    return {
      kick: 'WAITING',
      title: 'Emitting tickets',
      desc: 'The session breaks the spec into tickets — they appear here as they land.',
      primary: undefined,
      secondary: [],
      busy: false,
    }
  }
  return {
    kick: 'WAITING',
    title: 'Waiting for tickets',
    desc: 'No tickets yet — a grill session emits them. Open a session to shape the work.',
    primary: {
      label: resumableGrill ? 'Resume grill to emit tickets' : 'Open grill to emit tickets',
      kind: 'startGrill',
    },
    secondary: [],
    busy: false,
  }
}
