# Failure-aware scheduling for review and verification passes

## Problem

When a burn collapses — the account hits its usage limit, credits run out, a login expires, or the sandbox image is missing the agent binary — the run doesn't notice. Each remaining ticket spends a fresh container (and, for rate-limit-shaped wordings, up to three retry attempts) rediscovering the same dead account. Then the review pass runs anyway, "reviewing" a feature whose work never landed, and can mint fix tickets against unfinished work; the verification pass can follow. Every step is wasted tokens, and the run's record ends up describing work that didn't happen.

Separately, even a healthy run with one genuinely failed ticket reviews a partial feature: the operator would rather resolve the failure first and have the review see the whole thing.

## Approach

Three changes to the burn scheduler, all amendments to existing behavior:

**1. A `run-fatal` error class that halts the run.** The ticket-run error classifier grows a third verdict alongside `retryable` and `fatal`: `run-fatal`, for errors that are facts about the account or environment rather than the ticket — auth/OAuth/API-key failures, billing/credit/`insufficient_quota`, subscription usage-limit (a new pattern; today's "usage limit reached" wording matches nothing and lands in fatal-by-default), and a missing agent binary in the image. Detection reuses the existing per-runtime pattern tables; the classifier keeps receiving the failing ticket's runtime. Unrecognized wordings keep defaulting to ticket-level `fatal` — the safe direction: worst case is today's behavior, never a wrongly-halted run.

Ambiguous refusal wordings — `permission denied`, a bare `401`/`403`, `forbidden` — are run-fatal only when a credential subject (api key, token, credential, login, auth, account, org…) appears in the same message, and that pairing is **order-insensitive** (decision 8, amending lap-1 ticket #4's narrowing): `API token permission denied` and `forbidden response: status 403` halt the run just as `permission denied: invalid api key` does, while a filesystem `permission denied` or an unrelated `403` with no credential subject anywhere stays ticket-level `fatal`.

When a ticket fails run-fatally: that ticket fails with the error as its record; the scheduler starts no further tickets (any runtime); in-flight tickets on the **same runtime as the error** are aborted via the existing per-ticket stop path (commits preserved on their attempt chains — they cannot succeed against a dead account); in-flight tickets on **other** runtimes run to their natural finish and their work lands; un-started tickets stay `pending`; the run finalizes failed with a run-halted event naming the cause. Recovery is the existing ADR-0006 surface: per-ticket retry/cancel once the account is fixed, then re-burn. In a mixed claude/codex run the halt is still whole-run for *scheduling* — only the in-flight kill is runtime-scoped (decisions 3–4).

**2. The review pass waits for a whole feature.** This amends improve-workflow decision 9: the review-kind carve-out that let a `failed` blocker count as satisfied is removed. The review runs only when every implementation ticket in the run is `done` or `cancelled`, **and** at least one is `done`. If any implementation ticket failed, the review ticket stays `pending` — never cascaded to failed — and the run ends failed; the operator retries or cancels the failed tickets and the re-burn picks the review up with no extra ceremony. If every implementation ticket was cancelled, the review is cancelled too and the run finalizes normally (nothing failed; the operator cancelled the work on purpose). The failed-blocker digest note ("Reviewed with failed implementation ticket(s): …") loses its trigger — a review can no longer run beside failed implementation tickets — and is retired with the carve-out.

Merge conflicts need no conflict-specific mechanism under this rule: a conflicted ticket is a failed ticket, so the review defers until the operator resolves it via retry, and work stranded on a temp branch is never reviewed-around (decision 7).

**3. The verification pass gets the identical gate.** Verification is appended only when every fix ticket minted by the review is `done` or `cancelled` (with the existing guards kept: skipped when the review itself failed, appended only when ≥1 fix landed). Any failed fix → no verification, run ends failed, and the re-burn appends it after the operator's retry — same principle: verify the whole thing or wait until it is whole.

The scheduler's defensive wait (review starts only after every implementation ticket settles) is unchanged; what changes is what happens *after* they settle. No schema, tRPC, or UI surface is added beyond the run-halted event flowing through the existing event stream.

## Seams

All existing; no new seams.

- **The error classifier** (`classifyTicketRunError` and its pattern tables) — pure function from a thrown error + runtime to a verdict. Observes: which wordings, per runtime, produce `run-fatal` vs `fatal` vs `retryable`; the new usage-limit pattern; fatal-by-default staying ticket-level.
- **The scheduler** (`burnTickets`, driven with a fake `execute`) — the highest seam; the whole feature is observable here. Observes: halt-on-run-fatal (no new tickets started, same-runtime in-flight aborted, other-runtime in-flight finishing and landing, pending left pending, run-halted event emitted); the review gate (review pending while a failure exists, running when all done-or-cancelled with ≥1 done, cancelled on all-cancelled); cascade behavior for implementation tickets unchanged.
- **The verification decision** (`verificationDue`) — pure function from tickets to a due/not-due verdict. Observes: not due while any fix ticket is failed; existing guards preserved.

## Out of scope

- Ticket retry / attempt-chaining mechanics — ADR-0006 territory; this feature decides *when* review/verify run, not how failed tickets recover.
- Denied review drives — owned by the in-flight `denied-review-drives-classify-wait-surface-retry` feature.
- Per-runtime *scheduling* after a halt (continuing to start new tickets on the surviving runtime) — deliberately rejected as complexity the rare mixed-runtime case doesn't earn.
- Any UI beyond the run-halted event on the existing stream.

## Lap 2

Lap 1 landed and was test-driven; the drive's open findings (in `review_findings`) set this lap's scope:

- **Order-insensitive credential matching** in the run-fatal classifier (decision 8; finding `finding_mc7vjDv9mYVh`) — the change to `ACCOUNT_PERMISSION_DENIED` / `REFUSED_CREDENTIAL_STATUS` described in Approach §1.
- **Repo-health fix so this feature's gates are verifiable** (decision 9; finding `finding_lPOOU2AbOC3_`): remove/repair the invalid `onChildSpawn` option on `NoSandboxOptions` at `review-ticket.ts:508` and `ticket-burner.ts:3298` so `bun run typecheck` is green again. Pre-existing, not caused by this feature, deliberately carded here because every gate asserts a clean typecheck.
- Host/test-environment observations (Bun version, inherited env vars) are noted in decision 10 and **not** carded.

## Open questions

None — all decisions locked in decisions.md (1–10).
