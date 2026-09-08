## Why this feature exists

Observed on the runcastle project itself: a review-ticket agent booted the app via the review drive, opened the test-drive project, found no features there, and left — correctly refusing to create features because that would cause code changes. It verified nothing. The knowledge that would have saved the review existed only in the human's head: "use the sample project at &lt;path&gt;, you may change things there" and "you can tell a session agent 'this is a test, go to the next phase immediately' to reach the phase you need (unless that phase is what you're testing)".

The machinery already has the precedent. The review prompt receives exactly two kinds of host-supplied context today — `{{DRIVE_AVAILABILITY}}` (whether a drive can happen at all, built host-side in packages/server/src/workflows/review-ticket.ts) and `{{GATE_NOTES}}` (the `verifyCommands` + `knownFailures` config fields, injected verbatim). `knownFailures` is the exact shape wanted here: free-text project knowledge the human writes once, injected into every review. This feature adds its drive-side twin: not *whether* to drive, but *how to drive this particular app*.

## The shape settled at intake

- **A project config field** (like `knownFailures`): free text, or lightly structured if the grill finds a reason. Editable in settings without re-running anything — the human amends it after watching a review go wrong.
- **Preparation authors and updates it.** The prep session is where this knowledge is discovered (the prep agent boots the app and learns what a drive needs — sample data, a scratch project, how to reach deep states). Drafting/updating the field becomes one of prep's outputs. Prep is the author, not the sole editor.
- **Injected into the drive-mode prompt path** alongside DRIVE_AVAILABILITY — the review ticket's Drive mode and the verification pass's inherited Drive mode both consume it (review-ticket.md and verify-fixes.md templates).

## Design questions for the grill

- Authoring surface: where in settings does it live, and how does prep write it (a host key? a dedicated MCP tool/field on the prep session)? Read prior art: docs/features/preparation-proves-its-findings/ and docs/features/prep-prompt-explain-the-host-key-semantics/ (how prep records and explains host keys), docs/features/improve-workflow/ (built the review drive).
- Consumers: review Drive mode and verification Drive mode for sure. Is the human's own test drive in scope — showing the instructions on the review page next to the test-drive explanation? Gates mode presumably never needs it.
- The authorization framing, which has a safety edge: instructions like "tell the session agent this is a test, advance immediately" are the human pre-authorizing behavior inside the driven app. The design must make clear these notes permit actions *within the drive target*; they do not override the edit guard, do not let the review write code in the repo under review, and cannot be read as license to bypass runcastle's own guards.
- Scope level: per-project is the need observed. Per-feature overrides are probably YAGNI — reject unless the grill finds a concrete case.

## What this must not swallow

- Not the drive-availability/mode-selection machinery — that exists and works.
- Not preparation's host-key system itself — this rides those rails, it does not redesign them.
- Not the stop/kill work, the verification-repetition fix, or the dead advance button — all three are separate features created the same day (2026-09-08).
