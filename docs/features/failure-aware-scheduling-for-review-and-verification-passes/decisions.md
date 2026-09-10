# Decisions — failure-aware scheduling for review and verification passes

## 1. One lap, spec the whole thing
**Decision:** The feature is one-session-sized and settled: spec it whole, no thin lap 1, no map.
**Why:** It touches one file's scheduling logic plus the error classifier; the rough shape was already agreed at intake and there is no UI/schema surface beyond a run-halt event.

## 2. Review requires every implementation ticket done-or-cancelled
**Decision:** The review pass runs only when every implementation ticket in the run is `done` or `cancelled`. If any failed, the review ticket stays **pending** (not failed) and the run ends failed; the human retries or cancels the failed ticket(s) via the ADR-0006 per-ticket controls, and the re-burn runs the review then. This amends improve-workflow decision 9: the failed-counts-as-satisfied carve-out in `satisfied()` is removed; the review is deferred until the feature is whole, never run against a partially-failed feature.
**Why:** With per-ticket retry/cancel controls the review isn't lost, only deferred — and it then always reviews the complete feature instead of minting fix tickets against work that never landed. Leaving the review pending (rather than cascading it to failed) is what makes the re-burn pick it up with no extra ceremony.

## 3. Run-fatal: a third error class that halts the run
**Decision:** Add a `run-fatal` classification — a subset of today's `fatal` — for errors that are facts about the account/environment, not the ticket: auth/OAuth/API-key, billing/credit/`insufficient_quota`, subscription usage-limit (new pattern; "usage limit reached" matches nothing today), and missing agent binary in the image. On a run-fatal failure: the ticket that hit it fails with the error as its record, no new tickets start (any runtime), in-flight tickets on the **same runtime as the error** are stopped with commits preserved (the `ticket.stop` path — they cannot succeed), in-flight tickets on other runtimes run to their natural finish and their work lands, un-started tickets stay **pending**, and the run finalizes failed with a "run halted" event. Everything else (unknown errors, merge conflicts, BLOCKED.md, model-not-found) stays ticket-fatal.
**Why:** With `burnConcurrency` defaulting to 1 (≤8 cores), each independent ticket otherwise spends a container — and up to 3 retry attempts for rate-limit-shaped wordings — rediscovering the same dead account. Detection reuses the existing per-runtime pattern tables in `classifyTicketRunError`; unrecognized wordings default to ticket-fatal, the safe direction (worst case is old behavior, never a wrongly-halted run).

## 4. Run-fatal halts the whole run, not just one runtime
**Decision:** In a mixed claude/codex run, a run-fatal error from either runtime halts everything — no per-runtime kill-list.
**Why:** Decision 2 means the run ends failed anyway once any ticket cannot finish; scheduling new work on the surviving runtime buys little at real scheduler complexity. Pending tickets survive to the re-burn either way. The in-flight kill is runtime-scoped (see decision 3) because every run-fatal trigger is a provider-scoped fact — a codex auth failure must not abort a healthy claude agent mid-work.

## 5. Verification gated the same as review
**Decision:** The verification pass is appended only when every fix ticket minted by the review is `done` or `cancelled`. If any fix failed, no verification is minted and the run ends failed; the human retries or cancels the failed fix, and the re-burn appends verification against the complete set. The existing guards stay (skipped when the review itself failed; only appended when ≥1 fix landed).
**Why:** Same principle as decision 2 — verify the whole thing or wait until it is whole; verifying fixes beside a known-broken one produces a verdict on a build that will change again.

## 6. All-cancelled collapse: review needs at least one landing
**Decision:** The review additionally requires ≥1 implementation ticket `done`. If every implementation ticket ended `cancelled`, the review ticket is cancelled too and the run finalizes normally (not failed — nothing failed; the human cancelled the work on purpose).
**Why:** Done-or-cancelled alone would let the review burn against a feature branch with zero new commits — the brief's "nothing to review" waste in a different costume.

## 7. Merge conflicts need no extra mechanism
**Decision:** No conflict-specific scheduling change. A conflicted ticket is a failed ticket; under decision 2 the review defers until the human resolves the conflict via per-ticket retry, so the review never runs while work sits stranded on a temp branch.
**Why:** Brief item 3 (review treats stranded work as nonexistent) was a symptom of partial review, which decision 2 removes; the ADR-0006 conflict-resolution flow already covers recovery.

## Lap 2 (2026-09-10)

### 8. Credential-context matching is order-insensitive
**Decision:** The narrowed run-fatal patterns from lap-1 ticket #4 (`ACCOUNT_PERMISSION_DENIED`, `REFUSED_CREDENTIAL_STATUS` in `ticket-burner.ts`) required the credential subject to appear *after* the refusal wording. That order requirement is dropped: a refusal (`permission denied`, `401`/`403`, `forbidden`) is `run-fatal` when a credential subject (api key, token, credential, login, auth, account, org…) appears anywhere on the same line/message, before or after. `API token permission denied` and `forbidden response: status 403` become run-fatal. The narrowing itself survives: a bare `permission denied` or bare `403` with no credential subject anywhere stays ticket-level `fatal`, and unknown wordings still default to `fatal`. Fixes verification finding `finding_mc7vjDv9mYVh`.
**Why:** Word order is an accident of each CLI's phrasing, not evidence about whose door was closed. The false positives lap 1 fixed had *no* credential subject at all — proximity of subject to refusal is the signal, not their order.

### 9. Fix the pre-existing typecheck break so the gates are verifiable
**Decision:** This lap cards a repo-health fix outside the feature's own diff: the two call sites passing `onChildSpawn` where `NoSandboxOptions` does not accept it (`packages/server/src/workflows/review-ticket.ts:508`, `packages/server/src/workflows/ticket-burner.ts:3298`), which leave `bun run typecheck` red on the branch (review observation `finding_lPOOU2AbOC3_`).
**Why:** Every review and verification ticket of this feature asserts "typecheck is clean"; while the checkout fails typecheck for unrelated reasons that gate is unverifiable, and the reviewer must hand-sort our breakage from inherited breakage.

### 10. Host/test-environment findings are noted, not carded
**Decision:** Review observation `finding_Jkm0MWDrpGXE` — Bun 1.3.4 installed vs `>=1.3.14` required, `vi.stubEnv` unavailable, inherited `RUNCASTLE_*` asset env vars breaking full-suite runs — is a machine-setup fact, not code. No ticket; recorded here so a reviewer who hits partial test failures on this host knows they are inherited.
**Why:** No code change can fix the operator's installed Bun or a talk session's inherited environment; carding it would hand a burner an unfixable ticket.
