import type { TicketTally } from '@runcastle/core'
import { settingsLocationFromMessage } from '../../settings'
import { burnLabel, ticketCountText } from '../laps'
import { burnExpectation } from '../run'
import { burnWarningLine } from './burn-warnings'
import { CHAT_ACTION } from './chat'
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
    resumableChat,
    tally: { landed, total: t },
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
      desc: `Burning ${t} ticket${t === 1 ? '' : 's'} — ${landed} done${failed ? `, ${failed} failed` : ''}.`,
      primary: { label: 'Cancel run', kind: 'cancelRun', danger: true },
      // The door this feature exists for: a burn used to refuse every terminal
      // because the run held the branch, so the bar had one button and the human
      // waiting on a dead run had nobody to ask. Chat is enabled here like
      // anywhere else — the chat commits on its own branch now and lands through
      // the queue (decision 2) — and Cancel run stays the primary.
      secondary: [CHAT_ACTION, mergeAction],
      busy: true,
    }
  }
  const interruption = ctx.interruptedBurn
  if (interruption && interruption.runId === run?.id) {
    // The reconcile event's own counts take every ticket on the feature, the
    // orphaned review pass included, so the bar states the one ticket count
    // (decision d2) and agrees with the Tickets row and the sidebar beside it.
    const unlanded = t - landed
    if (unlanded > 0) {
      return {
        alert: true,
        kick: 'INTERRUPTED',
        title: `A burn was interrupted by a server restart: ${landed} ticket${landed === 1 ? '' : 's'} landed, ${unlanded} pending`,
        desc: 'Resume the burn to sweep orphaned work and continue the remaining tickets.',
        primary: { label: 'Resume burn', kind: 'burn' },
        secondary: [CHAT_ACTION],
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
      secondary: [CHAT_ACTION],
      busy: false,
    }
  }
  // Nothing to burn. The bar used to offer an enabled "Burn 0 tickets" over
  // an empty ledger whose own copy said the opposite (findings F25.1) — the
  // planning bar has always handled this state honestly, so this says the
  // same thing: the missing thing is tickets, and a session emits them.
  if (full.tickets.length === 0) {
    if (live) {
      return {
        kick: 'WAITING',
        title: 'No tickets to burn',
        desc: 'This feature reached the build state with an empty ledger. The live session breaks the work into tickets — they appear here as they land.',
        primary: undefined,
        secondary: [CHAT_ACTION, mergeAction],
        busy: false,
      }
    }
    return {
      kick: 'WAITING',
      title: 'No tickets to burn',
      desc: 'This feature reached the build state with an empty ledger. A session breaks the work into tickets — open one, and the burn has something to run.',
      // An empty ledger with nothing live IS the state talking is the next step
      // in, so the chat is promoted out of its secondary slot and keeps the
      // resume-aware wording this primary has always had.
      primary: {
        label: resumableChat ? 'Resume the session' : 'Open a session',
        kind: 'chat',
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
      secondary: [CHAT_ACTION, mergeAction],
      busy: false,
      ...(shape ? { note: shape } : {}),
    }
  }
  // A failed run that recorded why says so verbatim — the generic line hid the
  // one sentence that named the fix, and the human clicked Resume three times.
  const failure =
    run.status === 'failed' && !isRunnerPlaceholder(run.summary)
      ? withTicketCount(run.summary, input.tally)
      : undefined
  // Died before any ticket started (a setup or preflight failure): a resume
  // would meet the same wall, so the fix leads and Resume waits behind it.
  if (failure && !ticketsStartedIn(run, full.tickets)) {
    const resume: NextAction = { label: 'Resume burn', kind: 'burn' }
    return {
      alert: true,
      kick: 'NEXT STEP',
      title: 'The burn could not start',
      desc: failure,
      primary: settingsLocationFromMessage(failure)
        ? { label: 'Open Settings → Burns', kind: 'openBurnSettings' }
        : undefined,
      secondary: [resume, CHAT_ACTION, mergeAction],
      busy: false,
    }
  }
  const why =
    run.status === 'failed'
      ? (failure ?? 'The run failed — resume the burn to retry.')
      : run.status === 'cancelled'
        ? 'The run was cancelled — resume the burn to continue.'
        : 'The burn has not started — resume to run the tickets.'
  return {
    kick: 'NEXT STEP',
    title: 'Resume the burn',
    desc: `${why} ${expectation}`,
    primary: { label: 'Resume burn', kind: 'burn' },
    // Failed tickets are reset to pending on resume; Chat instead amends the
    // docs and edits or cancels tickets before re-burning.
    secondary: [CHAT_ACTION, mergeAction],
    busy: false,
    ...(shape ? { note: shape } : {}),
  }
}

/**
 * The runner's fallback summaries (packages/server/src/workflows/runner.ts),
 * written when a workflow threw a non-Error or returned no reason. They name no
 * cause, so they read as no recorded reason and keep the generic copy and flow.
 */
function isRunnerPlaceholder(summary: string | undefined): boolean {
  return summary === 'run failed' || summary === 'run cancelled'
}

/**
 * The burner's summary counts everything the run burned, review ticket
 * included ("1/2 tickets done (1 cancelled)", packages/server/src/workflows/
 * ticket-burner.ts). The bar restates that count with the one ticket count
 * (decision d2) and keeps the rest of the summary verbatim — a halted run's
 * headline is still the fact the human has to fix.
 */
const RUNNER_COUNT = /\d+\/\d+ tickets done(?: \(\d+ cancelled\))?/

function withTicketCount(summary: string | undefined, tally: TicketTally): string | undefined {
  if (!summary) return summary
  const count = ticketCountText({ done: tally.landed, total: tally.total })
  const waived = tally.waived > 0 ? ` · ${tally.waived} waived` : ''
  return summary.replace(RUNNER_COUNT, `${count}${waived}`)
}

/**
 * Whether any ticket was taken up by this run: one burning now, or one that
 * went terminal after the run started. Pending rows alone mean the run died in
 * setup — the tickets were never handed to an agent.
 */
function ticketsStartedIn(
  run: { startedAt: number },
  tickets: ResolverInput['full']['tickets'],
): boolean {
  return tickets.some(
    (t) => t.status === 'burning' || (t.completedAt !== null && t.completedAt >= run.startedAt),
  )
}
