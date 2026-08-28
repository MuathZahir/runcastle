import type { NextStep } from './types'
import type { ResolverInput } from './resolver-input'

export function resolveImplementation(input: ResolverInput): NextStep {
  const { live, resumableGrill, ticketCount: t, done, failed, pending, run, running } = input
  if (running) {
    return {
      kick: 'IN PROGRESS',
      title: 'Burning tickets',
      desc: `Burning ${t} ticket${t === 1 ? '' : 's'} — ${done} done${failed ? `, ${failed} failed` : ''}.`,
      primary: { label: 'Cancel run', kind: 'cancelRun', danger: true },
      secondary: [],
      busy: true,
    }
  }
  // Nothing to burn. The bar used to offer an enabled "Burn 0 tickets" over
  // an empty ledger whose own copy said the opposite (findings F25.1) — the
  // tickets phase has always handled this state honestly, so this says the
  // same thing: the missing thing is tickets, and a session emits them.
  if (t === 0) {
    if (live) {
      return {
        kick: 'WAITING',
        title: 'No tickets to burn',
        desc: 'This feature reached the build phase with an empty ledger. The live session breaks the work into tickets — they appear here as they land.',
        primary: undefined,
        secondary: [],
        busy: false,
      }
    }
    return {
      kick: 'WAITING',
      title: 'No tickets to burn',
      desc: 'This feature reached the build phase with an empty ledger. A session breaks the work into tickets — open one, and the burn has something to run.',
      primary: {
        label: resumableGrill ? 'Resume the session' : 'Open a session',
        kind: 'startGrill',
      },
      secondary: [],
      busy: false,
    }
  }
  // Never burned at all — the feature was born here (the quick-change door,
  // decision 21) or crossed G3 by an override. There is nothing to resume,
  // so this is the plain first Burn, worded like the tickets phase's.
  if (!run) {
    return {
      kick: 'NEXT STEP',
      title: pending === 1 ? 'Review & burn the ticket' : 'Review & burn the tickets',
      desc: 'Read the card — edit it if it is not quite right — then burn it into commits.',
      primary: { label: `Burn ${t} ticket${t === 1 ? '' : 's'}`, kind: 'burn' },
      secondary: live ? [] : [{ label: 'Revisit', kind: 'revisit' }],
      busy: false,
    }
  }
  const why =
    run.status === 'failed'
      ? 'The run failed — resume the burn to retry.'
      : run.status === 'cancelled'
        ? 'The run was cancelled — resume the burn to continue.'
        : 'The burn has not started — resume to run the tickets.'
  return {
    kick: 'NEXT STEP',
    title: 'Resume the burn',
    desc: why,
    primary: { label: 'Resume burn', kind: 'burn' },
    // Failed tickets are reset to pending on resume; Revisit instead opens
    // a session to amend docs and edit/cancel tickets before re-burning.
    secondary: live ? [] : [{ label: 'Revisit', kind: 'revisit' }],
    busy: false,
  }
}
