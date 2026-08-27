# Review fixes

## Ticket 1

Review drive refuses on runcastle's own artifact: 3 of 4 browser walks were refused with "Working tree has uncommitted changes — commit or stash first", the sole dirty entry being a staged `docs/features/<slug>/brief.md` that runcastle's own pipeline created. Find where the brief is written/staged without being committed on the feature branch (draft-features / create_feature / lap paths in packages/server/src/services) and make sure the feature branch is clean of runcastle-owned artifacts before a review ticket is dispatched — commit the brief with a `runcastle:` message, or exclude runcastle-owned docs from the drive's dirty check (the drive guard lives in packages/server/src/services/git.ts). Prefer committing: docs are meant to be versioned (charter decision 5). Regression test: a feature whose brief.md is staged-but-uncommitted can start a review drive.

## Ticket 2

Review prompt: when the drive is refused or unavailable, forbid the review agent from building its own environment. Evidence: one review improvised a worktree + full pnpm install + contracts:build/prisma:generate ×3 + a five-command Windows directory-delete fight — the most expensive single act in any review — and 4 of 6 acceptance criteria were still unverifiable. In the review template (packages/server/src/workflows/review-ticket.ts and its prompt asset), state: if `review_drive` cannot start, report "could not drive: <reason>" in the digest and review by reading the diff and running the repo's verify commands only; never create worktrees, install dependencies, or generate artifacts.

## Ticket 3

Review prompt: scope each review to drive OR gates, not both. The two healthy reviews (26 m, 30 m) each did exactly one; the ones that tried both ran long or failed. Make the review ticket carry (or the prompt decide up front) which mode it is in: a browser drive against the acceptance criteria when the feature has a UI surface and a drive is available, otherwise the verify gates + diff review. State the chosen mode at the top of the digest.

## Ticket 4

Emit `ticket.timing` for review tickets. Today the only emit is in packages/server/src/workflows/ticket-burner.ts (~line 3333) on the implementation path; review-ticket.ts emits none, which is why a 5 m 35 s review read as 5.2 hours (the review-*.log files are append-only across attempts). Emit `ticket.timing` on every exit path of executeReviewTicket with the same shape as burns (category breakdown where available; at minimum wall-clock start/end for the attempt). Then make sure any UI that shows a ticket's duration (apps/web run lanes / ticket cards) reports the ticket attempt's duration from events, never a log-file span.
