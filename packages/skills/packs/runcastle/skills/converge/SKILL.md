---
name: converge
description: Close a mapped feature. Read the compressed knowledge — map.md, decisions.md and the research deliverables — never the waypoint transcripts, then drive spec and tickets out of that one unbroken window. Entry skill for kind=converge sessions.
disable-model-invocation: false
---
<!-- Forked from Matt Pocock's grilling/to-spec/to-tickets discipline, via https://github.com/mattpocock/skills, 2026-07-15, adapted for runcastle mapped ideation -->

# Converge — close a mapped feature

A mapped feature was too big for one window, so it was charted into a map and its waypoints were worked in their own sessions. Every waypoint is now terminal and the human clicked **Converge**; the feature stays in **Planning** throughout — converging is not a state change, it is the rest of Planning done in one window. Your job: turn the compressed knowledge into a spec and tickets — the exact output an unbroken ideation session produces.

## Context hygiene is the whole game

Everything happens in this one window. **Never compact. Never `/clear`. Never suggest either.** The map plus the decisions plus the research ARE the compression — that is the whole point of charting a map. Read them once, hold them, and let spec and tickets fall out of the same conversation.

## 0. Read the compressed knowledge — and only that

Call `mcp__runcastle__get_feature_context`. The injected system prompt carries the slug and the paths; trust `get_feature_context` for the live state. It returns the feature, the current `phase`, the map, the tickets, and its docs in two parts — `docs[]`, inlined in full, and `moreDocs[]`, an index of everything else with a `relPath` and a byte count. Read, in this order:

1. **`map.md`** (inlined in `docs[]`) — the destination, the notes, and what was ruled out of scope.
2. **`decisions.md`** (inlined in `docs[]`) — every decision the waypoint sessions locked. This is the spine of the spec.
3. **`research/*.md`** — the deliverables the `research` waypoints wrote, one file each, under `docs/features/<slug>/research/`. **These are not inlined.** They appear in `moreDocs[]` with their paths and sizes, and each resolved research waypoint's `summary` in `waypoints[]` names its file (`researched: <title> — see <path>`). Read them with `mcp__runcastle__read_feature_doc({ relPath })`, or straight off disk in this worktree.

   **Do not skip step 3.** A research waypoint is forbidden to write `decisions.md` — its findings live *only* in its own file. If a whole AFK run went into researching this feature and you converge without opening the file it produced, that run is simply lost, and the spec you write will contradict it. Read every research deliverable the map produced, or say out loud which one you skipped and why.

**Do NOT read the waypoint session transcripts.** The map, the decisions and the research deliverables are the compression; trust them. If something is genuinely missing you may check the codebase for a *fact*, but never re-grill the human and never reopen a resolved waypoint — converge, do not re-ideate.

If a `map.md` gap is big enough that no spec can be written over it, do not paper over it and do not grill it out here: say so plainly and tell the human to work one more waypoint before converging.

## 1. Run the pipeline in this window

Invoke `/runcastle:spec` (it writes `spec.md` and completes the `spec` phase); when it returns, invoke `/runcastle:tickets`.

Do not open a new session for these. They run here, on top of the compressed knowledge you just read.

A converged batch is burned exactly like an ideated one, so the two batch-wide rules `/runcastle:tickets` carries bind here unchanged: the batch closes with **one review ticket**, and before you emit you state the **critical path and the width it leaves against `burnConcurrency`**, reslicing when the chain is longer than roughly total / concurrency. A map that was worked waypoint by waypoint makes the second one easy to get wrong — the waypoints were sequenced for a reason, and their tickets usually are not. Chain two only where the later one reads the earlier one's output.

**Re-convergence.** You may be a fresh session continuing a converge that crashed or was closed mid-way — the map is charted but there are no tickets. Do not start over; pick up from whatever is already on disk, which is the only thing that says how far the last session got:

- **`spec.md` already exists** (it is in `docs[]`): read it, do **not** rewrite it, and go straight to `/runcastle:tickets`. There is no step to re-close first — `complete_phase` records a milestone rather than moving anything, so a spec that was written but never reported costs nothing.
- **`spec.md` does not exist**: run `/runcastle:spec` then `/runcastle:tickets` as normal.
- **Tickets already exist** for this lap: reconcile rather than duplicate — this is the one case where `update_ticket` / `cancel_ticket` beat a second `emit_tickets`.

## 2. Parking, not swallowing

If something surfaces that is plainly its own feature rather than part of this one, park it: `mcp__runcastle__create_feature({ title, oneLiner, brief, draft: true })` creates a parked draft — no branch, nothing written — with the `brief` carrying why you deferred it and what it must not swallow. Then get back to converging. Drafts are the only feature you may create here; a full create belongs to the project session.

## 3. Close — hand off to the human

`/runcastle:tickets` ends by emitting tickets to the runcastle store. When it returns, your job is **done**. Tell the human plainly:

> Converged. Tickets are in the runcastle UI — review the ticket cards and click **Burn** to start the AFK agents. I'll stop here.

Do **not** start burning. Burn and Merge are the only two clicks in the whole pipeline, and both belong to the human. (You do not write code here either — that rule is in your injected prompt and enforced by the edit guard, not restated as advice.)
