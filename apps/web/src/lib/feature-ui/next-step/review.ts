import { ONE_TERMINAL_WARNING } from '../gates'
import { unverifiedWarning } from '../internal'
import type { NextAction, NextStep } from './types'
import type { ResolverInput } from './resolver-input'

export function resolveReview(input: ResolverInput): NextStep {
  const { full, ctx, live, failed, pending, run } = input
  const { feature } = full
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
  const testDriveAction: NextAction = ctx.driving
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
  const unverified = ctx.driving || ctx.dryRunActive ? [] : (ctx.unverifiedDriveKeys ?? [])
  const driveWarning =
    unverified.length > 0 ? { warning: unverifiedWarning(unverified) } : {}
  const iterate: NextAction[] = live
    ? []
    : [
        {
          label: 'Iterate',
          kind: 'rethink',
          ...(ctx.driving
            ? { disabled: 'Stop the test drive first — the branch is checked out' }
            : {}),
        },
      ]
  // Triage for the findings inbox (decisions.md #11), spread into all three
  // review bars beside the drive and Iterate. Never disabled: it opens the
  // fork rather than performing either road, and its promote road only
  // writes ticket rows — no terminal, no branch — so neither a live session
  // nor a drive can take it away. The dialog constrains the OTHER road.
  const addressNotes: NextAction[] =
    (ctx.openNotes ?? 0) > 0 ? [{ label: 'Address notes', kind: 'addressNotes' }] : []

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
    const burn: NextAction[] =
      pending > 0
        ? [{ label: `Burn ${pending} ticket${pending === 1 ? '' : 's'}`, kind: 'burn' }]
        : []
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
      secondary: [retryMerge, ...burn, testDriveAction, ...addressNotes, ...iterate],
      busy: false,
      // The compound's own explanation outranks the drive caveat, exactly as
      // a drive refusal does: it is about the button the eye is on.
      ...(live ? { warning: ONE_TERMINAL_WARNING } : driveWarning),
    }
  }

  // Defects the review found and the run could not close — over the auto-fix
  // cap, or a fix ticket that failed (decisions #7). One click mints a ticket
  // for each and burns them, so the human's whole decision on arrival is one
  // line read and one button; Merge & ship drops to a secondary and is NOT
  // nagged about, because open findings are information, never a block.
  const openDefects = ctx.openDefects ?? 0
  if (openDefects > 0) {
    // Reachable exactly as it is on the conflict bar: a burn that is already
    // queued must not lose its button to the one that queues more.
    const burn: NextAction[] =
      pending > 0
        ? [{ label: `Burn ${pending} ticket${pending === 1 ? '' : 's'}`, kind: 'burn' }]
        : []
    return {
      kick: 'NEXT STEP',
      title: 'Fix what the review found',
      desc: `${openDefects} defect${openDefects === 1 ? '' : 's'} the review found ${
        openDefects === 1 ? 'is' : 'are'
      } still open — fixing ${openDefects === 1 ? 'it' : 'them'} runs one ticket each on this lap. Or dismiss them below and ship.`,
      primary: {
        label: `Fix ${openDefects} open defect${openDefects === 1 ? '' : 's'}`,
        kind: 'fixDefects',
      },
      secondary: [
        { label: 'Merge & ship', kind: 'merge' },
        ...burn,
        testDriveAction,
        ...addressNotes,
        ...iterate,
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
      desc: ctx.driving
        ? 'Test-driving the branch — burn the fix tickets when you’re ready.'
        : `${pending} fix ticket${pending === 1 ? '' : 's'} ready — burn to run them, then review again.`,
      primary: { label: `Burn ${pending} ticket${pending === 1 ? '' : 's'}`, kind: 'burn' },
      secondary: [
        { label: 'Merge & ship', kind: 'merge' },
        testDriveAction,
        ...addressNotes,
        ...iterate,
      ],
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
  // the drive holds the branch. With a session live there is nothing to
  // launch (`iterate` is empty) and review says exactly what it says today.
  const startNextLap = iterate[0]
  if (ctx.laterLaps && startNextLap) {
    return {
      kick: 'NEXT STEP',
      title: `Lap ${feature.lap} is done — the spec plans lap ${feature.lap + 1}`,
      desc: `This lap is reviewable, and the spec still lists scope it deliberately deferred. Start lap ${feature.lap + 1} to take it on — or ship what landed, if lap ${feature.lap} is enough.`,
      primary: { ...startNextLap, label: `Start lap ${feature.lap + 1}` },
      secondary: [
        { label: 'Merge & ship', kind: 'merge' },
        testDriveAction,
        ...addressNotes,
      ],
      busy: false,
      ...driveWarning,
    }
  }

  // "Checks are in" is an all-clear, so it needs checks to have run: the audit
  // found it over a feature with no run recorded at all (findings F23), which
  // is the state a quick-change or an overridden gate lands in.
  const desc = ctx.driving
    ? 'Test-driving the branch — merge when it looks right.'
    : failed > 0
      ? `Run finished with ${failed} failed ticket${failed === 1 ? '' : 's'} — review, then ship.`
      : run
        ? 'Checks are in. Test-drive the branch, then merge to ship.'
        : 'No run has been recorded on this branch — test-drive it yourself before merging.'
  return {
    kick: 'NEXT STEP',
    title: ctx.driving ? 'Merge when it looks right' : 'Test drive, then ship',
    desc,
    primary: { label: 'Merge & ship', kind: 'merge' },
    secondary: [testDriveAction, ...addressNotes, ...iterate],
    busy: false,
    ...driveWarning,
  }
}
