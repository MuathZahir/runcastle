import { burnLabel } from '../laps'
import { burnExpectation } from '../run'
import type { NextStep } from './types'
import type { ResolverInput } from './resolver-input'

export function resolveImplementation(input: ResolverInput): NextStep {
  const {
    full,
    ctx,
    live,
    resumableGrill,
    ticketCount: t,
    done,
    failed,
    pending,
    pendingTickets,
    run,
    running,
  } = input
  // What the burn is about to cost, from this project's finished tickets
  // (decision #16b). Said on both roads into a burn — the first one and the
  // resume — because the human is answering the same question at both.
  const expectation = burnExpectation(ctx.burnStats)
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
      desc: `Read the card — edit it if it is not quite right — then burn it into commits. ${expectation}`,
      // Whose tickets these are, when laps mix (decision 28a) — the burn takes
      // every pending ticket on the branch, and the count alone never said so.
      primary: { label: burnLabel(pendingTickets, full.feature.lap), kind: 'burn' },
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
  // The honest partial-completion exit (decision #11b). Every lane is terminal
  // and something landed, which is exactly what G4 already believes — so rather
  // than leaving a permanently-failing ticket looping on Retry behind the
  // gate's scary generic override, the step forward is offered by name.
  const terminal = pending === 0 && done > 0
  return {
    kick: 'NEXT STEP',
    title: 'Resume the burn',
    desc: `${why} ${expectation}`,
    primary: { label: 'Resume burn', kind: 'burn' },
    // Failed tickets are reset to pending on resume; Revisit instead opens
    // a session to amend docs and edit/cancel tickets before re-burning.
    secondary: [
      ...(terminal ? [{ label: 'Continue to review', kind: 'advance' as const }] : []),
      ...(live ? [] : [{ label: 'Revisit', kind: 'revisit' as const }]),
    ],
    busy: false,
  }
}
