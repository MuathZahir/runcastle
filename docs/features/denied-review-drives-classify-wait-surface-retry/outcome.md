# Outcome — Denied review drives: classify, wait, surface, retry

Split review-drive denials into retriable vs. final, make review agents wait out slot contention with a timeout, and give dirty-tree denials a loud event plus a human-facing retry path instead of a silent Gates-mode downgrade.

- Shipped: 2026-09-10
- Laps run: 1

## What shipped

21 commits · 21 files

### Lap 1
- 5 tickets landed: #1 Classify drive denials; emit the loud dirty event; teach the review agent to wait; #2 Retry a dirty-denied review: loosen per-ticket retry, resume the reviewer; #3 Review panel banner: surface the dirty denial, wire Retry review; #5 Review panel banner and Retry review affordance are missing; #6 Externally visible denial contract bypasses the core wire-type package
- 0 waived
- 0 failed

## Review record

### Lap 1 · review

- Reviewed commit: 4d4a26fa983b4116d99e245364efab2b0caaa58c
- Landed since: 3
- Outcome: done

### Lap 1 · verification

- Reviewed commit: 26ba2d1f2030bcd69ae3681cb8ac7ddb7eeb14b5
- Landed since: 0
- Outcome: done

- No findings

## Notes record

- No human notes

## Per-ticket digests

### Lap 1

#### 3. Review panel banner: surface the dirty denial, wire Retry review

# ticket(3) — Review panel banner: surface the dirty denial, wire Retry review

## What was done

The review page now leads its alerts band with a banner whenever a review drive
was refused over a dirty working tree. Three pieces:

- `reviewDriveDenial(events, runs, dismissedEventId)` in
  `apps/web/src/lib/feature-ui/drive.ts` — the visibility rule, as one pure read
  of the event feed the panel already fetches plus the run list `feature.get`
  already returns. No new server query was needed. It deliberately mirrors the
  server's own retry-eligibility rule from ticket 2 (`latestRunDeniedDirty`):
  the latest `reviewdrive.denied` counts while its `ts >= ` the latest run's
  `startedAt`. That single rule buys both "clears when the retry burn starts"
  and "clears when any later burn superseded it", and it guarantees the banner
  is up exactly when `ticket.retry` would accept the ticket it offers to re-burn.
  Dismissal is folded into the same function as an event-id argument, so
  "dismissal is keyed on the denial" is one testable fact rather than a rule
  split across a component and a helper.
- `apps/web/src/components/review/DeniedDriveCard.tsx` — the hook-free card plus
  the wired `DeniedDriveAlert`, copying the `ConflictCard`/`ConflictAlert` split
  that already lives in that band. Amber (`border-warn/45`), not the conflict
  card's red, because the review fell back rather than failed. Retry review calls
  `trpc.ticket.retry`; the refusal is held in local state and rendered inside the
  banner via the existing `FailureNote` primitive — not a toast, since the point
  of the refusal is a file list the human has to go and act on.
- `ReviewBody` holds the `dismissedDenial` event id and gates on
  `feature.phase === 'review'`, and keys the alert on the event id so a refusal
  answered about an old denial cannot linger under a new one.

Tests: `apps/web/test/denied-drive.test.ts` (tier 1 — the derivation and the
card's markup), `apps/web/test/denied-drive-retry.test.tsx` (tier 2 — the two
clicks, against a stubbed tRPC whose mutation callbacks the test drives), and
four new cases in the existing `review-bands.test.ts`, which is the orchestrator's
own composition test and now feeds `ReviewBody` an event feed and a run list.

## Surprises

- **`ReviewBody` mounts for features that are past review.** The phase-body
  dispatch switches on the *viewed* phase (`effective`), not `feature.phase`, so
  looking back at review on a shipped feature renders this component with
  `readonly`. The phase gate and the card's own readonly answer are therefore two
  independent facts, and each has its own test. I nearly wrote them as one.
- **The baseline in the prompt does not describe this repo.** It said 118 files /
  1768 passed; the suite here is 240 files / 3486 tests.
- **One pre-existing failure, not in the listed baseline.**
  `packages/server/test/dev-pane.test.ts` › "kills the child process tree so the
  port-holder is not orphaned" fails: after the kill, `kill -0 -pgid` still
  succeeds, so the process group has not been reaped. Confirmed on a single
  targeted run of that one file. It is a sandbox process-reaping behaviour, and
  my diff touches only `apps/web` — no server file, and nothing that test
  imports. Everything else is green: `bun run typecheck` 0 errors, and the rest
  of the suite passes.

## Left undone

- **The digest wording is ticket 1's, and I did not touch it.** The banner and
  the digest now both describe the same denial; if they ever disagree, the
  skill text is the other half.
- **No banner for a `slot_held` timeout**, deliberately — decision 5 says slot
  polling emits nothing and the digest covers it. If that is ever revisited, the
  derivation here filters on the event type alone and would need a second one.
- **Dismissal does not survive a reload.** Decision 7 allows sessionStorage and
  does not require it; the state is component-local. A reload re-shows a denial
  the human waved away, which errs toward visible.
- **Drive machinery:** nothing to update. This ticket adds no service, no
  required env var, no seed and no process — only web components and a pure
  derivation — so `.runcastle/drive-setup.ts` and friends are untouched and
  already cover it. I did not run them (no services in this sandbox) and did not
  need to.

#### 5. Review panel banner and Retry review affordance are missing

# Ticket 5 — review panel banner and Retry review affordance

## What was done

The human-facing half of the feature now exists in `apps/web`. Three pieces:

- `reviewDriveDenial(events)` in `src/lib/feature-ui/drive.ts` — a pure derivation over the
  feature's event feed that returns the latest `reviewdrive.denied` (its timestamp and the
  `dirtyFiles` off `data`), or null once a `ticket.retry`, `burn.started` or `feature.shipped`
  has answered it. A later denial raises it again. It reads the feed the way `lapAbort` does
  rather than comparing run timestamps the way the server's `latestRunDeniedDirty` does —
  the events the web app already polls are the only record the panel has, and the clearing
  events line up with the same moments (a retry burn starting is also how the feature leaves
  review).
- `src/components/review/ReviewDriveDeniedCard.tsx` — the banner, in the review page's alert
  slot: what was refused, that the review ran repo-only instead, the dirty files listed, and
  **Retry review** plus **Dismiss**. Split hook-free card + wired `ReviewDriveDeniedAlert`
  exactly as `ConflictCard`/`ConflictAlert` is, so the anatomy is tier-1 testable without a
  tRPC provider. The wired half calls the existing `ticket.retry` mutation — no second retry
  flow — and surfaces the endpoint's still-dirty refusal as a toast.
- `ReviewBody.tsx` wires them: the ticket handed to retry is the latest `done` review ticket
  (a denial never ends a review, so it is `done`, not `failed`), and dismissal is stored as
  the dismissed denial's timestamp so a new denial reopens the banner.

Tests: `apps/web/test/review-drive-denied.test.ts` (derivation lifecycle + card anatomy) and
a new band block in `apps/web/test/review-bands.test.ts` covering the composition — banner up
on a denial, down after `ticket.retry`, absent under `readonly`. Extending the band test meant
giving its `useEventLog` mock a seedable event list and adding `ticket.retry` to its tRPC mock.

Re-ran the reviewer's repro step: `apps/web` files are now in the branch diff (`origin/main`
was used — there is no local `main` ref in this sandbox), and `rg -n "reviewdrive\.denied|Retry review" apps/web`
finds the derivation, the component and the tests. It no longer reproduces.

## Surprises

- The stated baseline is stale in two ways. The suite is 239 files / 3477 tests, not 118 /
  1768. And it is not fully green: `packages/server/test/dev-pane.test.ts:183` ("the process
  group must be gone") fails both in the full run and on its own, on a file this ticket never
  touched — a process-group reaping assertion that looks sandbox-dependent. Everything else
  passed (237 files, 3472 tests), typecheck is 0 errors.
- The banner needs a *ticket id* to retry, but the `reviewdrive.denied` event carries no
  `ticketId` — it is emitted from the drive guard with only the feature. So the panel picks
  the latest `done` review ticket, which matches how `reviewOutcome` already resolves "the"
  review. If a lap ever emits more than one review ticket, that pick is the seam to revisit.
- No drive-machinery change was needed (no new service, env var, seed or process), so
  `.runcastle/` is untouched; nothing there was run, per the check-don't-run rule.

## Left undone

- `apps/web/src/lib/feature-ui/drive.ts` ends with an orphaned doc comment (the `reviewRow`
  it documented lives in `review.ts` now). Left alone — not this ticket's diff.
- The banner does not distinguish a *slot-held timeout* from a dirty denial, because by
  decision §5 slot-held polling emits no events at all. If that ever changes, this derivation
  is where the second state would land.

#### 6. Externally visible denial contract bypasses the core wire-type package

# ticket(6) — the denial contract now has a home in `@runcastle/core`

## What was done

The review finding was that the new drive-denial contract — the `DriveDenialCode`
enum plus the `deniedReason` / `deniedCode` / `retriable` / `dirtyFiles` clump —
was declared only inside `packages/server/src/services/git.ts`, written out twice
(once on `TestDriveResult`, once on `ReviewDriveResult`), and hand-copied field by
field across the `review_drive` tool boundary. `CLAUDE.md`'s package map says
`@runcastle/core` owns wire types, and these cross a wire: the review agent reads
`retriable` out of an MCP tool result.

So `packages/core/src/schemas.ts` now declares, next to the existing `DriveState`:
`DriveDenialCode` (the same three-member union, moved verbatim with its comment),
a `DriveDenial` interface holding the four refusal fields with their docs, and
`driveDenialOf(result)` — the pure helper that lifts the denial half out of any
result so a boundary carries it whole. In the server, `TestDriveResult` and
`ReviewDriveResult` now `extend DriveDenial` and declare only their own fields,
and both mappings in `reviewDrive` / `startReviewDrive` use `driveDenialOf`
instead of one and four conditional spreads respectively.

I chose a plain union type rather than a `z.enum` for `DriveDenialCode` (core has
both styles — `GateId` is a plain union, `DriveState` is a zod enum) because
nothing parses this value at runtime; a zod schema would have been an unused
export. No behaviour changed and no test needed editing: the denial shape is
already asserted at its seams in `git.test.ts` and `review-wires.test.ts`, and
those are what exercise `driveDenialOf`.

## Surprises

- The `stop` mapping in `reviewDrive` used to copy only `deniedReason`, so
  swapping in `driveDenialOf` looked like it might widen what a stop denial
  reports. It does not: the only two stop denials (`DENY_NONE_ACTIVE`,
  `DENY_DRY_RUN_ACTIVE`) are built as bare `{ ok: false, deniedReason }` and
  never carry a code — `deniedStart`, which is what derives `retriable`, is
  called from start paths only. The helper is equivalent today and stays correct
  if a stop denial ever gains a code.
- The verify baseline in my prompt says "118 files, 1768 passed". The suite
  actually reports **238 files, 3460 tests** on this branch, so the baseline's
  counts are stale even though its "expect fully green" intent is not.

## Verification

- Repro step re-run verbatim:
  `rg -n "ReviewDriveResult|TestDriveResult|DriveDenialCode|deniedCode|dirtyFiles" packages/core packages/server/src/services/git.ts packages/server/src/mcp/server.ts`.
  It no longer reproduces — the contract is now declared at
  `packages/core/src/schemas.ts:680–723`, and `git.ts` imports it from
  `@runcastle/core` rather than declaring it.
- `bun run typecheck` — exit 0, all four projects clean.
- `env -u GIT_ASKPASS bun run test` — 3455 passed, 4 skipped, **1 failed**:
  `packages/server/test/dev-pane.test.ts > kills the child process tree so the
  port-holder is not orphaned`, which asserts a PTY process *group* is reaped
  (`kill -0 -pgid` must throw ESRCH). It fails the same way on a single targeted
  re-run of that one file. It is not mine — my diff touches two type declarations
  and one object spread, and neither `pty/dev-pane.ts` nor its test is in it. It
  reads as this container's process-group semantics rather than a code defect,
  but I did not chase it, so treat it as unconfirmed-but-unrelated.
- Drive machinery: this ticket adds no service, env var, seed, or process, so
  `.runcastle/drive-setup.ts` and `drive-stop.ts` needed no edit and I did not
  run them (no app or services in this sandbox, as instructed).

## Left undone

- `packages/server/src/services/git.ts:2426` — the preparation dry-run's own
  start denial still returns a bare `{ ok: false, deniedReason }` with no
  `deniedCode`, even though it is a start refusal that a `slot_held`
  classification would fit. No review agent sees it (only the prep flow does), so
  classifying it was outside this ticket. Worth a look if the denial contract
  ever grows a second consumer.
- `DriveInfo`, `DriveHookFailure` and `DbDrift` are still server-declared types
  that appear on these same results. They do not cross the tool boundary the way
  the denial fields do, so the finding did not name them and I left them alone —
  but if a future ticket puts drive info on the wire, they are the next
  candidates for core.
- The web half of the feature (the `reviewdrive.denied` banner and its Retry
  button, spec §4) is not on this branch yet — nothing under `apps/web` reads
  `dirtyFiles` or the denial event. When it lands it should import `DriveDenial`
  from core rather than re-describing the shape, which is the whole point of
  this ticket.

#### 7. Verify the fixes that landed

Gates verification pass

Verified pass #4 against `main...feature/denied-review-drives-classify-wait-surface-retry` without checking out the integration branch.

## Result

All listed landed fixes held. No verification findings were found.

- Tickets #3 and #5 — the prior repro no longer reproduces. The branch diff now contains `apps/web` changes. `reviewdrive.denied` is derived into a prominent dirty-tree warning in the review alerts band, the dirty files are shown, **Retry review** calls the existing `ticket.retry` mutation with the completed review ticket, still-dirty refusals remain visible in the banner, dismissal is keyed to the denial event, and the banner clears on a retry/newer run or after leaving review. Focused component, interaction, lifecycle, and composition tests accompany the implementation.
- Ticket #6 — the prior contract-location repro no longer reproduces. `DriveDenialCode`, `DriveDenial`, and `driveDenialOf` are declared in `packages/core/src/schemas.ts`, exported through `@runcastle/core`, and imported by `packages/server/src/services/git.ts`. `TestDriveResult` and `ReviewDriveResult` extend the shared contract, and the review-drive mappings carry it with `driveDenialOf` rather than re-declaring or hand-copying the wire fields.

No verify commands are configured, so there were no gates to run; the pass was spent on the landed diffs and stated repros as required.

No Drive-mode tour or recording was started because the inherited mode is Gates.

<promise>COMPLETE</promise>
