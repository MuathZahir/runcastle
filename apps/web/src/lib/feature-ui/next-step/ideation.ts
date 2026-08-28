import { sessionAgentName } from '../../vocabulary'
import { parseMapSections } from '../map'
import { hasResumable } from '../internal'
import type { NextStep } from './types'
import type { ResolverInput } from './resolver-input'

export function resolveIdeation(input: ResolverInput): NextStep {
  const { full, ctx, live, resumableGrill, canAdvance, promoteLabel } = input
  const { feature, gate, sessions } = full
  // Mapped features converge instead of promoting: Converge crosses G1 and
  // spawns the converge session, and the bar owns it (decision #4) — it never
  // shows a plain `advance`, which would bump the phase without a session
  // (ADR-0001 §13.6). Remaining fog — the map's still-unspecified prose —
  // rides along as a warning: shown, never enforced, so it neither gates nor
  // disables Converge.
  if (feature.mapped) {
    const fog = ctx.mapContent
      ? parseMapSections(ctx.mapContent)['Not yet specified']?.trim() || undefined
      : undefined
    if (gate.satisfied) {
      return {
        kick: 'MAP',
        title: 'Converge the map',
        desc: 'Every waypoint is resolved — converge to draft the spec and tickets.',
        primary: { label: 'Converge', kind: 'converge' },
        secondary: [],
        busy: false,
        fog,
      }
    }
    return {
      kick: 'MAP',
      title: 'Work the frontier',
      desc: gate.reason ?? 'Resolve the open waypoints; converge once the frontier clears.',
      // The override is the seatbelt, not the cage: a quiet secondary that
      // asks for a reason before it forces G1.
      secondary: [
        {
          label: 'Override & converge…',
          kind: 'convergeOverride',
          reason: {
            placeholder: 'reason to converge past open waypoints',
            submitLabel: 'Converge anyway',
          },
        },
      ],
      busy: false,
      fog,
    }
  }
  // From lap 2 on, ideation belongs to the LAP's session (SPEC §15.2): one
  // terminal digests what the drive taught, amends the docs, emits this lap's
  // tickets and advances itself through ideation → spec → tickets. So the bar
  // never offers a bare promote here — lap 1's decisions.md is still on disk,
  // and promoting on it skips the whole lap and dead-ends at `tickets` with
  // nothing to burn (findings F4). The lap-scoped gates refuse it server-side;
  // this is the same truth in the copy, pointing at the session instead.
  if (feature.lap > 1) {
    if (live) {
      return {
        kick: 'LAP LIVE',
        title: `Lap ${feature.lap} in progress`,
        desc: 'The lap session digests the drive, amends the docs and emits this lap’s tickets.',
        primary: undefined,
        secondary: [],
        busy: false,
      }
    }
    const resumableLap = hasResumable(sessions)
    return {
      kick: 'NEXT STEP',
      title: `Work lap ${feature.lap}`,
      desc: `Lap ${feature.lap} is open — its session amends the docs and emits this lap’s tickets, then hands back to Burn. Promoting is refused until it has run.`,
      primary: {
        label: resumableLap
          ? `Resume lap ${feature.lap} session`
          : `Start lap ${feature.lap} session`,
        kind: 'revisit',
      },
      secondary: [],
      busy: false,
    }
  }
  if (live) {
    return {
      kick: 'GRILL LIVE',
      title: 'Grill session in progress',
      desc: `Shape the idea with ${sessionAgentName(live)} — it promotes the phase itself when the grilling is done.`,
      primary: undefined,
      secondary: [],
      busy: false,
    }
  }
  if (canAdvance) {
    return {
      kick: 'NEXT STEP',
      title: 'Shape the idea, or promote it',
      desc: 'Decisions are captured — carry on in a grill session, or promote the idea when it feels concrete.',
      primary: {
        label: resumableGrill ? 'Resume grill session' : 'Start grill session',
        kind: 'startGrill',
      },
      secondary: [{ label: promoteLabel, kind: 'advance' }],
      busy: false,
    }
  }
  return resumableGrill
    ? {
        kick: 'NEXT STEP',
        title: 'Pick the conversation back up',
        desc: 'The grill session ended, but its conversation is still on disk — resume it to carry on where you left off.',
        primary: { label: 'Resume grill session', kind: 'startGrill' },
        secondary: [],
        busy: false,
      }
    : {
        kick: 'NEXT STEP',
        // No session and none to resume: nothing has resolved a model yet,
        // so there is no runtime to name (decision 11).
        title: 'Shape the idea with the agent',
        desc: 'Launch a grill session to shape the idea before any code is written.',
        primary: { label: 'Start grill session', kind: 'startGrill' },
        secondary: [],
        busy: false,
      }
}
