import { burnLabel } from '../laps'
import { burnExpectation } from '../run'
import { burnWarningLine } from './burn-warnings'
import type { NextAction, NextStep } from './types'
import type { ResolverInput } from './resolver-input'

/**
 * Building — a burn is running, or one has stopped short of review.
 *
 * The state the runner moves off itself: a successful run auto-advances to
 * review (decision 3), so nothing here offers to step the pipeline by hand.
 * What is left is the burn's own controls — cancel it, resume it — and Merge,
 * which is reachable from here like everywhere else (decision 7: merging mid-
 * burn is a warning about work that lands after it, never a refusal).
 */
export function resolveBuilding(input: ResolverInput): NextStep {
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
  const mergeAction: NextAction = { label: 'Merge & ship', kind: 'merge' }
  // What the burn is about to cost, from this project's finished tickets
  // (decision #16b). Said on both roads into a burn — the first one and the
  // resume — because the human is answering the same question at both.
  const expectation = burnExpectation(ctx.burnStats)
  // What the tickets about to burn are SHAPED like, and what the docs digest
  // will cost every one of them (`burn-warnings.ts`), said where the human is
  // deciding. The door that stored the tickets said the shapes once on the
  // timeline; this is the same sentence, from the same function, beside a Burn
  // button that stays enabled — the coder gets the ticket's own text and nothing
  // else, and this is the last place anyone can read it first.
  const shape = burnWarningLine(input)
  if (running) {
    return {
      kick: 'IN PROGRESS',
      title: 'Burning tickets',
      desc: `Burning ${t} ticket${t === 1 ? '' : 's'} — ${done} done${failed ? `, ${failed} failed` : ''}.`,
      primary: { label: 'Cancel run', kind: 'cancelRun', danger: true },
      secondary: [mergeAction],
      busy: true,
    }
  }
  const interruption = ctx.interruptedBurn
  if (interruption && interruption.runId === run?.id) {
    const landed = interruption.landedTickets
    if (interruption.pendingTickets > 0) {
      return {
        alert: true,
        kick: 'INTERRUPTED',
        title: `A burn was interrupted by a server restart: ${landed} ticket${landed === 1 ? '' : 's'} landed, ${interruption.pendingTickets} pending`,
        desc: 'Resume the burn to sweep orphaned work and continue the remaining tickets.',
        primary: { label: 'Resume burn', kind: 'burn' },
        secondary: [],
        busy: false,
      }
    }
    // `advance` died with the six-phase pipeline (decision 3): resuming the
    // burn is the road — it sweeps the landed work, finalizes, and the runner's
    // auto-advance crosses to review on its own.
    return {
      kick: 'RECOVERED',
      title: `A burn was interrupted by a server restart: ${landed} ticket${landed === 1 ? '' : 's'} landed, 0 pending`,
      desc: 'All ticket work landed before the restart. Resume the burn to finalize it — it hands off to review on its own.',
      primary: { label: 'Resume burn', kind: 'burn' },
      secondary: [],
      busy: false,
    }
  }
  // Nothing to burn. The bar used to offer an enabled "Burn 0 tickets" over
  // an empty ledger whose own copy said the opposite (findings F25.1) — the
  // planning bar has always handled this state honestly, so this says the
  // same thing: the missing thing is tickets, and a session emits them.
  if (t === 0) {
    if (live) {
      return {
        kick: 'WAITING',
        title: 'No tickets to burn',
        desc: 'This feature reached the build state with an empty ledger. The live session breaks the work into tickets — they appear here as they land.',
        primary: undefined,
        secondary: [mergeAction],
        busy: false,
      }
    }
    return {
      kick: 'WAITING',
      title: 'No tickets to burn',
      desc: 'This feature reached the build state with an empty ledger. A session breaks the work into tickets — open one, and the burn has something to run.',
      primary: {
        label: resumableGrill ? 'Resume the session' : 'Open a session',
        kind: 'startGrill',
      },
      secondary: [mergeAction],
      busy: false,
    }
  }
  // Never burned at all — the feature was born here, tickets and all
  // (decision 21). There is nothing to resume, so this is the plain first Burn,
  // worded like planning's.
  if (!run) {
    return {
      kick: 'NEXT STEP',
      title: pending === 1 ? 'Review & burn the ticket' : 'Review & burn the tickets',
      desc: `Read the card — edit it if it is not quite right — then burn it into commits. ${expectation}`,
      // Whose tickets these are, when laps mix (decision 28a) — the burn takes
      // every pending ticket on the branch, and the count alone never said so.
      primary: { label: burnLabel(pendingTickets, full.feature.lap), kind: 'burn' },
      secondary: live ? [mergeAction] : [{ label: 'Revisit', kind: 'revisit' }, mergeAction],
      busy: false,
      ...(shape ? { note: shape } : {}),
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
    desc: `${why} ${expectation}`,
    primary: { label: 'Resume burn', kind: 'burn' },
    // Failed tickets are reset to pending on resume; Revisit instead opens
    // a session to amend docs and edit/cancel tickets before re-burning.
    secondary: [
      ...(live ? [] : [{ label: 'Revisit', kind: 'revisit' as const }]),
      mergeAction,
    ],
    busy: false,
    ...(shape ? { note: shape } : {}),
  }
}
