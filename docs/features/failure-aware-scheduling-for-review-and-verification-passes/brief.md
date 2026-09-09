## Why this feature exists

Observed in real runs: when tickets fail mid-run (merge conflicts, usage limits), the review ticket and the appended verification pass start burning anyway, reviewing/verifying work that never landed. This wastes tokens on every collapsed run and can mint fix tickets against unfinished work.

## What is already there — read this before redesigning

The naive framing ("review/verify tickets are missing blockedBy edges") is WRONG. The dependencies exist and the scheduler honours them:

- Implementation tickets cascade on failure: a ticket whose blocker failed is itself failed ("blocked by failed ticket N") and never burns (`packages/server/src/workflows/ticket-burner.ts` scheduler, ~line 2444+).
- Review tickets have a defensive guard (`implementationsSettled`, ~line 2502) that waits for EVERY implementation ticket in the run to reach a terminal state before starting, regardless of declared edges. Review never starts beside a still-burning ticket.
- The behavior in question is a DELIBERATE carve-out: **improve-workflow decision 9** (`docs/features/improve-workflow/decisions.md#9`) — for review-kind tickets, a *failed* blocker counts as satisfied (`satisfied()`, ticket-burner.ts ~2492). Rationale: one flaky ticket shouldn't cascade-cancel the whole review; reviewing a partially-failed feature is valuable. The review's run-digest entry gets a "Reviewed with failed implementation ticket(s): N" note (`failedBlockerNote`).
- The verification pass (review-kind, `passKind: 'verification'`, minted in `appendVerificationIfDue`) already has partial guards: skipped when the last review failed, and only appended when ≥1 fix landed (`verificationDue`, ticket-burner.ts ~254-279).

## What decision 9 got wrong in practice

It doesn't distinguish WHY blockers failed:

1. **Run-level fatal errors (usage limit / quota / auth).** ADR-0006 (`docs/adr/0006-burn-attempt-chaining.md`) classifies these as fatal per-ticket, but nothing halts the RUN — every remaining ticket spends a container to rediscover the same limit, they all fail, then the review runs on a branch where little or nothing landed, then possibly verification too.
2. **Collapse case.** When zero (or nearly zero) implementation tickets landed, running the review at all is waste — there is nothing to review, and its minted fix tickets target unfinished work.
3. **Merge conflicts** strand the ticket's work on its temp branch; the review reviews the feature branch as if that work didn't exist.

## Rough shape agreed at intake (the grill refines it)

- A run-level fatal short-circuit: quota/auth-class failures abort the run instead of failing tickets one by one.
- Gate the review pass on actual landings — e.g. it runs only when at least one implementation ticket landed; below that the run ends failed, awaiting the human's per-ticket retry (ADR-0006 controls).
- The verification pass gets the same failure-aware treatment (its landed>0 guard is a starting point, not necessarily sufficient).
- This AMENDS improve-workflow decision 9 rather than overturning it: the "one flaky ticket among five landed still gets reviewed, with the failed-blocker note" case is the part decision 9 got right and should survive.

## What this feature must NOT swallow

- **Ticket retry / attempt-chaining mechanics** — ADR-0006 territory; this feature decides when review/verify run, not how failed tickets recover.
- **Human review DRIVES** — the in-flight `denied-review-drives-classify-wait-surface-retry` feature owns denied review drives; this one is burn-run scheduling only.
- **Wholesale re-litigation of partial review** — do not reintroduce the cascade-cancel that decision 9 fixed.
