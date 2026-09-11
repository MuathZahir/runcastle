# Outcome — Failure-aware scheduling for review and verification passes

When implementation or fix tickets fail (usage limit, merge conflict, etc.), the review and verification passes should not burn as if the work landed — halt run-level fatal errors early and gate both passes on what actually landed.

- Shipped: 2026-09-11
- Laps run: 2

## What shipped

25 commits · 12 files

### Lap 1
- 4 tickets landed: #1 Run-fatal error class + run halt in the scheduler; #2 Review and verification passes wait for a whole feature; #4 Generic permission and HTTP status errors can halt the whole run; #5 The accepted retry ADR still contradicts the new run-fatal contract
- 0 waived
- 0 failed

### Lap 2
- 4 tickets landed: #7 Order-insensitive credential context in the run-fatal classifier; #8 Repair the onChildSpawn/NoSandboxOptions typecheck break; #10 A refusal word can satisfy the credential-subject half by itself; #11 Bare `auth` matches ordinary words before a refusal
- 0 waived
- 0 failed

## Review record

### Lap 1 · review

- Reviewed commit: 241b534ed41b3f039e45438697f1885bf47ebade
- Landed since: 6
- Outcome: done

### Lap 1 · verification

- Reviewed commit: 326b671a2c846a3db8bade89cc1fbf9a90464b79
- Landed since: 4
- Outcome: done

### Lap 2 · review

- Reviewed commit: a355b6d2e97714f3d36556ec5b068e7578098686
- Landed since: 2
- Outcome: done

### Lap 2 · verification

- Reviewed commit: unknown
- Landed since: 0
- Outcome: cancelled

### Lap 2 · verification

- Reviewed commit: 0d9c5774f6998b3349b9b3748a81e1d142beeb2b
- Landed since: 0
- Outcome: done

- No findings

## Notes record

- No human notes

## Per-ticket digests

### Lap 1

#### 1. Run-fatal error class + run halt in the scheduler

# Ticket 1 — run-fatal error class + run halt in the scheduler

## What was done

`classifyTicketRunError` now returns a third verdict, `run-fatal`, for the failures that
are facts about the account or the image rather than about the ticket: auth/OAuth/API-key,
billing/credit/`insufficient_quota`, the codex login wordings (401/403, "not logged in",
refresh token, `CODEX_API_KEY`), a brand-new `/usage limit/i` pattern for the Anthropic
subscription cap, and a missing agent binary. Model-not-found, `invalid_request_error` and
resumeSession stay plain ticket-level `fatal`, and unknown wordings still default to `fatal`.
A failed `TicketOutcome` may now carry `runFatal: { runtime }`; `burnTicket` sets it on the
missing-binary return and on the terminal return when the verdict is run-fatal (which never
reaches the retry loop, because it is not `retryable`).

In `burnTickets`, the first outcome carrying `runFatal` halts the run: the ticket is failed
and recorded as usual, one `run.halted` event is emitted (`data: { runtime, ticketSeq }`),
in-flight lanes whose resolved runtime equals the failing one are aborted through a new
`haltTicketRun` — the same abort-then-kill path "Stop ticket" uses, so their commits are
preserved — lanes on the other runtime run to their natural finish and land, and every
pending ticket is left untouched at `pending`. No cascade, no further dispatch, no review
start, no verification pass. `burnRun` reports the run failed with a summary that opens
with the halt cause. The scheduler learns each lane's runtime through a new optional
`BurnDeps.ticketRuntime`, wired in `resolveBurnDeps` from the existing `ticketCredentials`.

## Surprises

- The classifier's tests do not live in either file the ticket named — they are in
  `packages/server/test/burn-robustness.test.ts`, where 19 assertions asserted `fatal` for
  exactly the wordings this feature reclassifies. They were updated, not deleted, and
  split into `fatal:` and `run-fatal:` cases.
- The web lane derivation (`apps/web/src/lib/feature-ui/run.ts`) recognised a stopped lane
  by `error.startsWith('stopped by user')`, so the new `stopped: run halted (…)` wording
  would have rendered a halted lane as a plain failure. That is fallout of this ticket's
  own wording change, so the predicate was widened to `startsWith('stopped')` with a test —
  the only line of this diff outside `packages/server`.
- Two pre-existing test failures, neither in this diff's import graph:
  `dev-pane.test.ts > kills the child process tree…` fails in isolation too (it wants a
  real process group reaped, which this container will not do), and
  `pty-teardown.test.ts > returns within the deadline…` is a wall-clock flake that appeared
  only under full-suite load and passed both in isolation and on the final full run.
  The stated baseline ("fully green") does not hold for the first of those here.
- Drive machinery: this ticket adds no service, env var, seed or process, so `.runcastle/`
  needed no edit. Both scripts it names (`drive-setup.ts`, `drive-stop.ts`) are present;
  they are TypeScript, so there was no `bash -n` to run, and nothing was executed.

## Left undone

- `executeReviewTicket` (the host-side review path in `review-ticket.ts`) writes its own
  literal `'stopped by user'` and never classifies its errors, so a review lane that hits a
  dead account fails ticket-level rather than run-fatally. Harmless today — a review is
  never concurrent with an implementation lane, and it is the run's last work — but it is
  the one execution kind the halt does not reach.
- The review/verification gates themselves (decisions 2, 5, 6 — removing the
  failed-counts-as-satisfied carve-out, the ≥1-landed requirement, the all-cancelled
  collapse) are ticket 2's; `satisfied()`, `failedBlockerNote` and `verificationDue` were
  deliberately left exactly as they were.

#### 2. Review and verification passes wait for a whole feature

# Ticket 2 — review and verification passes wait for a whole feature

## What was done

The review-kind carve-out in the burn scheduler is gone: `satisfied()` now means
`done || cancelled` for every kind, and it no longer needs the ticket, only the status.
In its place `burnTickets` grew a `reviewGate()` that reads the run's own implementation
tickets (not the declared `blockedBy` edges, for the same reason `implementationsSettled`
does not): still burning → `wait`; any failed → `defer`; had work but landed none of it →
`collapsed`; otherwise `ready`. `ReadyState` carries the two new verdicts, and the
scheduler loop's old "cascade" pass became a "settle" pass that handles all four
non-startable outcomes — a deferred review leaves the scheduler's `pending` set without
any row write (so it ends the run still `pending` for the next burn, and the loop cannot
spin on it), a collapsed one is written `cancelled` with the reason
"nothing landed — every implementation ticket in the run was cancelled". `burnTickets`
returns the `deferred` and `collapsed` seqs; `burnRun` counts collapsed tickets as
cancelled rather than as work owed (so an all-cancelled run finalizes `succeeded`) and
appends "— review deferred until the failed ticket(s) are retried or cancelled" to the
summary of a run that deferred. Two events carry it on the stream: `ticket.deferred` and
the usual `ticket.cancelled`. `failedBlockerNote` and the failed-siblings annotation in
`harvestDigest` are deleted; `harvestDigest` is now one line. `verificationDue` returns
not-due when any non-review ticket of the run is `failed`, keeping both existing guards.

## Surprises

- **The review-scheduling tests are not in either file the ticket named.** They live in
  `packages/server/test/review-ticket.test.ts` (`describe('a review ticket survives a
  failed implementation ticket')` and the run-digest describe below it). That describe is
  rewritten as "a review ticket waits for a whole feature" with the four new cases; the two
  failed-blocker-note digest tests are deleted. `ticket-burner.test.ts` needed no edits at
  all — its cascade, concurrency and run-halt suites pass unchanged, which is the evidence
  that implementation-ticket cascade behaviour is untouched.
- **A missing blocker still cascades a review to failed**, unlike a failed one. Kept
  deliberately: no human retry can produce a ticket the run does not have, so deferring it
  would strand the review forever. There is a test pinning that difference.
- **A run with zero implementation tickets must not collapse.** The existing
  "fix tickets minted while the run is live" suite opens a run whose only ticket is a
  review; `reviewGate` therefore collapses only when the run *had* implementation tickets
  and none of them landed.
- **Verification at the scheduler seam is not observable with the current fakes**: the
  test `updateTicket` fakes never stamp `completedAt`, so `verificationDue` is short-
  circuited by that alone and a scheduler-level "no verification after a failed fix" test
  would pass without the change. The gate is tested at the pure function, as the spec's
  seam list asks.
- Pre-existing failure, unchanged and outside this diff's import graph:
  `dev-pane.test.ts > kills the child process tree…` (fails in isolation here too — it
  wants a real process group reaped). Everything else is green: 3458 passed, 4 skipped.
- Drive machinery: no service, env var, seed or process is added, so `.runcastle/` needed
  no edit. Both scripts it names are present; they are TypeScript, so there was no
  `bash -n` to run, and nothing was executed.

## Left undone

- `docs/features/improve-workflow/decisions.md#9` still states the carve-out as live. It is
  a historical record of that feature's session and this feature's own spec/decisions
  record the amendment, so it was left alone — but a reader who lands on it first will be
  told the opposite of what the code now does.
- The collapse path makes every ticket in the run terminal, so a feature whose work was
  entirely cancelled will auto-advance on G4 into `review` phase with no review ever having
  run. That is the pre-existing G4 rule meeting decision 6, not something this ticket
  changed, and no test pins it either way.

#### 4. Generic permission and HTTP status errors can halt the whole run

# ticket(4) — generic permission and HTTP status errors no longer halt the run

## What was done

The run-fatal classifier matched `permission denied` and a bare `401`/`403` as
standalone triggers, so failures that have nothing to do with the account — a
git checkout refused by a file mode, an HTTP 403 from some unrelated call
inside the sandbox — stopped scheduling for every remaining ticket in the run.
Both now pair with a shared `CREDENTIAL_SUBJECT` fragment: the vocabulary that
says the refusal was the *account's* (api key, token, credential, login, auth,
unauthorized, forbidden, account, organisation, org). `permission denied`
becomes `ACCOUNT_PERMISSION_DENIED` in the runtime-neutral table, and the codex
`\b401\b|\b403\b` becomes `REFUSED_CREDENTIAL_STATUS`. Anything unrecognized
falls back to ticket-level `fatal`, which is the direction the spec asks for.

I re-ran the reviewer's repro step exactly — `bun test
packages/server/test/burn-robustness.test.ts` with
`classifyTicketRunError(new Error('git checkout failed: permission denied'),
'claude-code')` and `classifyTicketRunError(new Error('request failed with
status 403'), 'codex')` added as cases. Before the fix both returned
`run-fatal` (4 failing cases, red confirmed); after it both return `fatal` and
the file is 68 pass / 0 fail. Those cases are committed, alongside an EACCES
wording and a bare `401` with non-account context.

## Deviation from the ticket's approach

My first commit also narrowed the bare `authentication` match in the same
regex. Self-review reverted it: the ticket is scoped to permission and status
wording, and the smaller reading of an acceptance criterion is the one to take.
`/authentication|unauthorized/i` is untouched from what ticket 1 landed.

## Surprises

- The verify baseline in the prompt is stale for this branch — it predicts 118
  files / 1768 tests, the branch actually runs 238 files / 3467 tests. Worth
  refreshing before the next lap reads it as authoritative.
- `bun test <file>` (the reviewer's repro command) and `bun run test` (vitest,
  the repo's command) are not interchangeable here: three tests in
  `ticket-burner-units.test.ts` call `vi.unstubAllEnvs`, which does not exist
  under bare `bun test`. They pass under `bun run test`.
- Two process-lifecycle tests fail in this container and are not mine — the diff
  touches only `ticket-burner.ts` regexes and their test file.
  `dev-pane.test.ts` ("kills the child process tree") fails consistently, alone
  and in the suite; `kill-registry.test.ts` ("unkillable process runs out its
  deadline") failed once under full-suite load and passes alone, so it is flaky
  rather than broken. `bun run typecheck` is 0 errors.

## Drive machinery

No edit needed and none made: the change adds no service, no required env var,
no seed, and no process the dev environment must run — it is a pure change to
regexes inside an existing module. Nothing under `.runcastle/` references the
classifier. Per the standing instruction I checked rather than ran.

## Left undone

Ticket 3's review also reported that accepted ADR-0006 still describes auth and
billing failures as ticket-level fatal, which now contradicts the run-fatal
contract this lap introduced. That is a documentation fix in another file and
was not part of this ticket; it remains open.

#### 6. Verify the fixes that landed

Gates verification pass

Verified pass #3 against `main`, inspecting only the landed fixes from tickets #4 and #5.

No verify commands are configured, so there were no gates to run; the pass was spent on the fix diffs as instructed.

## Fixes verified

- Ticket #4's original false positives are fixed: `git checkout failed: permission denied` for `claude-code` and `request failed with status 403` for `codex` now fall through to ticket-level `fatal`, rather than halting the run. The added regression cases cover those exact repros plus filesystem `EACCES` and a non-account bare `401`.
- Ticket #5 holds: ADR-0006 Decision 1 now documents `retryable`, ticket-level `fatal`, and `run-fatal`; names the account/image trigger families; preserves fatal-by-default for unknown wording; and describes the implemented whole-run dispatch halt, runtime-scoped in-flight stop, other-runtime drain, pending preservation, failed finalization, and retry/cancel recovery.

## Open verification finding

- Medium — credential-qualified refusals are order-sensitive (`finding_mc7vjDv9mYVh`). `ACCOUNT_PERMISSION_DENIED` and `REFUSED_CREDENTIAL_STATUS` require credential context to appear after `permission denied` or `401`/`403`. Messages such as `API token permission denied` and `forbidden response: status 403` therefore fall back to ticket-level `fatal` even though they explicitly describe account/auth failures that the spec classifies as `run-fatal`. Ticket #4 fixes its listed repros, but not both word orders of the intended account-qualified rule.

<promise>COMPLETE</promise>

### Lap 2

#### 7. Order-insensitive credential context in the run-fatal classifier

# Ticket 7 — order-insensitive credential context in the run-fatal classifier

## What was done

The two narrowed run-fatal patterns in `packages/server/src/workflows/ticket-burner.ts` —
`ACCOUNT_PERMISSION_DENIED` and `REFUSED_CREDENTIAL_STATUS` — no longer require the
credential subject to follow the refusal. Both are now built by one small helper,
`refusalNamingCredential(refusal)`, which emits a regex matching the refusal and the
subject in either order on the same line (`refusal…subject|subject…refusal`). The
`[^\n]*` same-line constraint is kept, so a `403` still cannot borrow the word `token`
from a stack frame further down the message. `forbidden` joined `401`/`403` as a refusal
wording, which is what makes `forbidden response: status 403` pair (`forbidden` is
itself in `CREDENTIAL_SUBJECT`, so it satisfies the subject half of the `403`). The
subject list itself is untouched, and both constants stay in the same pattern tables they
were in — `ACCOUNT_PERMISSION_DENIED` runtime-neutral, `REFUSED_CREDENTIAL_STATUS`
codex-only. Doc comments on both, and on `CREDENTIAL_SUBJECT`, now say the pairing is
order-insensitive. Tests added to `packages/server/test/burn-robustness.test.ts`; lap-1's
false-positive regression cases were already there and were left as the regression set.

The reviewer's repro step was re-run verbatim as a direct classifier call, after the
change: `API token permission denied` (claude-code) → `run-fatal`, `forbidden response:
status 403` (codex) → `run-fatal`, `git checkout failed: permission denied` (claude-code)
→ `fatal`, `request failed with status 403` (codex) → `fatal`, unknown wording → `fatal`.
All five as specified.

No deviation from the ticket's approach.

## Surprises

- The repo's test command is **vitest** (`bun run test`, 238 files / 3472 tests), not
  `bun test`. Running the ticket's suggested `bun test <files>` directly produces 3
  spurious failures in `ticket-burner-units.test.ts` (`vi.stubEnv` / `vi.unstubAllEnvs`
  are undefined in Bun's own test shim) — decision 10's environment note in a slightly
  different costume. Under the repo runner those three pass.
- The prompt's baseline is stale in both directions: `bun run typecheck` is now clean
  (decision 9's `onChildSpawn` break is already gone from this checkout), and the suite is
  238 files / 3472 tests, not 118 / 1768. Two failures remain, neither mine:
  `dev-pane.test.ts > kills the child process tree…` fails identically with the source
  reverted to the pre-ticket commit (it is real process-tree killing in a sandbox that
  cannot do it), and `pty-teardown.test.ts > returns within the deadline…` passes in
  isolation, so it is a deadline flake under full-suite load.

## Left undone

- `CREDENTIAL_SUBJECT` matches `auth` as a bare substring, so a message like
  `authored by X: permission denied` now pairs from the left as well as the right. That
  looseness predates this ticket (the same word matched after the refusal before), and
  decision 8 explicitly keeps the subject list as-is, so I did not tighten it. If a false
  halt ever shows up in a real burn, that substring is where to look.
- No drive-machinery change: this ticket adds no service, required env var, seed, or
  process, so `.runcastle/drive-setup.ts` and `.runcastle/drive-stop.ts` needed no edit —
  I confirmed both files still exist and are the ones the configured commands name, and
  did not run them (no services in this sandbox).

#### 8. Repair the onChildSpawn/NoSandboxOptions typecheck break

# Ticket 8 — Repair the onChildSpawn/NoSandboxOptions typecheck break

## What was done

I re-ran the reviewer's repro step first, exactly as `finding_lPOOU2AbOC3_` states
it: `bun run typecheck` on this branch. **It exited 0.** There is no type drift in
the repository — the sandcastle patch (`patches/@ai-hero%2Fsandcastle@0.12.0.patch`,
hunk at its line 188) already declares `readonly onChildSpawn?: (pid: number) => void`
on `interface NoSandboxOptions` in `dist/sandboxes/no-sandbox.d.ts`, matching the
runtime hunk exactly. The ticket's hypothesis ("the installed TYPE doesn't declare
it — patch/type drift after a dependency bump") is not what happened.

The real cause is ADR-0011 §2's known tax: commit `d390a3e` *changed* an
already-applied patch to add the kill handles, and "a plain `bun install` does not
always re-apply a changed patch." Any checkout whose `node_modules` predates that
commit keeps the old, unpatched type — and the two call sites go red. I confirmed
this by simulating the stale install (deleting the `onChildSpawn` block from the
installed `.d.ts`) and reproducing the reviewer's two errors *verbatim*:

```
src/workflows/review-ticket.ts(508,26): error TS2353: ... 'onChildSpawn' does not exist in type 'NoSandboxOptions'.
src/workflows/ticket-burner.ts(3562,46): error TS2353: ... 'onChildSpawn' does not exist in type 'NoSandboxOptions'.
```

The fix is the ticket's second sanctioned option — a module augmentation,
`packages/server/src/workflows/sandcastle-patch.d.ts` (41 lines, type-only, zero
runtime change) — restating the property so `bun run typecheck` gates this
repository rather than the freshness of one machine's `node_modules`. Verified
green **both** with the stale install simulated and with `node_modules` restored
to pristine. I did not re-align the patch: it was already correct, so there was
nothing to re-align.

## Surprises

- **The finding was not reproducible as written**, and the diff that satisfies it
  is therefore not the diff the ticket predicted. Had I "fixed" the patch as
  instructed I would have edited something that was already right.
- **Silencing this error masks nothing.** I checked before deciding: the runtime
  half of the patch is independently guarded by
  `packages/server/test/sandcastle-kill-handles.test.ts` — written for precisely
  this risk ("the patch's standing risk is that a `bun install` silently stops
  applying it"), driving the compiled provider rather than a re-implementation —
  and by the `/\.onChildSpawn\?\.\(/` regex marker in
  `packages/server/scripts/publish-manifest.ts` (ADR-0011 §3). A stale install now
  fails in the place built to explain it, instead of in an unrelated gate.
- **The prompt's test baseline is stale.** It predicts "118 files, 1768 passed";
  this branch actually runs 238 files / 3467 tests.
- **One full-suite failure, pre-existing and not mine:**
  `packages/server/test/dev-pane.test.ts:183` (`expect(pidAlive(-pgid)).toBe(false)`
  — a process-group reap assertion). It is not in the prompt's baseline list, so I
  confirmed it per instructions: it fails standalone, and it fails identically with
  my file moved out of the tree. A type-only `.d.ts` has no causal path to a PID
  liveness check. Everything else is green: 236 files / 3462 passed.

## Left undone

- **ADR-0011 §2's bump procedure does not mention the new augmentation.** A
  sandcastle bump must now re-check two places, not one. I put that warning in the
  file's own header rather than editing `docs/adr/0011-sandcastle-patch-is-permanent.md`,
  which is outside this ticket. Worth a one-line ADR amendment by someone whose
  ticket permits it.
- **The `dev-pane.test.ts` failure is unowned.** Pre-existing, environment-shaped
  (process groups in a container), and outside this ticket. Note that decision 10
  already records other host-environment findings for this branch; this looks like
  another, but I did not diagnose it.
- **The underlying stale-patch trap is untouched.** Nothing forces a developer to
  run ADR-0011's `rm -rf node_modules/.bun/@ai-hero+sandcastle@0.12.0 && bun install --force`
  after pulling a changed patch. A postinstall guard could detect it; that is a
  feature, not this ticket.

## Drive machinery

No edit needed and none made: this change adds no service, no required env var, no
seed, and no process the dev environment must run — it adds a type declaration. Per
the standing instruction's own triggers, nothing under `.runcastle/` applies. I did
not run the drive scripts (no services in this sandbox, as instructed).

## Verification

- `bun run typecheck` → **exit 0** (core, server, web, plus `scripts/`).
- `bun run typecheck` with the stale install simulated → **exit 0** with the fix,
  **exit 1** with the two reported errors without it.
- `bunx vitest run` over `ticket-burner-units`, `ticket-burner`,
  `sandcastle-kill-handles`, `kill-registry` → **4 files, 234 tests, all passed**.
- `env -u GIT_ASKPASS bun run test` → 236 files / 3462 passed, 1 pre-existing
  failure (`dev-pane.test.ts`, confirmed unrelated above).
- `node_modules` was restored byte-identical after the simulation (`diff` clean).

#### 10. A refusal word can satisfy the credential-subject half by itself

# Ticket 10 — a refusal word no longer satisfies the credential half by itself

## What was done

The lap-2 pairing rule let one word play both parts: `forbidden` sat in the
refusal alternation of `REFUSED_CREDENTIAL_STATUS` *and* in `CREDENTIAL_SUBJECT`,
so `403 forbidden` — a generic HTTP status with its own reason phrase, naming no
api key, token, credential, login, auth, account or org — classified `run-fatal`
and could halt a healthy run. In `packages/server/src/workflows/ticket-burner.ts`
the bare `forbidden` subject was replaced by `DETACHED_FORBIDDEN`: the word
counts as a credential subject only when the 401/403 it is the reason phrase for
is *not* sitting immediately beside it (lookbehind/lookahead over `[\W_]*`). The
status numbers moved into a shared `REFUSAL_STATUS` constant used by both the
subject guard and the refusal alternation.

The reviewer's repro was added verbatim to
`packages/server/test/burn-robustness.test.ts` and re-run:
`classifyTicketRunError(new Error('403 forbidden'), 'codex')` now returns
`'fatal'`, and the repro no longer reproduces. Two guards came with it —
`Forbidden (403)` (the same pair the other way round) is also ticket-fatal, and
`403 forbidden: invalid api key` is still run-fatal, so the narrowing does not
get in the way of a message that genuinely names an account.

## Surprises

- The spec pins `forbidden response: status 403` as a run-fatal sentinel
  (decision 8, Approach §1), and that string names no credential noun either —
  the only thing separating it from `403 forbidden` is the prose between the two
  halves. So the fix could not simply drop `forbidden` from the subject list; it
  had to turn on adjacency. Worth knowing that the surviving sentinel rests on
  word spacing rather than on anything the message actually names.
- The verify baseline in the burn prompt (118 files / 1768 tests) is stale for
  this branch: the suite is 238 files / 3475 tests here.
- `bun run test` is red on one unrelated test:
  `packages/server/test/dev-pane.test.ts > kills the child process tree…`
  (`expect(pidAlive(-pgid)).toBe(false)`). Confirmed on a single targeted rerun.
  It is a process-group reaping fact of this container — my diff touches only two
  regex constants and a test file, nothing in the dev-pane path. Everything else
  passes; `bun run typecheck` is fully green (0 errors).
- The host Bun-version problem recorded in decision 10 is not present in this
  sandbox (Bun 1.3.14, which satisfies the `>=1.3.14` requirement).

## Left undone

- The review's second finding — ordinary words such as `author` satisfying the
  unbounded `auth` subject before `permission denied` — is a separate ticket and
  was deliberately left alone; `auth` in `CREDENTIAL_SUBJECT` is still unbounded.
- Drive machinery: no edit needed. This ticket adds no service, no required env
  var, no seed and no extra process, so none of the `.runcastle/` triggers fire.
  I did not run `drive-setup`/`drive-stop` (no services in this sandbox) and made
  no change to them.

#### 11. Bare `auth` matches ordinary words before a refusal

# Ticket 11 — bare `auth` matched ordinary words before a refusal

## What was done

`CREDENTIAL_SUBJECT` in `packages/server/src/workflows/ticket-burner.ts` listed `auth` as a
loose substring, so any word containing it — `author`, `authored`, `co-authored-by` — supplied
the credential context that lap 2's either-order pairing looks for, and `git author permission
denied` halted the whole run. The subject now spells `auth` out to its credential endings
(`auth(?:entic\w*|ori[sz]\w*|[nz])?\b`), which still matches `auth`, `oauth`, `authentication`,
`authorization`/`authorized`, `authn`/`authz`, but no longer matches `author*`. Nothing else in
the classifier changed; the fix is one alternative in one regex plus the comment explaining why
it is spelled out. The narrowing was driven by a failing test added first to
`packages/server/test/burn-robustness.test.ts` (`git author permission denied` and the
reverse-order `permission denied reading the authored patch`), which reproduced the reviewer's
repro exactly — `run-fatal` before, `fatal` after.

I re-ran the reviewer's repro step: `classifyTicketRunError(new Error('git author permission
denied'), 'claude-code')` now returns `fatal`, and it is pinned by the new test so it cannot
drift back. I also spot-checked the boundary in both directions to confirm no over-narrowing:
`OAuth permission denied`, `permission denied: authorization expired`, `authz permission
denied`, `permission denied for this org`, `API token permission denied` and `permission
denied: invalid api key` all remain run-fatal.

## Surprises

- `bun run typecheck` is green on this branch (ticket 8's declaration fix landed), so the
  "gates unverifiable" condition earlier laps reported no longer applies here.
- The full suite has one failure that is **not** mine and **not** in the stated baseline:
  `packages/server/test/dev-pane.test.ts` — "kills the child process tree so the port-holder is
  not orphaned" — expects the pty process group to be reaped after `stopDevPane`. I confirmed it
  by running the same file from a scratch `git worktree` at the pre-change commit `a355b6d`,
  where it fails identically. It is a container process-reaping/timing fact, not a regression.
  The suite otherwise ran 238 files, 3469 passed, 4 skipped — note the counts in the prompt's
  baseline (118 files / 1768 passed) are stale for this branch.

## Left undone

- The sibling finding from the same review — `forbidden` acting as both the refusal and its own
  credential subject in `REFUSED_CREDENTIAL_STATUS`, so a generic `403 forbidden` reads as
  run-fatal — is untouched here; it is another ticket's territory and needs a change to the
  pairing, not to the subject list.
- Drive machinery: this ticket adds no service, env var, seed, or process, so `.runcastle/`
  needed no edit and I did not run those scripts (correctly — this sandbox has no app).

#### 13. Verify the fixes that landed

Gates verification pass

Verified the two fixes landed after pass #9 against their findings and repro cases.

- #10 held. `REFUSED_CREDENTIAL_STATUS` now uses `DETACHED_FORBIDDEN`, which prevents a status code's own reason phrase from satisfying the credential-subject half. The regression coverage expects both `403 forbidden` and `Forbidden (403)` to remain ticket-level `fatal`, while `403 forbidden: invalid api key` remains `run-fatal` because it supplies real credential context.
- #11 held. `CREDENTIAL_SUBJECT` no longer uses bare substring `auth`; it accepts the intended auth/authentication/authorization/authn/authz forms with a word boundary. The regression coverage expects `git author permission denied` and `permission denied reading the authored patch` to remain ticket-level `fatal`.

This project has no verify commands configured, so there were no gates to run. No verification findings were found, and nothing else was reviewed beyond the landed fixes.

<promise>COMPLETE</promise>
