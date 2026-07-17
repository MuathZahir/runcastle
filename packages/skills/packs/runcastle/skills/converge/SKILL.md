---
name: converge
description: Close a mapped feature. Read ONLY the compressed knowledge (map.md + decisions.md, never the waypoint transcripts), then drive spec and tickets out of that one unbroken window. Entry skill for kind=converge sessions.
disable-model-invocation: false
---
<!-- Forked from Matt Pocock's grilling/to-spec/to-tickets discipline, 2026-07-15, adapted for runcastle mapped ideation -->

# Converge — close a mapped feature

A mapped feature was too big for one window, so it was charted into a map and its waypoints were worked in their own sessions. Every waypoint is now terminal, the human clicked **Converge**, and the feature has already crossed G1 into the `spec` phase (or `tickets` for a `collapsed` feature). Your job: turn the compressed knowledge into a spec and tickets — the exact output an unbroken ideation session produces.

## Context hygiene is the whole game

Everything happens in this one window. **Never compact. Never `/clear`. Never suggest either.** The map plus the decisions ARE the compression — that is the whole point of charting a map. Read them once, hold them, and let spec and tickets fall out of the same conversation.

## 0. Read ONLY the compressed knowledge

1. Call `mcp__runcastle__get_feature_context`. It returns the feature (`slug`, `title`, `oneLiner`, `size`), current `phase`, and the docs on disk.
2. Read **only** these two files under `docs/features/<slug>/`:
   - `map.md` — the destination, notes, and out-of-scope decisions.
   - `decisions.md` — every decision the waypoint sessions locked.
   **Do NOT read the waypoint session transcripts.** The map and decisions are the compression; trust them. If a decision is genuinely missing you may check the codebase for a *fact*, but never re-grill the human and never reopen a resolved waypoint — converge, do not re-ideate.
3. `mcp__runcastle__record_event({ type: "converge.started", message: "<feature title>" })`.

## 1. Size branch — run the pipeline in this window

Read `feature.size` from step 0:

- **`full`** → invoke `/runcastle:spec` (it writes `spec.md` and completes the `spec` phase); when it returns, invoke `/runcastle:tickets`.
- **`collapsed`** → skip spec entirely; invoke `/runcastle:tickets` directly (it works from `decisions.md` + `map.md`).

**Re-convergence** — you may be a fresh session continuing a converge that crashed
or was closed mid-way (the feature is past G1 but has no tickets). Pick up from
whatever already exists on disk:

- If `docs/features/<slug>/spec.md` **already exists**: read it, do **not**
  rewrite it, and proceed straight to `/runcastle:tickets`. (If the current
  `phase` is still `spec`, call `complete_phase` for spec first — the spec work
  is already done.)
- If it does not exist (or the feature is `collapsed`), run the size branch
  above as normal.

Do not open a new session for these. They run here, on top of the compressed knowledge you just read.

## 2. Close — hand off to the human

`/runcastle:tickets` ends by emitting tickets to the runcastle store. When it returns, your job is **done**. Tell the human plainly:

> Converged. Tickets are in the runcastle UI — review the ticket cards and click **Burn** to start the AFK agents. I'll stop here.

Do **not** implement anything. Do **not** start burning. The two human clicks (Burn, then Merge after test-drive) are the only gates left, and they belong to the human.
