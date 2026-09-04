import { hasResumable } from '../internal'
import { isTerminal, nextReadyWaypoint, parseMapSections } from '../map'
import { sessionAgentName } from '../../vocabulary'
import type { ResolverInput } from './resolver-input'
import type { NextStep } from './types'

export function resolveIdeation(input: ResolverInput): NextStep {
  const { full, ctx, live } = input
  const { feature, gate, sessions, waypoints, frontierIds } = full
  if (feature.lap > 1 && live) return step('LAP LIVE', `Lap ${feature.lap} in progress`, 'The lap session digests the drive, amends the docs and emits this lap’s tickets.')

  const lapWorked = sessions.some((session) => session.lap === feature.lap && ['ideation', 'revisit', 'converge'].includes(session.kind))
  if (feature.lap > 1 && !lapWorked) {
    const resumable = hasResumable(sessions, 'revisit')
    return step('NEXT STEP', `Work lap ${feature.lap}`, 'Your test-drive notes are waiting. The lap session reads them, amends the spec, and emits this lap’s tickets — then hands back to Burn.', { label: `${resumable ? 'Resume' : 'Start'} lap ${feature.lap} session`, kind: 'revisit' })
  }
  if (feature.mapped && gate.satisfied) return step('MAP', 'The map is complete', 'Every waypoint is done. Converge to turn the map and its decisions into a spec and tickets in one session.', { label: 'Converge', kind: 'converge' })
  if (feature.mapped && live) return liveStep(live)

  if (feature.mapped) {
    const next = nextReadyWaypoint(full)
    const unspecified = ctx.mapContent ? parseMapSections(ctx.mapContent)['Not yet specified']?.trim() : undefined
    if (next) {
      const done = waypoints.filter(isTerminal).length
      return {
        ...step('MAP', 'Work the map', `${done} of ${waypoints.length} waypoints done · ${frontierIds.length} ready to work — next: ${next.title} · pick a different one in the map.`, { label: 'Work next', kind: 'workNext', waypointId: next.id }),
        ...(unspecified ? { note: `Still unspecified: ${unspecified}` } : {}),
      }
    }
    const researchRuns = waypoints.filter((waypoint) => waypoint.claimedBy?.startsWith('run_')).length
    if (researchRuns > 0) return step('WAITING', `Waiting on ${researchRuns} research run${researchRuns === 1 ? '' : 's'}`, 'Research is running unattended. Its waypoints open up when it finishes.')
  }
  if (live) return liveStep(live)
  if (hasResumable(sessions, 'ideation')) return step('NEXT STEP', 'Pick the conversation back up', 'The ideation session ended. Resume it to carry on where you left off — the conversation is still on disk.', { label: 'Resume session', kind: 'startGrill' })
  return step('NEXT STEP', 'Shape the idea with the agent', 'Start a session: the agent asks about the idea until it is concrete enough to write up, and every decision lands in the pane on the left.', { label: 'Start session', kind: 'startGrill' })
}

function liveStep(live: ResolverInput['live']): NextStep {
  return step('SESSION LIVE', 'Ideation session in progress', `Shape the idea with ${sessionAgentName(live!)} in the terminal. It writes each decision to the pane on the left and moves the feature on to spec itself when the idea is concrete.`)
}

function step(kick: string, title: string, desc: string, primary?: NextStep['primary']): NextStep {
  return { kick, title, desc, primary, secondary: [], busy: false }
}
