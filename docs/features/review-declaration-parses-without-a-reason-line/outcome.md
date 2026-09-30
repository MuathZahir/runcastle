# Outcome — Review declaration parses without a reason line

Every clean review pass is recorded as 'unverified · NO DECLARATION · nothing verified — Review declaration missing or unparseable.' The review prompt (packages/skills/burner/review-ticket.md, and verify-fixes.md) says REVIEW-REASON is 'required when unverified', so agents that verified cleanly end DIGEST.md with only `REVIEW-MODE: gates` / `REVIEW-VERDICT: verified` and omit the reason line. But the DECLARATION regex in packages/server/src/workflows/review-ticket.ts (~line 264) requires a `\nREVIEW-REASON:` line, so the whole block fails to match. Evidence from the live DB: the 3 most recent review tickets whose digest ends at `REVIEW-VERDICT: verified` (no reason line) all got the 'declaration missing' verdict; all 7 that included a REVIEW-REASON line resolved verified. Fix: make the REVIEW-REASON line optional in the regex (tolerate a missing line, a missing trailing newline, and \r\n endings) so an omitted reason falls back to facts.driveWithheldReason / '' as resolveReviewDeclaration's doc comment already intends. An `unverified` verdict with no reason should still resolve unverified with the existing default reason. Add tests in packages/server/test/review-ticket.test.ts: a digest ending exactly at `REVIEW-VERDICT: verified` (no trailing newline) resolves verified with the declared mode; the same with CRLF line endings; the three-line form still works. Do not retroactively rewrite stored ticket verdicts.

- Shipped: 2026-09-30
- Laps run: 1

## What shipped

2 commits · 3 files

### Lap 1
- 1 tickets landed: #1 Every clean review pass is recorded as 'unverified · NO DECLARATION ·…
- 0 waived
- 0 failed

## Review record

### Lap 1 · review

- Reviewed commit: 769f76171e9a90f14494495666f0f9e66cb78e49
- Landed since: 0
- Outcome: done

- **Test gate ran on the main checkout: 4 failures, none in files this lap touched** — open
- **Both axes clean: the fix does what the brief asked, with one small, tested extra** — open

## Notes record

- No human notes

## Per-ticket digests

### Lap 1

#### 1. Every clean review pass is recorded as 'unverified · NO DECLARATION ·…

## What was done
- Made the `REVIEW-REASON` line optional in the `DECLARATION` regex (`packages/server/src/workflows/review-ticket.ts`). `resolveReviewDeclaration` now reads the reason as `match[3] ?? ''`. A clean pass that ends at `REVIEW-VERDICT: verified` now resolves as verified with the mode it declared. The reason falls back to `facts.driveWithheldReason`, or `''` if there is none.
- CRLF line endings and a missing trailing newline are both handled. An `unverified` verdict with no reason still resolves unverified, with the existing default reason ("Reviewer declared this pass unverified.").
- One small addition beyond the brief: the whitespace after `REVIEW-REASON:` is now `[ \t]*` instead of `\s*`. Before, `\s*` could match a newline, so an empty reason took the next line of text as the reason. A test covers this.
- Added tests in `packages/server/test/review-ticket.test.ts`: no reason and no trailing newline, CRLF with no reason, CRLF with a reason (the three-line form), fallback to `driveWithheldReason`, unverified with no reason, and the empty-reason case above. I confirmed that the old regex does not match the no-reason digest.

## Surprises
- The full suite had 1 failure: `packages/server/test/dev-pane.test.ts`, "kills the child process tree so the port-holder is not orphaned". It also fails when that file runs alone, and it tests process groups, which this change does not touch. It looks like an environment fault in this sandbox, but it contradicts the stated all-green baseline. Typecheck passes.

## Left undone
- Stored ticket verdicts were not rewritten, as the ticket instructs.
- The review prompts (`review-ticket.md`, `verify-fixes.md`) were not changed.
- Drive machinery: no infrastructure changed, so it needs no edits.
