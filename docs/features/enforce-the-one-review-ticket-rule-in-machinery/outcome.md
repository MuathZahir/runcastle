# Outcome — Enforce the one-review-ticket rule in machinery

The tickets skill's "every batch closes with exactly one kind: review ticket" rule is prompt-only and gets silently dropped — back it with server-side enforcement so a forgotten kind can't send a review into a burn sandbox.

- Shipped: 2026-09-08
- Laps run: 1

## What shipped

14 commits · 14 files

### Lap 1
- 4 tickets landed: #1 Enforce the review-ticket rule at G3 and the emit_tickets surface; #3 Review-less laps can still enter a burn because the live Burn path bypasses G3; #4 The required complete_phase refusal regression is missing; #5 The burner's verification-mint regression behavior has no test
- 0 waived
- 0 failed

## Review record

### Lap 1 · review

- Reviewed commit: 0829a67094b4ce30c1d1b403f4587dff9b87d459
- Landed since: 3
- Outcome: done

### Lap 1 · verification

- Reviewed commit: 3d10674158392146100802b8e036a76f1d381fcf
- Landed since: 0
- Outcome: done

- No findings

## Notes record

- No human notes

## Per-ticket digests

### Lap 1

#### 1. Enforce the review-ticket rule at G3 and the emit_tickets surface

# Ticket 1 — Enforce the review-ticket rule at G3 and the emit_tickets surface

## What was done

The `tickets-approved` case of `checkGate` (`packages/server/src/services/gates.ts`) now has
two preconditions instead of one: the current lap must have at least one burnable
(non-cancelled) ticket *and* at least one of those must be `kind: 'review'`. The refusal names
the fix in the message itself ("no review ticket on this lap — every batch closes with one
(kind: \"review\"); emit it, fix the kind on a review-shaped ticket, or override this gate with
a reason"). At least one, never exactly one; no `blockedBy`/ordering check. `overrideGate` is
untouched and still crosses the strengthened gate.

At the MCP surface, `toolEmitTickets` refuses the whole batch with a `GateError` when any
ticket's title matches `/^review[: ]/i` but its kind is not `review`, naming both outs (set the
kind, or retitle). It sits in the tool handler only, after `refuseIfReadOnly` and before
`storeTickets`, so the internal mints never meet it. `storeTickets` was not touched.

The tickets skill gained one line inside `<review-ticket>` saying the server enforces both
checks, so a session that meets a refusal reads it as the seatbelt.

Tests: five new cases in `gates.test.ts` (refusal + verbatim reason, multi-call emission,
cancelled review, override across the refusal), three in `mcp-tools.test.ts` for the heuristic
(both title forms, the "Reviewer dashboard" false-positive guard, acceptance) plus one that
walks the split-batch pattern through `complete_phase(tickets)`, and one in
`review-findings.test.ts` pinning that `storeTickets` still accepts a review-less batch from
`buildFixTicket`. Existing G3 tests in `gates.test.ts` and `rethink.test.ts` were updated to
carry a review ticket — the lap-2 one now ships lap 1's review ticket too, so it proves an
earlier lap's review does not satisfy the current lap.

## Surprises

- **The gate does not actually block a burn today.** The ticket and the spec both say this one
  `checkGate` case backs `complete_phase({phase:'tickets'})`, "the runner's pre-dispatch guard
  (runner.ts ~259)" and the launcher, so changing it once covers every path into a burn. None of
  those three hold: `runner.ts:261` is the G4 auto-advance (`all-tickets-terminal`), the
  launcher's `checkGate` is converge's G1, and `toolCompletePhase` short-circuits G3 with
  `ok: true` before ever calling `checkGate`. The only live consumer of the strengthened
  predicate is `gateState` in `features.ts:1164` — i.e. the Inspector's gate card, which will
  now read "no review ticket on this lap". `features.burn()` duplicates the old predicate inline
  (`lapTickets.filter(t => t.status !== 'cancelled').length < 1`) and never consults the gate, and
  the web Burn button (`next-step/tickets.ts`) does not read `gate.satisfied` either. So a human
  who clicks Burn on a review-less lap still burns it. Every acceptance criterion is met as
  written, but the headline "can no longer reach a burn" needs one of the two follow-ups below.
- The heuristic's regex has to exclude "Reviewer …"/"Reviewing …" — `^review[: ]` does, but
  `^review` would not; there is a test for it.
- `TicketInput.kind` is optional in the pre-parse type (`z.input`), so the refusal message
  spells the default out as `"implementation"` rather than printing `undefined`.

## Left undone

- **Closing the burn path.** Making `features.burn()` consult `checkGate('tickets-approved')`
  is the obvious completion, but it is a design decision the locked decisions did not make and
  it cannot be done naively: the Fix burn (`review-findings.ts` → `burn` after minting
  review-less fix tickets) and the Iterate loop-back both burn on the current lap with no review
  ticket, so the check would have to be conditioned on `feature.phase === 'tickets'`. Out of this
  ticket's file list, so left alone.
- **Surfacing the refusal at `complete_phase`.** The G3 branch of `toolCompletePhase` returns
  `{ok: true, waitingOn: 'human burn'}` unconditionally. Reporting `{ok: false, reason}` when the
  gate is unsatisfied would put the refusal in front of the tickets session that can still fix it
  — much louder than a gate card the human reads later. Deliberately not done: it changes the
  two-click covenant's copy and was not asked for.
- No drive-machinery change was needed: this ticket adds no service, no required env var, no seed
  and no process, so `.runcastle/drive-setup.ts` and friends were left alone (checked the
  triggers, did not run the scripts — the sandbox has no services).

## Verification

`bun run typecheck` — 0 errors. `env -u GIT_ASKPASS bun run test` — 3336 passed, 4 skipped,
1 failed: `dev-pane.test.ts > kills the child process tree so the port-holder is not orphaned`,
which asserts a POSIX process group is reaped after `kill`. It fails identically when run alone
and is untouched by this diff (gates, mcp, skill prose, tests) — an environment fault, not a
regression. Note the prompt's baseline (118 files / 1768 tests) does not match this repo's actual
suite size (229 files / 3341 tests), so it could not be used to classify that failure.

#### 3. Review-less laps can still enter a burn because the live Burn path bypasses G3

# ticket(3) — the Burn path no longer bypasses G3

## What was done

`feature.burn` used to cross G3 on its own inline rule — at least one non-cancelled
ticket in the current lap — and never called `checkGate`, so a lap whose review
ticket had lost its `kind` still reached the burner. A fresh burn from the `tickets`
phase now runs `checkGate(ctx, 'tickets-approved', feature)` and throws the gate's own
instructive reason. The `restarting` and `iterating` re-entries deliberately do not
re-check it: both resume a burn on a feature that already crossed G3, and an override
parks a review-less feature at `implementation`, so re-testing there would turn the
escape hatch into a dead end. `toolCompletePhase` for the tickets phase now checks the
same gate before it reports "waiting on human burn", returning `{ ok: false, reason,
gate: G3 }` instead — the session is the last actor that can still emit the missing
ticket. I re-ran the reviewer's repro step in both halves (a `tickets`-phase feature
with one pending implementation ticket and no review ticket): `burn` now rejects with
`GateError: no review ticket on this lap …`, and `toolCompletePhase(…, { phase:
'tickets' })` now returns `ok: false` with that reason and leaves the feature at
`tickets` with no `tickets.awaiting_burn` event. Both are pinned as tests, alongside
the override path and a review ticket arriving in a later `emit_tickets` call.

## Surprises

Three existing suites seeded a review-less `tickets` lap and burned it, so they went
red. Two (`burn-retry`, `burn-from-review`) only wanted "a burnable lap" and now get
the review ticket every batch closes with. The third is the interesting one:
`review-ticket.test.ts`'s "landed work had no review" case is *about* a lap with no
review ticket, so it now crosses G3 with `overrideGate(…, 'G3', reason)` — which is
the only state that can still produce it in the product, and exactly what the burner's
verification mint exists to catch. Also worth knowing: the web Burn button does not
preflight the gate (it enables on `lapTicketCount > 0`), so the refusal reaches the
human as a toast of the gate's message, not a disabled button — loud, but through the
error path.

`packages/server/test/dev-pane.test.ts` > "kills the child process tree so the
port-holder is not orphaned" fails in this sandbox, both in the full suite and run
alone. It asserts a spawned process group is reaped and touches nothing in my diff —
an environment fault, not this change. Everything else is green: `bun run typecheck`
0 errors, `env -u GIT_ASKPASS bun run test` 3339 passed / 1 failed (that test) / 4
skipped.

## Left undone

- The Burn button could consult the gate state it already receives and show the reason
  inline rather than after the click; that is a web change and outside this ticket.
- Ticket 2's review also noted the verification-mint half of the locked internal-mint
  regression has no dedicated test. `review-ticket.test.ts` now exercises that mint
  behind an override, but a test pinning "`storeTickets` itself never enforces the
  rule" for the verification mint is still unwritten.
- Drive machinery: unchanged and not run (no services, env vars, seeds or processes
  were added — the only edits are two server functions and four test files), so
  `.runcastle/` needed no edit under the standing instruction.

#### 4. The required complete_phase refusal regression is missing

# ticket(4) — the required complete_phase refusal regression

## What was done

The review finding said the regression test was missing. It was, but the reason it was
missing is that the behaviour was missing too: `toolCompletePhase` short-circuited the
moment it saw that the next gate was G3, emitting `tickets.awaiting_burn` and returning
`{ ok: true, waitingOn: 'human burn' }` **without ever calling `checkGate`**. So a
review-less lap could not be refused through `complete_phase` — a test asserting the
refusal would have been red against the code as it stood. That is the production bypass
the reviewer named, and it is why I had to change source, not just add a test.

The G3 branch of `toolCompletePhase` (`packages/server/src/mcp/server.ts`) now runs
`checkGate(ctx, gate.check, feature)` before parking and returns
`{ ok: false, reason, gate }` when the lap has no `kind: review` ticket. It still never
*crosses* G3 — the two-click covenant is untouched; only the crossing was ever the
exception, and SPEC §6 already says the tool "runs gate check server-side". The refusal's
fallback wording and local naming mirror the equivalent `checkGate` call in
`services/features.ts:625` so the two places that turn a `GateResult` into a message read
the same.

Three test changes in `packages/server/test/mcp-tools.test.ts`: a new dedicated test
pinning the review-less refusal through `complete_phase` (asserts the reason text, the
named G3 requirement, that no `tickets.awaiting_burn` note lands, and that the phase does
not move); a one-line refusal assertion added inside the split-batch multi-call test,
which is the exact test the reviewer's repro step points at; and the pre-existing
"parks at tickets" test now stores a properly kinded review ticket, since its lap was
review-less and it asserts `ok: true`.

I re-ran the reviewer's repro step verbatim
(`rg -n "toolCompletePhase|complete_phase" packages/server/test/mcp-tools.test.ts`) and it
no longer reproduces: line 389 is the dedicated review-less refusal test, and line 431 is
a review-less refusal assertion *inside* the split-batch test, before the review ticket is
emitted at line 434.

## Surprises

- The finding reads as a pure test gap ("Spec axis... the required regression is missing"),
  but it is really a code gap wearing a test gap's clothes. Anyone taking the ticket
  literally — write a test for existing behaviour — would have written a test asserting
  `ok: true` for a review-less lap and cemented the bypass.
- The existing "parks at tickets for the human Burn" test was itself a review-less lap
  passing `complete_phase`. It documented the bypass without anyone noticing.
- Two full-suite failures, neither mine, both outside my diff's imports.
  `packages/server/test/dev-pane.test.ts > kills the child process tree` fails in isolation
  too — the container does not reap the process group, an environment fault in the PTY
  path. `apps/web/test/settings-dialog.test.tsx > reaches every page from every other`
  failed only in the full run and passes on a targeted run — flaky under load. The
  baseline in the burn prompt (118 files / 1768 tests) is stale for this branch, which runs
  229 files / 3342 tests.
- Drive machinery needed no edit: this change adds no service, env var, seed, or process,
  so none of `.runcastle/`'s triggers fire. I did not run the drive scripts (no services in
  the sandbox) and made no change that would alter what they write.

## Left undone

- The headline finding from the same review — **the live Burn path (`feature.burn`) does
  not consult the strengthened G3 check** — is still open. That is the original
  silent-failure route and it belongs to another ticket in this lap; I deliberately did not
  touch `feature.burn`.
- The other sibling gap, a regression for the burner's mid-run **verification mint**
  storing a review-less batch, is also still open (only the fix-ticket half of decision
  6(e) is pinned, in `review-findings.test.ts`).
- `docs/SPEC.md:158` still describes `complete_phase({ phase: 'tickets' })` only in its
  success shape. It is not contradicted by this change — the `{ ok: false, reason }` arm is
  already in the documented return type — but a sentence saying G3's preconditions are
  checked at that moment would make the seatbelt findable from the spec.

#### 5. The burner's verification-mint regression behavior has no test

# Ticket 5 — the burner's verification mint now has a regression test

## What was done

Added one test to `packages/server/test/review-ticket.test.ts`, in a new describe block
next to the existing verification-mint scheduler tests. It drives a real burn through the
tRPC `feature.burn` caller with the real scheduler over a fake execution boundary: a lap
that already closes with a `kind: review` ticket, whose review mints a fix ticket mid-run
(the way `report_finding` does), so an implementation ticket lands after the review and the
run owes a verification pass. It then pins that the burner's mint stores its batch untouched
— a *second* `kind: review`, `passKind: verification` ticket on the same lap, stored straight
through the `storeTickets` service and never through the `emit_tickets` tool surface — and
that `checkGate(ctx, 'tickets-approved', …)` still reads satisfied on the result.

That last assertion is the deliberate deviation from a minimal reading of the ticket: decision
6(e) only asks that the mint "store untouched", but decision 4's "at least one, never exactly
one" exists *because of* this mint, and nothing else in the suite exercises G3 against a lap
holding two review tickets. One line pins it.

I re-ran the repro step. The reviewer's literal command was
`git diff --name-only main...feature/enforce-the-one-review-ticket-rule-in-machinery`; neither
ref exists in this sandbox clone (only a stale `origin/main`, many merges behind, whose
three-dot diff spans ~400 unrelated files), so I ran the exact equivalent against the branch's
own base commit: `git diff --name-only 88b4f48..HEAD -- '*test*'`. Before my change it listed
gates / mcp-tools / rethink / review-findings — no ticket-burner-side test. It now also lists
`review-ticket.test.ts`, and that file covers the verification mint. The repro no longer
reproduces.

## Surprises

- The first version of the test minted its fix ticket with `blockedBy: [t.seq]` and the run
  died with "blockedBy references invalid batch position 2". The `WorkflowCtx.storeTickets`
  hook forwards to the service *without* the `{ blockedByAreGlobal: true }` option that
  `reportFinding` passes, so `blockedBy` through that hook is batch-relative, not global seq.
  The mint's own call passes `blockedBy: []` for the same reason. Worth knowing before anyone
  writes another mid-run mint against that hook.
- Verify commands did not come back fully green, and the stated baseline does not match this
  checkout: the prompt's baseline says 118 files / 1768 tests, this repo runs 229 files / 3342.
  `bun run typecheck` is clean (0 errors). `bun run test` had 2 failures, neither in a file this
  branch touches: `packages/server/test/dev-pane.test.ts` ("kills the child process tree") fails
  reproducibly in isolation too — a container environment fault around process-group kill, not a
  code fault — and `apps/web/test/settings-dialog.test.tsx` ("reaches every page from every
  other") failed only under full-suite load and passes on a targeted run, i.e. flaky. Everything
  in `review-ticket.test.ts` passes (35/35).

## Drive machinery

No edit needed and none made: this ticket adds a test only — no new service, required env var,
seed, or side process. I did not run `drive-setup`/`drive-stop` (correctly, per the standing
instruction) and had no path-existence claims to check, since I touched nothing under
`.runcastle/`.

## Left undone

- The `dev-pane` process-group failure above looks like a real environment/portability issue
  someone should confirm on a host machine; I left it alone as another ticket's territory.
- Ticket 2's review flagged that the live Burn path does not consult the strengthened G3, so a
  review-less lap can still enter a burn. My test seeds a lap that *has* its review ticket, so it
  neither fixes nor covers that gap — it remains open and is the more serious of the lap's
  findings.

#### 6. Verify the fixes that landed

Gates verification pass

Verified pass #2 against `main` by reading the landed fix diffs on `feature/enforce-the-one-review-ticket-rule-in-machinery`. The working checkout was on `main`, so the integration ref was inspected directly and was not checked out.

All three fixes hold:

- Ticket #3: the live `feature.burn` path now calls `checkGate(ctx, 'tickets-approved', feature)` for a fresh burn from the `tickets` phase and throws the gate's instructive refusal when no current-lap, non-cancelled review ticket exists. Restart and iterate re-entry paths intentionally skip the check so a recorded G3 override remains usable. The original review-less Burn repro no longer follows the permissive ticket-count-only path.
- Ticket #4: `toolCompletePhase` now checks G3 before returning `waitingOn: 'human burn'`. A review-less lap returns `{ ok: false, reason, gate: G3 }`, does not emit `tickets.awaiting_burn`, and remains in the tickets phase. The dedicated refusal test and the split-batch test both assert the missing-review state before a later review ticket makes completion succeed.
- Ticket #5: `review-ticket.test.ts` now drives the real burn scheduler over a fake execution boundary, causes landed work after the first review, and verifies that the burner mints and stores a second `kind: review`, `passKind: verification` ticket through the service path. It also pins that G3 remains satisfied with two review tickets, preserving the intentional “at least one” rule.

No configured verification gates exist for this project, so none were run, per the pass instructions. No verification findings were found, and nothing plainly broken appeared in the touched surfaces.

<promise>COMPLETE</promise>
