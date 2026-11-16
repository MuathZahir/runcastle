## Purpose

The human sees Fable 5.2 in the Settings model list but cannot pick it in a chat's model picker (the dropdown under the message box: search box, then Fable / Opus / Sonnet / Haiku groups). The picker showed only Fable 5.1, Opus 5.5, Opus 5.5 (1M), Sonnet 5.5, Haiku 5.5.

A screenshot of the problem is at .runcastle-attachments/pnote_VvPipGPPZc8v.png in your workspace — Read it before starting.

## Decided with the human

- What: Fable 5.2 (and any model Settings lists) can be picked in the chat's model picker.
- Where: the model picker in every chat's message box.
- Who: the human, choosing a model for any chat.

## Understood (from the orchestrator's code read, 2026-11-16 — verify)

- The picker reads `thread.models` → `threadModels` / `modelCatalog` in `packages/server/src/threads/model-catalog.ts`. When a saved catalog exists on disk (written when a session reports the models the Claude Code adapter advertises), the picker shows only that, plus `[1m]` variants of models it already lists. It never adds a roster model the adapter did not list.
- Settings lists the roster from `modelRoster()` in `packages/core/src/config.ts` (curated + discovered + the operator's own entries), which includes Fable 5.2.
- The shipped feature `model-roster-discovers-new-models` built discovery for the roster and Settings only and never fed it to the picker. This is that gap.
- Likely fix: in `modelCatalog()`, add roster entries for the runtime that the catalog lacks. Check that a session actually starts with such an id before showing it.

## Must not swallow

No redesign of Settings or the picker; no new model-management features. Just make the two lists agree.

## Open

- Whether a roster-only id fails at session start, and what the picker should do then.

## Ordering

Independent; nothing waits on it.

Planning mode: automatic
