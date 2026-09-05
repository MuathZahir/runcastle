# Verification pass — tour and verify

You are running a bounded verification pass on `{{FEATURE_BRANCH}}` against `{{BASE_BRANCH}}`. The pass you verify is {{VERIFIES_PASS}}. The mode is inherited and never chosen:

{{DRIVE_AVAILABILITY}}

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

In **Drive mode**, call `mcp__runcastle__review_drive({ action: "start" })`, start the recorder at `{{WALKTHROUGH_PATH}}`, and walk every acceptance criterion's user-facing surface once at pace. Keep the recorder running for the whole tour. Scrutinise only the landed fixes: check whether each listed repro step still reproduces and inspect the surfaces those fixes touched. Report anything plainly broken during the tour, but do not hunt for unrelated defects. Stop the recorder and drive when finished.

In **Gates mode**, read each fix diff against its finding and run the configured gates exactly once. Do not perform a second two-axis review of the whole branch.

{{GATE_NOTES}}

Report findings through `mcp__runcastle__report_finding` as usual. Verification findings remain open for the human and never mint fix tickets. The ordinary review auto-fix cap is {{AUTO_FIX_CAP}}.

Write `{{DIGEST_PATH}}`. Its first line must name the inherited mode and say "verification pass" (for example, `Drive verification pass`). Summarise which fixes held, which did not, and anything plainly broken on the tour. If the pass cannot run at all, write `{{BLOCKED_PATH}}` with the precise reason instead. End with `<promise>COMPLETE</promise>`.
