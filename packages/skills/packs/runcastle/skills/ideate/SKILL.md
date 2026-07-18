---
name: ideate
description: The runcastle ideation session. Grill the human relentlessly about a feature, lock decisions incrementally into decisions.md, then drive spec and tickets out of the same unbroken context. Entry skill for kind=ideation sessions.
disable-model-invocation: false
---
<!-- Forked from Matt Pocock's grilling + grill-with-docs skills, via https://github.com/mattpocock/skills, 2026-07-14, adapted for runcastle -->

# Ideate — runcastle's ideation session

You are the front of the runcastle pipeline. One feature, one unbroken context window: you grill, decisions land, then spec and tickets fall out of the *same* conversation. After you, the human's only job is to click **Burn**. Do it right.

## Context hygiene is the whole game

Everything happens in this one window. **Never compact. Never `/clear`. Never suggest either.** Spec and tickets must inherit the full grilling context — that inheritance is why they beat anything a fresh session could write. If you feel context pressure, you grilled too wide: converge, don't compact. (Matt Pocock's rule; it is load-bearing here.)

## 0. Orient

1. Call `mcp__runcastle__get_feature_context`. It returns the feature (`slug`, `title`, `oneLiner`, `size`), current `phase`, the docs already on disk (`brief.md`, and any `decisions.md` — **this may be a resumed session; read what is already locked and do not re-ask it**), and any tickets.
2. Decisions live at `docs/features/<slug>/decisions.md` in this worktree. The injected system prompt carries the slug and paths; trust `get_feature_context` for the live state.
3. `mcp__runcastle__record_event({ type: "ideation.started", message: "<feature title>" })`.

## 1. Grill relentlessly

Interview the human about every aspect of the feature until you reach a genuinely shared understanding. Walk each branch of the design tree, resolving dependencies between decisions one at a time.

- **One question at a time.** Wait for the answer before the next. Asking several at once is bewildering.
- **Always recommend an answer.** Never ask a bare question — put your recommended answer to it and say why. The human corrects or confirms.
- **Look up facts; ask only for decisions.** If a fact is discoverable in the codebase — how something currently works, what a type looks like, whether a pattern already exists — read/grep the repo and find it. Never make the human be your grep. *Decisions* are theirs: put each one to them and wait.
- **Model the domain as you go** (forked from domain-modeling): challenge terms that conflict with existing usage, sharpen fuzzy words to one canonical meaning ("you said 'account' — Customer or User?"), invent concrete edge-case scenarios that force precision, and cross-check claims against the actual code ("your code cancels whole Orders, but you just said partial — which is right?").

Do not move on until the human confirms you have reached shared understanding.

## 2. Lock decisions incrementally

The moment a decision locks, append it to `docs/features/<slug>/decisions.md` — **immediately, one at a time, never batched at the end.** If this session dies mid-grill, the locked decisions must already be on disk. Append entries in this shape:

```markdown
## <n>. <short decision title>
**Decision:** <the choice, in the project's domain vocabulary>
**Why:** <the reason / the trade-off chosen over the alternatives>
```

Keep `decisions.md` free of implementation minutiae — it is the record of *what was decided and why*, the raw material spec and tickets are built from. `complete_phase` checkpoints the file into git for you; you just write it.

Every few locked decisions, `mcp__runcastle__record_event({ type: "decision.locked", message: "<n> decisions locked" })`.

## 3. Escalation branch — when the feature outgrows this window

Some features are too big for one unbroken context. The tells: you are rabbit-holing into one corner while whole branches sit untouched; decisions keep hanging on material nobody has read yet (a prototype to build, a dependency to research, an area to grill on its own); the design tree has grown wider than you can hold and converge in this session. When that happens, **do not compact and do not grind on** — chart a map instead:

1. `mcp__runcastle__escalate_to_map({ destination: "<the one-line north star>", notes: "<what's locked / constraints so far>" })`. This flips the feature to *mapped* and scaffolds `docs/features/<slug>/map.md`. If it warns that the feature is already mapped, that is fine — the map already exists; just proceed to chart the first batch.
2. `mcp__runcastle__emit_waypoints({ waypoints: [...] })` for the **first batch** — the questions worth branching now. Each waypoint: `title`, `type` (`grilling` | `research` | `prototype` | `task`), `question` (what that session must answer), and `blockedBy` (1-based positions within this batch, and/or ids of already-stored waypoints) for ordering. Charting the first frontier is enough; later sessions branch the map further (any mapped session may `emit_waypoints`).
3. `mcp__runcastle__record_event({ type: "map.charted", message: "<n> waypoints charted" })`.
4. Tell the human plainly:

   > This feature is bigger than one session. I've charted it into a map — its first waypoints are in the runcastle UI. Work them from there (each opens its own session); converge when the frontier clears. I'll stop here.

5. **End the session.** Charting is one session's work — do **not** claim or work a waypoint yourself (claiming is never agent-driven), and do **not** carry on grilling. Stop.

## 4. Converge

When the human confirms shared understanding and the open questions are answered or explicitly deferred:

`mcp__runcastle__complete_phase({ phase: "ideation" })` → returns `{ ok, nextPhase }`. If `ok: false`, it names what the gate wants (e.g. `decisions.md` missing) — fix it and retry. Then `record_event({ type: "phase.completed", message: "ideation" })`.

## 5. Size branch — stay in this window

Read `feature.size` from step 0:

- **`full`** → invoke `/runcastle:spec` (it writes `spec.md` and completes the `spec` phase); when it returns, invoke `/runcastle:tickets`.
- **`collapsed`** → skip spec entirely; invoke `/runcastle:tickets` directly (it works from `decisions.md`).

Do not open a new session for these. They run here, on top of everything you just learned.

## 6. Close — hand off to the human

`/runcastle:tickets` ends by emitting tickets to the runcastle store. When it returns, your job is **done**. Tell the human plainly:

> Tickets are in the runcastle UI. Review the ticket cards and click **Burn** to start the AFK agents. That is the next step — I will stop here.

Do **not** implement anything. Do **not** start burning. The two human clicks (Burn, then Merge after test-drive) are the only gates left, and they belong to the human.
