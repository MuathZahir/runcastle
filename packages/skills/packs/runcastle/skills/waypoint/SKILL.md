---
name: waypoint
description: The runcastle waypoint session. Work ONE waypoint on a feature's map — grill, prototype, or run a task checklist for its assigned question — write the decision prose to the docs, then resolve the waypoint. Entry skill for kind=waypoint sessions.
disable-model-invocation: true
---
<!-- runcastle mapped-ideation waypoint session (ADR-0001 §13.5) -->

# Waypoint — work one node on the map

This is a **mapped-ideation** feature: too big for one context window, so it was charted into a *map* of waypoints. You have been handed exactly ONE of them. Your job is narrow and finite: answer its question, write the decision down, resolve it. You are **not** converging the whole feature, writing a spec, or emitting tickets — other sessions and the human own that.

## 0. Orient

1. Call `mcp__runcastle__get_feature_context`. The injected system prompt carries the slug, the paths and your question; trust `get_feature_context` for the live state. For a mapped feature it returns, besides the usual feature/phase/docs:
   - `waypoints` — every waypoint on the map, with its `title`, `type`, `question`, status and (once terminal) `summary`.
   - `frontierIds` — the ids currently open, unclaimed and unblocked.
   - `assignedWaypointId` — **your** waypoint's id, the one this session claimed. Find that id in `waypoints` and read its `title`, `type` and `question`. That is your whole assignment.
2. `docs[]` inlines the canonical docs in full — `brief.md`, `map.md`, `decisions.md`, `spec.md` if it exists. Read `map.md` (Destination, Notes, Not-yet-specified, Out-of-scope) so your answer fits the north star, and `decisions.md` for what is already locked — **do not re-litigate settled decisions.**
3. **Read the research already done for this feature.** Earlier `research` waypoints wrote deliverables to `docs/features/<slug>/research/<seq>-<slug>.md`. They are *not* inlined — they appear in the `moreDocs` index with their `relPath` and `bytes`, and each resolved research waypoint's `summary` in `waypoints` names its file (`researched: <title> — see <path>`). Fetch the ones your question depends on with `mcp__runcastle__read_feature_doc({ relPath })`, or read them off disk in this worktree. A waypoint that re-derives a finding an earlier waypoint already paid an AFK run for is a wasted session.

## 1. Work it — mode by type

Your waypoint's `type` picks the mode:

- **`grilling`** → grill the human on the question exactly as `/runcastle:ideate` does (`/runcastle:ideate` §1 is the procedure — one question at a time, always recommend an answer, look up facts in the code, model the domain, don't move on until you share understanding). Scope the grill to THIS waypoint's question — resist wandering into the whole feature.
- **`prototype`** → build the smallest throwaway spike that answers the question (a fork to compare two approaches, a spike to prove feasibility). **Write it under `docs/features/<slug>/prototypes/` and nowhere else.** That directory is the only place a talk session may put code: everything outside `docs/features/<slug>/` is denied by the edit guard, and the deny is real, not advisory. The spike is *evidence for the decision prose*, not shipped code — nothing under `prototypes/` is ever built on, and the working version rides a ticket like any other code. So do not try to write into `src/`, do not conclude the prototype is impossible and emit a ticket instead, and do not ask the human to run it for you: spike it in `prototypes/`, read what it proves, write the decision (§2), and let the spike go.
- **`task`** → run the concrete checklist the question describes (gather the facts, enumerate the cases, fill the table). Produce the artifact the waypoint asked for.

If, while working, you discover the question really splits into new sub-questions or uncovers whole new branches, chart them: `mcp__runcastle__emit_waypoints({ waypoints: [...] })` — each with `title`, `type`, `question`, `blockedBy` (1-based positions in this batch and/or existing waypoint ids), and `originWaypointId: "<your waypoint id>"` so the lineage ("surfaced by …") is recorded. Any mapped session may branch the map; that is the recursion. Emitting a waypoint does **not** relieve you of answering your own.

If something surfaces that is plainly its own **feature** rather than another waypoint, park it instead of swallowing it: `mcp__runcastle__create_feature({ title, oneLiner, brief, draft: true })` creates a parked draft — no branch, nothing written — with the `brief` carrying why you deferred it. Drafts are the only feature you may create here; a full create belongs to the project session.

## 2. Write the decision prose — directly, to the docs

The answer is **prose in the docs**, not a tool argument. Serial HITL makes these writes race-free, so edit the files directly in this talk worktree:

- **Resolving** (question answered): append the decision to `docs/features/<slug>/decisions.md`, one entry:

  ```markdown
  ## <n>. <short decision title>
  **Decision:** <the choice, in the project's domain vocabulary>
  **Why:** <the reason / the trade-off chosen over the alternatives>
  ```

- **Dropping** (no longer worth answering): record a one-line gist under `## Out of scope` in `docs/features/<slug>/map.md`, so the map remembers why it was cut.

Write the prose **before** you resolve — the resolve tool flips machinery only and does not carry your answer. If a prototype produced the answer, the decision entry must stand on its own: the reader of `decisions.md` is a converge session that will never open your spike.

## 3. Resolve — end the session

`mcp__runcastle__resolve_waypoint({ id: "<your waypoint id>", disposition: "resolved" | "dropped", summary: "<one-line gist>" })`.

This marks your waypoint terminal and frees any waypoint that was blocked only on yours — they appear on the frontier for the next session to Work. The `summary` is the one line shown on the map card, and it is what a later session sees first; if your work left a file behind (a prototype, a table), name its path there.

Then tell the human plainly:

> This waypoint is resolved — its decision is in `decisions.md`. Back in the runcastle UI, the frontier has updated; work the next waypoint, or converge once it clears. I'll stop here.

**End the session.** One waypoint, one session. Do **not** claim or work another waypoint, do **not** converge, do **not** spec or emit tickets. If you close the terminal without resolving, runcastle auto-releases the waypoint back to the frontier and offers **Resume** — so resolving is how you signal you are genuinely done.
