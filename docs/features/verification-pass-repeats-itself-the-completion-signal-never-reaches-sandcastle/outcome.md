# Outcome — Verification pass repeats itself — the completion signal never reaches sandcastle

Fix packages/skills/burner/verify-fixes.md so the completion signal reliably lands in stdout. Today line 39 tacks 'End with <promise>COMPLETE</promise>' onto the digest-writing paragraph, which reads as 'end the DIGEST file with it' — a marker inside the file is invisible to sandcastle, which only scans agent stdout, so the iteration loop re-runs the same prompt (observed: a verification pass re-derived everything 3 times, full test suite each time, re-reporting findings each pass). Give the template the same 'Signal completion' hard rule its siblings carry (implement-ticket.md:15, review-ticket.md:26): print exactly <promise>COMPLETE</promise> as the last line of the final MESSAGE, whether the pass succeeded or was blocked — and, matching review-ticket.md:184, say the marker must never appear inside DIGEST.md itself. Rephrase line 39 so it cannot be read as ending the file with the marker.

- Shipped: 2026-09-08
- Laps run: 1

## What shipped

4 commits · 4 files

### Lap 1
- 2 tickets landed: #1 Fix packages/skills/burner/verify-fixes.md so the completion signal…; #2 Belt-and-braces in packages/server/src/workflows/review-ticket.ts: stop…
- 0 waived
- 0 failed

## Review record

### Lap 1 · review

- Reviewed commit: 9a7d65bdc6abc7e8956169858f5e3c7b18073f1e
- Landed since: 0
- Outcome: done

- No findings

## Notes record

- No human notes
