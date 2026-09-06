import type { DriveState } from '@runcastle/core'
import { driveView } from '../drive'
import { ONE_TERMINAL_WARNING } from '../gates'
import { burnLabel } from '../laps'
import { unverifiedWarning } from '../internal'
import type { NextAction, NextStep } from './types'
import type { ResolverInput } from './resolver-input'

/**
 * The drive states that own the bar outright (decision 20).
 *
 * In each of them the drive is either not up yet, deliberately inert, or broken,
 * and the walked bug is the bar carrying on regardless — "merge when it looks
 * right" printed over a bare checkout and over a failed setup command. So the
 * copy and the primary come from the drive table, and the review verbs stay
 * reachable underneath as secondaries. `serving` is not here: a drive that is
 * actually serving is the state the ordinary review bar was already written for.
 */
const DRIVE_OWNS_BAR: readonly DriveState[] = [
  'starting',
  'bare-checkout',
  'setup-failed',
  'review-agent-driving',
]

export function resolveReview(input: ResolverInput): NextStep {
  const { full, ctx, live, failed, pending, pendingTickets, run } = input
  const { feature } = full
  // Whose tickets a burn from here would burn (decision 28a): burning every
  // pending ticket across laps is correct — the branch accumulates them — but
  // the count said nothing about the lap-1 leftovers riding along.
  const burnAction: NextAction[] =
    pending > 0 ? [{ label: burnLabel(pendingTickets, feature.lap), kind: 'burn' }] : []
  // One drive truth for the bar and the stage (decision 20). The server's value
  // wins whenever it says something is happening; with nothing from it yet, this
  // browser's own record of a drive it started stands in, so a start that has
  // not reached the poll still reads as a drive rather than as an offer to begin
  // one.
  const driveState: DriveState =
    ctx.driveState && ctx.driveState !== 'idle' ? ctx.driveState : ctx.driving ? 'serving' : 'idle'
  const driving = driveState !== 'idle'
  const view = driveView(driveState)
  // Review offers three verbs (ADR-0010 §3): Fix — the Burn primary below,
  // for when the spec was right and the code wasn't; Iterate — the spec was
  // wrong, so start lap N+1 back at ideation (the `rethink` procedure keeps
  // the internal name, for continuity of the timeline); Merge & ship. Test
  // drive stays available throughout. Iterate opens the lap's terminal, and
  // there is one terminal per feature, so it's hidden while any session is
  // live — and disabled while the drive holds the branch its worktree needs,
  // which the server refuses outright (findings F3).
  // A dry run holds the same singleton drive slot, so the server refuses a
  // feature drive outright while one is up (decision 9) — said here rather
  // than on click. Unverified keys never disable: they are a caveat about
  // what the drive may do, not a reason it cannot run (decision 7), and the
  // refusal outranks the caveat when both apply.
  const testDriveAction: NextAction = driving
    ? { label: 'Stop test drive', kind: 'testDriveStop' }
    : {
        label: 'Start test drive',
        kind: 'testDriveStart',
        ...(ctx.dryRunActive
          ? { disabled: 'A preparation dry-run is in progress — stop it first' }
          : {}),
      }
  // Nothing to caveat mid-drive — the offer there is Stop — and nothing to
  // caveat when the drive cannot start at all. Spread into each of review's
  // three bars, so the doubt rides along whatever else the phase is saying.
  const unverified = driving || ctx.dryRunActive ? [] : (ctx.unverifiedDriveKeys ?? [])
  const driveWarning =
    unverified.length > 0 ? { warning: unverifiedWarning(unverified) } : {}
  // The review bar has exactly two forward decisions now — Merge & ship, or
  // Iterate (decision 21). "Address notes" and "Fix N open defects" were the
  // same decision as Iterate ("this isn't ready") entered through two more
  // doors, with the fork duplicated inside one of them; the triage step behind
  // Iterate is where that choice is made, once, over the whole list.
  const openNotes = ctx.openNotes ?? 0
  const openDefects = ctx.openDefects ?? 0
  const openWork = openNotes + openDefects
  const iterateAction: NextAction = {
    label: 'Iterate',
    // With nothing open the step is skipped entirely and the lap opens
    // empty-handed (decision 21); with something open the click opens the door.
    kind: openWork > 0 ? 'iterate' : 'rethink',
    // The refusal stands (findings F3 — the server will not open a lap worktree
    // on a branch the drive holds, and it refuses the triage commit for the same
    // reason), but it is no longer a dead end: one click stops the drive and
    // takes the road anyway (decision 20). A live session only blocks the
    // conversation, so it disables Iterate only when the conversation is all
    // this click would do — with open work, the door's quick-fix road still
    // mints tickets, which no session or branch can take away.
    ...(driving
      ? {
          disabled: 'Stop the test drive first — the branch is checked out',
          escape: { label: 'Stop drive and iterate', kind: 'stopDriveAndIterate' },
        }
      : live && openWork === 0
        ? { disabled: 'One terminal per feature — end the live session first' }
        : {}),
  }
  const iterate: NextAction[] = [iterateAction]

  // A recorded conflict outranks every other review verb (findings F8). The
  // bar used to highlight Merge & ship directly above the red conflict panel,
  // so the one action the user trusts re-ran a merge that could not land.
  // Resolve is therefore the primary — but nothing here is disabled, and
  // that is the whole of decisions 2b and 3. A disabled Merge & ship
  // deadlocked every resolution runcastle could not see (one done in the
  // human's own checkout, a session that crashed); as a retry it either
  // ships or re-emits a fresh conflict, so the card self-corrects. And Burn
  // never touched the base merge in the first place — hiding it here hid the
  // one button whose event (`burn.started`) supersedes the conflict.
  if (ctx.conflict) {
    const retryMerge: NextAction = { label: 'Retry Merge & ship', kind: 'merge' }
    return {
      kick: 'MERGE CONFLICT',
      title: 'Resolve the merge conflict',
      desc: live
        ? `Merging ${ctx.conflict.base} in hit conflicts. An agent can resolve them on this branch — or type the resolution into the session you already have open.`
        : `Merging ${ctx.conflict.base} in hit conflicts. An agent can resolve them on this branch, then Merge & ship retries.`,
      // NEVER hidden while the conflict stands (decisions #10). Gating it on
      // the one-terminal rule is what made the resolve button read as
      // randomly not existing until the chat ended; with a session live the
      // button performs the dance instead — end it, then launch the resolve
      // — and says so above.
      primary: {
        label: live ? 'End session & resolve' : 'Resolve the merge conflict',
        kind: 'resolveConflict',
      },
      secondary: [retryMerge, ...burnAction, testDriveAction, ...iterate],
      busy: false,
      // The compound's own explanation outranks the drive caveat, exactly as
      // a drive refusal does: it is about the button the eye is on.
      ...(live ? { warning: ONE_TERMINAL_WARNING } : driveWarning),
    }
  }

  // A drive that is not serving owns the bar (decision 20). The two states this
  // exists for are the walked lies: a bare checkout and a failed setup command
  // both used to read "Test-driving the branch — merge when it looks right",
  // because the bar derived drive truth of its own instead of reading the one
  // the stage reads. Everything else review offers stays a click away below.
  if (DRIVE_OWNS_BAR.includes(driveState)) {
    // "fix it or stop the drive": whichever of the two the table did not make
    // the primary is the secondary beside it.
    const primary: NextAction =
      view.primary === 'fixDrive' ? { label: 'Fix drive', kind: 'fixDrive' } : testDriveAction
    return {
      kick: 'NEXT STEP',
      title: view.barTitle,
      desc: view.barDesc,
      primary,
      secondary: [
        { label: 'Merge & ship', kind: 'merge' },
        ...burnAction,
        ...(primary.kind === 'testDriveStop' ? [] : [testDriveAction]),
        ...iterate,
      ],
      busy: false,
    }
  }

  // Something is still open — defects the review found and the run could not
  // close (over the auto-fix cap, or a fix ticket that failed), notes the human
  // wrote while driving, or both. One door answers all of it (decision 21):
  // Iterate opens the triage step, where ticking a row mints its ticket and
  // everything left rides into lap N+1's conversation. Merge & ship stays one
  // click away and is never nagged about — open work is information, not a block.
  if (openWork > 0) {
    const said = [
      openDefects > 0
        ? `${openDefects} defect${openDefects === 1 ? '' : 's'} the review found`
        : '',
      openNotes > 0 ? `${openNotes} note${openNotes === 1 ? '' : 's'} you wrote` : '',
    ].filter(Boolean)
    return {
      kick: 'NEXT STEP',
      title: 'Answer what is still open',
      desc: `${said.join(' and ')} ${openWork === 1 ? 'is' : 'are'} still open. Iterate sorts them: tick the quick fixes and they mint tickets on this lap, and anything left opens lap ${feature.lap + 1}’s conversation. Or ship as it is.`,
      primary: iterateAction,
      secondary: [
        { label: 'Merge & ship', kind: 'merge' },
        ...burnAction,
        testDriveAction,
      ],
      busy: false,
      ...driveWarning,
    }
  }

  // Fix tickets are non-terminal — while any exist, the review loops back
  // through a burn (CONTEXT decision #7): Burn is promoted to primary, and
  // Merge & ship drops to a secondary.
  if (pending > 0) {
    return {
      kick: 'NEXT STEP',
      title: 'Burn the fix tickets',
      desc: driving
        ? 'Test-driving the branch — burn the fix tickets when you’re ready.'
        : `${pending} fix ticket${pending === 1 ? '' : 's'} ready — burn to run them, then review again.`,
      primary: { label: burnLabel(pendingTickets, feature.lap), kind: 'burn' },
      secondary: [{ label: 'Merge & ship', kind: 'merge' }, testDriveAction, ...iterate],
      busy: false,
      ...driveWarning,
    }
  }

  // The spec still lists scope for a later lap (decisions #7), so shipping is
  // not the step this lap ends on: the primary starts lap N+1 and Merge &
  // ship drops to a secondary, one click away — "lap 1 is enough" is the
  // human's call to make, and this only stops the main button making it for
  // them. Reuses the Iterate action rather than minting a second one, so the
  // next lap has ONE dispatch and inherits the reason it cannot fire while
  // the drive holds the branch. With a session live there is nothing to launch
  // — and by here nothing to triage either — so review says what it says today.
  if (ctx.laterLaps && !live) {
    return {
      kick: 'NEXT STEP',
      title: `Lap ${feature.lap} is done — the spec plans lap ${feature.lap + 1}`,
      desc: `This lap is reviewable, and the spec still lists scope it deliberately deferred. Start lap ${feature.lap + 1} to take it on — or ship what landed, if lap ${feature.lap} is enough.`,
      primary: { ...iterateAction, label: `Start lap ${feature.lap + 1}` },
      secondary: [{ label: 'Merge & ship', kind: 'merge' }, testDriveAction],
      busy: false,
      ...driveWarning,
    }
  }

  // "Checks are in" is an all-clear, so it needs checks to have run: the audit
  // found it over a feature with no run recorded at all (findings F23), which
  // is the state a quick-change or an overridden gate lands in.
  // The merge invitation is the drive table's own sentence, so the one state it
  // is true of — `serving` — is the only state that can print it (decision 20).
  const desc = driving
    ? `${view.barTitle}.`
    : failed > 0
      ? `Run finished with ${failed} failed ticket${failed === 1 ? '' : 's'} — review, then ship.`
      : run
        ? 'Checks are in. Test-drive the branch, then merge to ship.'
        : 'No run has been recorded on this branch — test-drive it yourself before merging.'
  return {
    kick: 'NEXT STEP',
    title: driving ? 'Merge when it looks right' : 'Test drive, then ship',
    desc,
    primary: { label: 'Merge & ship', kind: 'merge' },
    secondary: [testDriveAction, ...iterate],
    busy: false,
    ...driveWarning,
  }
}
