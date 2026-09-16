import { nextPlanningStep, type PlanningArtifactFacts, type PlanningStep } from '@runcastle/core'
import { hasResumable } from '../internal'
import { burnLabel } from '../laps'
import { isTerminal, nextReadyWaypoint, parseMapSections } from '../map'
import { sessionAgentName } from '../../vocabulary'
import type { NextAction, NextStep } from './types'
import type { ResolverInput } from './resolver-input'

/**
 * Planning — the one state that shapes the idea, writes the spec and emits the
 * tickets (decisions §2). It replaces the three resolvers the six-phase
 * pipeline had (ideation, spec, tickets), and the step it is up to is DERIVED
 * from the artifacts rather than read off a column: decisions.md on disk means
 * ideation is done, spec.md means the spec is, and a pending ticket means the
 * tickets are emitted. The pure ladder is core's {@link nextPlanningStep}, the
 * same one `complete_phase` answers with, so the bar and the MCP tool cannot
 * disagree about what is left.
 *
 * Burn is offered only once there is something to burn (decision 5): a burn
 * over an empty ledger is a no-op, not a risk, so the bar asks for tickets
 * instead of showing a button that would do nothing.
 */
export function resolvePlanning(input: ResolverInput): NextStep {
  const { full, ctx, live, pending, pendingTickets } = input
  const { feature, sessions, waypoints, frontierIds } = full
  // Merge is reachable from every state after creation (decision 3) — never the
  // primary here, because a feature still being planned is not what anyone came
  // to ship, but never hidden either: enabled is not the same as recommended.
  const mergeAction: NextAction = { label: 'Merge & ship', kind: 'merge' }
  /**
   * The bar while a session is live and there is nothing ready to burn: a
   * status line, never a counsel to do the agent's job. From lap 2 on it names
   * the lap rather than a step, because the lap session does all three in one
   * sitting and naming one of them would be picking the wrong one.
   */
  const liveStatus = (missing: PlanningStep): NextStep => {
    if (feature.lap > 1)
      return step(
        'LAP LIVE',
        `Lap ${feature.lap} in progress`,
        'The lap session digests the drive, amends the docs and emits this lap’s tickets.',
        undefined,
        [mergeAction],
      )
    if (missing === 'tickets')
      return step(
        'WAITING',
        'Emitting tickets',
        'The session is breaking the spec into tickets. They appear below as they land; review them, then burn.',
        undefined,
        [mergeAction],
      )
    return step(
      'SESSION LIVE',
      'Planning session in progress',
      `Shape the feature with ${sessionAgentName(live!)} in the terminal. It writes each decision to the pane on the left, then the spec, then this lap’s tickets.`,
      undefined,
      [mergeAction],
    )
  }

  // Where this lap is up to, read off the artifacts. Tickets outrank the rest
  // of the ladder rather than closing it: a quick change is born at planning
  // with its tickets and no decisions.md it will ever have (features.ts), and
  // the step in front of that human is plainly the burn, not a conversation
  // about an idea already broken down.
  const facts = planningFacts(input)
  const missing = facts.hasTickets ? null : nextPlanningStep(facts)

  // Tickets land before the session is done with them: it emits placeholder
  // contexts and enriches each afterwards, so the ledger on screen is not yet
  // what a burn would run. `complete_phase("tickets")` stamps the lap when the
  // session is finished with them; with no session alive there is nothing left
  // to race, so the button arms as it always did.
  if (pending > 0 && live && feature.ticketsReadyLap !== feature.lap)
    return step(
      'WAITING',
      'Finishing the tickets',
      'The session is finishing the tickets — enriching them, then closing out this lap’s planning. Burn arms the moment it does.',
      undefined,
      [mergeAction],
    )

  // Tickets ready to burn outrank everything below: the click the human came
  // for is right there, and no lap road or map mode is more urgent than it.
  if (missing === null)
    return {
      kick: 'NEXT STEP',
      title: 'Review the tickets, then burn',
      desc: `${pending} ticket${pending === 1 ? '' : 's'} ready. Each one runs as its own sandboxed agent, in parallel, committing to the feature branch. Set a model per ticket, or for all of them, before you burn.`,
      // Whose tickets these are, when laps mix (decision 28a) — the burn takes
      // every pending ticket on the branch, and the count alone never said so.
      primary: { label: burnLabel(pendingTickets, feature.lap), kind: 'burn' },
      secondary: [
        ...(live
          ? []
          : [
              {
                label: 'Ask for changes',
                kind: 'revisit' as const,
                hint: 'Open a session to change the tickets before burning',
              },
            ]),
        mergeAction,
      ],
      busy: false,
    }

  // A session open right now IS the lap being worked, whatever it is stamped
  // with — the stamp only answers for the laps nobody is sitting in.
  const lapWorked =
    !!live ||
    sessions.some(
      (session) =>
        session.lap === feature.lap && ['ideation', 'revisit', 'converge'].includes(session.kind),
    )
  if (feature.lap > 1 && !lapWorked) {
    const resumable = hasResumable(sessions, 'revisit')
    return step(
      'NEXT STEP',
      `Work lap ${feature.lap}`,
      'Your test-drive notes are waiting. The lap session reads them, amends the spec, and emits this lap’s tickets — then hands back to Burn.',
      { label: `${resumable ? 'Resume' : 'Start'} lap ${feature.lap} session`, kind: 'revisit' },
      [mergeAction],
    )
  }

  // The map is a MODE inside planning (ADR-0001, kept by the project session),
  // not a state of its own: convergence lands the feature right here, with the
  // artifacts it wrote answering the ladder below.
  if (feature.mapped && waypoints.length > 0 && waypoints.every(isTerminal))
    return step(
      'MAP',
      'The map is complete',
      'Every waypoint is done. Converge to turn the map and its decisions into a spec and tickets in one session.',
      { label: 'Converge', kind: 'converge' },
      [mergeAction],
    )
  // Nothing to do but watch: a live session owns every step it has not
  // finished, and the bar must never counsel the human to do the agent's job.
  if (live) return liveStatus(missing)

  if (feature.mapped) {
    const next = nextReadyWaypoint(full)
    const unspecified = ctx.mapContent
      ? parseMapSections(ctx.mapContent)['Not yet specified']?.trim()
      : undefined
    if (next) {
      const done = waypoints.filter(isTerminal).length
      return {
        ...step(
          'MAP',
          'Work the map',
          `${done} of ${waypoints.length} waypoints done · ${frontierIds.length} ready to work — next: ${next.title} · pick a different one in the map.`,
          { label: 'Work next', kind: 'workNext', waypointId: next.id },
          [mergeAction],
        ),
        ...(unspecified ? { note: `Still unspecified: ${unspecified}` } : {}),
      }
    }
    const researchRuns = waypoints.filter((waypoint) => waypoint.claimedBy?.startsWith('run_')).length
    if (researchRuns > 0)
      return step(
        'WAITING',
        `Waiting on ${researchRuns} research run${researchRuns === 1 ? '' : 's'}`,
        'Research is running unattended. Its waypoints open up when it finishes.',
        undefined,
        [mergeAction],
      )
  }

  switch (missing) {
    // Nothing written yet: the conversation is the whole of the next step.
    case 'ideation':
      return hasResumable(sessions, 'ideation')
        ? step(
            'NEXT STEP',
            'Pick the conversation back up',
            'The ideation session ended. Resume it to carry on where you left off — the conversation is still on disk.',
            { label: 'Resume session', kind: 'startGrill' },
            [mergeAction],
          )
        : step(
            'NEXT STEP',
            'Shape the idea with the agent',
            'Start a session: the agent asks about the idea until it is concrete enough to write up, and every decision lands in the pane on the left.',
            { label: 'Start session', kind: 'startGrill' },
            [mergeAction],
          )
    case 'spec':
      // A mapped feature with decisions and no spec is a converge session that
      // ended before it finished writing: the road back is that session, which
      // picks up from the map and the decisions, not a fresh conversation.
      if (feature.mapped)
        return step(
          'NEXT STEP',
          'Finish converging',
          'The converge session ended before the spec and tickets were written. Resume it — it picks up from the map and the decisions.',
          { label: 'Resume converge', kind: 'resumeConverge' },
          [mergeAction],
        )
      return step(
        'NEXT STEP',
        'Write the spec',
        'The decisions are settled. The session turns them into a spec — the approach, the seams and what is out of scope — and then breaks it into tickets.',
        { label: resumeLabel(sessions), kind: 'startGrill' },
        [mergeAction],
      )
    case 'tickets':
      return step(
        'NEXT STEP',
        'Emit the tickets',
        'The spec is written and nothing is pending. A session breaks it into tickets — each one burns as its own sandboxed agent.',
        { label: resumeLabel(sessions), kind: 'startGrill' },
        [mergeAction],
      )
  }
}

/**
 * Where this feature is up to inside Planning, read off its artifacts — the
 * client half of the server's `planningFacts`, over the same three facts and in
 * the same order (decisions §2). `hasTickets` asks for tickets a burn would
 * still RUN, so an earlier lap's finished batch never reports this lap's
 * tickets as emitted.
 */
function planningFacts(input: ResolverInput): PlanningArtifactFacts {
  const { docs } = input.full
  const onDisk = (fileName: string): boolean =>
    docs.some((doc) => doc.relPath.endsWith(fileName))
  return {
    hasDecisions: onDisk('decisions.md'),
    hasSpec: onDisk('spec.md'),
    hasTickets: input.pending > 0,
  }
}

/** Resume the conversation that is on disk, or open a fresh one. */
function resumeLabel(sessions: ResolverInput['full']['sessions']): string {
  return hasResumable(sessions, 'ideation') || hasResumable(sessions, 'converge')
    ? 'Resume session'
    : 'Start session'
}

function step(
  kick: string,
  title: string,
  desc: string,
  primary?: NextStep['primary'],
  secondary: NextAction[] = [],
): NextStep {
  return { kick, title, desc, primary, secondary, busy: false }
}
