# Verification pass — tour and verify

You are running a bounded verification pass on `{{FEATURE_BRANCH}}` against `{{BASE_BRANCH}}`. The pass you verify is {{VERIFIES_PASS}}. The mode is inherited and never chosen:

{{DRIVE_AVAILABILITY}}

## How you run

You run **non-interactively** — your agent CLI in print/exec mode, no terminal, no human. So:

- **Signal completion.** Print exactly `<promise>COMPLETE</promise>` as the last line of your final message, whether the pass went well or you could not run it at all. It is the only completion signal there is, and it is read from your message — a marker written into a file is invisible, and without one in your message this same pass runs again from the top.

## What landed

{{LANDED_FIXES}}

## Context

Ticket:

{{TICKET_JSON}}

Feature:

{{FEATURE_BRIEF}}

Project docs digest:

{{DOCS_DIGEST}}

Run digests:

{{LAP_DIGESTS}}

## Tour and verify

In **Drive mode**, call `mcp__runcastle__review_drive({ action: "start" })`, start the recorder at `{{WALKTHROUGH_PATH}}`, and walk every acceptance criterion's user-facing surface once at pace. Keep the recorder running for the whole tour. Scrutinise only the landed fixes: check whether each listed repro step still reproduces and inspect the surfaces those fixes touched. Report anything plainly broken during the tour, but do not hunt for unrelated defects. Stop the recorder and drive when finished. If the dev URL answers but no browser attaches, record that drive failure, clean up, and run Gates mode in full; this is the explicit exception to the one-mode rule.

{{DRIVE_INSTRUCTIONS}}

In **Gates mode**, read each fix diff against its finding and run the configured gates exactly once. Do not perform a second two-axis review of the whole branch.

{{GATE_NOTES}}

Report findings through `mcp__runcastle__report_finding` as usual. Verification findings never mint fix tickets: a confirmed defect stays open for the human, carried under the existing carry/link/close rules. The ordinary review auto-fix cap is {{AUTO_FIX_CAP}}.

Write `{{DIGEST_PATH}}`. Its first line must name the inherited mode and say "verification pass" (for example, `Drive verification pass`). Summarise which fixes held, which did not, and anything plainly broken on the tour. No `<promise>` markers inside the digest — the completion signal is a line in your message, never a line in this file. If the pass cannot run at all, write `{{BLOCKED_PATH}}` with the precise reason instead. Either way, the file you write is the last thing you do before signalling COMPLETE.

End the digest with exactly this machine-readable block. Name the mode actually completed; after a Drive failure followed by full Gates use `gates` and keep the drive failure in the one-line reason:

```
REVIEW-MODE: drive|gates
REVIEW-VERDICT: verified|unverified
REVIEW-REASON: <one line; required when unverified>
```
