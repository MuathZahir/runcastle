import type { DriveState } from '@runcastle/core'
import { driveView, slotHeldReason } from '../drive'
import { ONE_TERMINAL_WARNING } from '../gates'
import { burnLabel, noun } from '../tickets'
import { CHAT_ACTION } from './chat'
import type { CountLine, NextAction, NextStep } from './types'
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

/**
 * Chat rides every bar this resolver returns, first in `secondary` and never
 * reordering the trail's own verbs (decision 8) — BESIDE Merge & ship, Burn and
 * Test drive rather than anywhere among them. With open work it is the primary:
 * the agent is who acts on it.
 */
export function resolveReview(input: ResolverInput): NextStep {
  const { ctx, live, failed, pending, pendingTickets, run } = input
  const burnAction: NextAction[] =
    pending > 0 ? [{ label: burnLabel(pendingTickets), kind: 'burn' }] : []
  // One drive truth for the bar and the stage (decision 20). The server's value
  // wins whenever it says something is happening; with nothing from it yet, this
  // browser's own record of a drive it started stands in, so a start that has
  // not reached the poll still reads as a drive rather than as an offer to begin
  // one.
  const driveState: DriveState =
    ctx.driveState && ctx.driveState !== 'idle' ? ctx.driveState : ctx.driving ? 'serving' : 'idle'
  const driving = driveState !== 'idle'
  const view = driveView(driveState)
  // Any other drive — a dry run, another feature's, a project drive — holds the
  // same singleton slot, so the server refuses a feature drive outright while
  // one is up (decision 9) — said here rather than on click, naming the holder.
  // Unverified keys never disable: they are a caveat about what the drive may
  // do, not a reason it cannot run (decision 7), and the refusal outranks the
  // caveat when both apply.
  const testDriveAction: NextAction = driving
    ? { label: 'Stop test drive', kind: 'testDriveStop' }
    : {
        label: 'Start test drive',
        kind: 'testDriveStart',
        ...(ctx.slotHolder ? { disabled: slotHeldReason(ctx.slotHolder) } : {}),
      }
  // The unverified-drive caveat is not the bar's any more: it is a chip in the
  // state line, beside the Test drive control it is about. The bar carries one
  // line and it is the count (decision 3).
  const openNotes = ctx.openNotes ?? 0
  const openDefects = ctx.openDefects ?? 0
  const openWork = openNotes + openDefects
  // The bar states its own reason (decision 3). The chat leads BECAUSE work is
  // open, and until now the count that decided it was said in a paragraph the
  // guidance flag could hide — so the human stared at a primary whose input was
  // nowhere on the page. One permanent line, on every review bar, carrying the
  // two numbers the ladder below reads.
  const counts: CountLine =
    openWork > 0
      ? {
          pills: [
            ...(openDefects > 0
              ? [{ label: noun(openDefects, 'defect'), tone: 'danger' as const }]
              : []),
            ...(openNotes > 0 ? [{ label: noun(openNotes, 'note'), tone: 'note' as const }] : []),
          ],
          trailing: 'open',
        }
      : { pills: [{ label: 'Nothing open', tone: 'clear' }] }
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
      secondary: [CHAT_ACTION, retryMerge, ...burnAction, testDriveAction],
      busy: false,
      counts,
      // What the compound costs, said above the button that performs it.
      ...(live ? { note: ONE_TERMINAL_WARNING } : {}),
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
        CHAT_ACTION,
        { label: 'Merge & ship', kind: 'merge' },
        ...burnAction,
        ...(primary.kind === 'testDriveStop' ? [] : [testDriveAction]),
      ],
      busy: false,
      counts,
    }
  }

  // Something is still open — defects the review found, notes the human wrote
  // while driving, or both. They are the agent's to act on now (`the-feature-
  // lead-runs-rounds` decisions 10 and 18), so the chat is the door. Merge &
  // ship stays one click away and is never nagged about — open work is
  // information, not a block.
  if (openWork > 0) {
    // No title and no prose: the count line above IS what this state has to say,
    // and it says it whether or not guidance is on (decision 3).
    return {
      kick: 'NEXT STEP',
      primary: CHAT_ACTION,
      secondary: [
        { label: 'Merge & ship', kind: 'merge' },
        ...burnAction,
        testDriveAction,
      ],
      busy: false,
      counts,
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
      primary: { label: burnLabel(pendingTickets), kind: 'burn' },
      secondary: [
        CHAT_ACTION,
        { label: 'Merge & ship', kind: 'merge' },
        testDriveAction,
      ],
      busy: false,
      counts,
    }
  }

  // A review that verified nothing is the one state where the all-clear
  // below would be a lie (review-as-a-lap-trail decision 5): the run succeeded,
  // no defect is open, and nothing was checked. Nothing is blocked and Merge is
  // still one click away — what changes is that it is no longer THE click, and
  // the bar carries no primary at all here, because the one action that answers
  // this state is the Agentic review the page's own banner leads with. That
  // banner also says, with its reason, that nothing was verified — so the bar
  // offers only the next action (simplify-the-pages decision 9d).
  if (ctx.unverifiedReview) {
    return {
      kick: 'NEXT STEP',
      title: 'Run another review, or drive the branch yourself, before you ship',
      secondary: [{ label: 'Merge & ship', kind: 'merge' }, ...burnAction, testDriveAction],
      busy: false,
      counts,
    }
  }

  // "Checks are in" is an all-clear, so it needs checks to have run: the audit
  // found it over a feature with no run recorded at all (findings F23), which
  // is the state a feature born with its tickets, or an overridden gate, lands in.
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
    secondary: [CHAT_ACTION, testDriveAction],
    busy: false,
    counts,
  }
}
