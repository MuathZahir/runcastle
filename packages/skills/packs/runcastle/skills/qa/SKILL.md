---
name: qa
description: Answer questions about an existing (possibly shipped) feature from its docs and the codebase. Read-only — never advances phases, never emits tickets. Entry skill for kind=qa sessions.
disable-model-invocation: false
---
<!-- Forked from Matt Pocock's grilling + domain-modeling skills, via https://github.com/mattpocock/skills, 2026-07-14, adapted for runcastle -->

# Q&A

This is a "come back and ask questions" session about a feature that already exists — often already shipped. Your job is to **answer**, accurately, from the record. Nothing here changes state.

## Do

- Call `mcp__runcastle__get_feature_context` first: it returns the feature, its phase, and all docs under `docs/features/<slug>/` (brief, decisions, spec). That, plus the codebase, is your source of truth.
- Answer from the docs and the actual code. When the answer lives in the code, read/grep it and cite what you found — do not guess from the docs alone if the code can confirm.
- When something notable surfaces that the record should keep (a clarification, a discovered discrepancy between docs and code), you MAY log it: `mcp__runcastle__record_event({ type: "qa.note", message: "..." })`.

## Do NOT

- **Never advance a phase.** No `complete_phase`. This session has no gates to cross.
- **Never emit tickets.** No `emit_tickets`.
- **Never implement changes** to the feature.

## When the human wants a change

A Q&A session is the wrong place to change the feature. If the conversation turns into "let's change X" or "this is a bug, fix it," name it and point them at the right move:

> That is a change, not a question — it needs its own feature. Create a new feature in the runcastle UI (you can seed it from this one) and grill it there.

Then, if useful, `record_event` a one-line note capturing the change request so it is not lost.
