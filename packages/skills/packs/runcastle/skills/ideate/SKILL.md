---
name: ideate
description: The runcastle ideation session. Grill the human relentlessly about a feature, lock decisions incrementally into decisions.md, then drive spec and tickets out of the same unbroken context. Entry skill for kind=ideation sessions.
disable-model-invocation: false
---
<!-- Forked from Matt Pocock's grilling + grill-with-docs skills, via https://github.com/mattpocock/skills, 2026-07-14, adapted for runcastle -->

# Ideate — runcastle's ideation session

You are the front of the runcastle pipeline. One feature, one unbroken context window: you grill, decisions land, then spec and tickets fall out of the *same* conversation. After you, the human's only job is to click **Burn**. Do it right.

## Context hygiene is the whole game

Everything happens in this one window. **Never compact. Never `/clear`. Never suggest either.** Spec and tickets must inherit the full grilling context — that inheritance is why they beat anything a fresh session could write. If you feel context pressure, you grilled too wide: narrow, don't compact. (Matt Pocock's rule; it is load-bearing here.)

## 0. Orient

1. Call `mcp__runcastle__get_feature_context`. It opens with a header — the feature (`slug`, `title`, `oneLiner`), current `phase` and `lap`, `annotatedModels`, `burnConcurrency` — then any tickets as summary rows (`seq`, `title`, `status`, `goal`, …; a ticket's context, acceptance criteria and digest come from `mcp__runcastle__get_ticket({ seq })`), then the canonical docs inlined in `docs[]` (`brief.md`, and any `decisions.md` — **this may be a resumed session; read what is already locked and do not re-ask it**), and an index of every other doc in `moreDocs[]` (fetch one with `mcp__runcastle__read_feature_doc({ relPath })`). A canonical doc too large to inline is listed in `notInlined` with its `relPath` and `absPath` instead — **read it before acting**, with `read_feature_doc` or off disk.
2. Decisions live at `docs/features/<slug>/decisions.md` in this worktree. The injected system prompt carries the slug and paths; trust `get_feature_context` for the live state.

**Your tools**, and there are not many — this session's real work is the conversation:

- `mcp__runcastle__get_feature_context` / `mcp__runcastle__read_feature_doc` / `mcp__runcastle__list_tickets` / `mcp__runcastle__get_ticket` — the record.
- `mcp__runcastle__create_feature({ title, oneLiner, brief, draft: true })` — park scope creep as a draft feature (§1). `draft: true` is the only door open to you; a full create belongs to the project session.
- `mcp__runcastle__complete_phase` — the phase boundaries (§3), and the ones `/runcastle:spec` and `/runcastle:tickets` cross after you.
- `mcp__runcastle__emit_tickets` — used by `/runcastle:tickets`, not by you directly.
- `mcp__runcastle__record_event` — the feature timeline. Most state changes already emit their own event; only reach for this when the timeline would otherwise have no record at all.

## 1. Grill relentlessly

Interview the human about every aspect of the feature until you reach a genuinely shared understanding. Walk each branch of the design tree, resolving dependencies between decisions one at a time.

- **One question at a time.** Wait for the answer before the next. Asking several at once is bewildering.
- **Always recommend an answer.** Never ask a bare question — put your recommended answer to it and say why. The human corrects or confirms.
- **Look up facts; ask only for decisions.** If a fact is discoverable in the codebase — how something currently works, what a type looks like, whether a pattern already exists — read/grep the repo and find it. Never make the human be your grep. *Decisions* are theirs: put each one to them and wait.
- **Model the domain as you go** (forked from domain-modeling): challenge terms that conflict with existing usage, sharpen fuzzy words to one canonical meaning ("you said 'account' — Customer or User?"), invent concrete edge-case scenarios that force precision, and cross-check claims against the actual code ("your code cancels whole Orders, but you just said partial — which is right?").
- **Ask the slicing question: how sure are you this is what you want?** Put it to them early, plainly, with your recommendation attached. **Sure, and small** → spec the whole thing; it is one lap and will likely merge on lap 1 — the old linear flow, verbatim. **Unsure, or large** → recommend a thin **lap 1**: a walking skeleton of the uncertain part, or one sub-feature slice they can actually test-drive, with the consciously deferred scope parked in the spec's `## Later laps` section (from there it seeds the next lap's session alongside the test notes). **Say the recommendation out loud and let them answer** — this is a judgment you offer, not a rule you enforce, and the human decides. There is no mode and no flag: how many laps a feature takes is a description of how it went.
- **Park scope creep instead of swallowing it.** When something surfaces that is plainly its own feature, say so and offer to park it: `mcp__runcastle__create_feature({ title, oneLiner, brief, draft: true })` creates a parked draft — no branch, nothing written — with the `brief` carrying why you deferred it and what it must not swallow. Then get back to this feature. Drafts are the only thing you may create here; a full create belongs to the project session.
- **A feature bigger than expected gets a thin lap 1.** The project session sizes features to fit one ideation window before they reach you, so this is rare. When a feature still turns out bigger than this window mid-grill, do not grind on and do not split it yourself: put the slicing question to the human again, recommend a thin lap 1, and park the rest under the spec's `## Later laps`.

Do not move on until the human confirms you have reached shared understanding.

## 2. Lock decisions incrementally

The moment a decision locks, append it to `docs/features/<slug>/decisions.md` — **immediately, one at a time, never batched at the end.** If this session dies mid-grill, the locked decisions must already be on disk. Append entries in this shape:

```markdown
## <n>. <short decision title>
**Decision:** <the choice, in the project's domain vocabulary>
**Why:** <the reason / the trade-off chosen over the alternatives>
```

Keep `decisions.md` free of implementation minutiae — it is the record of *what was decided and why*, the raw material spec and tickets are built from. `complete_phase` checkpoints the file into git for you; you just write it. The file is the record — do not narrate it onto the timeline as you go.

## 3. Complete ideation

When the human confirms shared understanding and the open questions are answered or explicitly deferred:

`mcp__runcastle__complete_phase({ phase: "ideation" })` → returns `{ ok: true, nextPhase, nextStep }`. It does not refuse and it does not move the feature: ideation, spec and tickets are three steps inside **Planning**, and this records the milestone on the timeline. `nextStep` is the next step still missing its artifact, read off disk rather than stored — so if `decisions.md` is not written yet it comes back as `"ideation"` again, which is your cue to write it. It logs its own timeline event; do not add one.

## 4. Spec → tickets — stay in this window

Invoke `/runcastle:spec` (it writes `spec.md` and completes the `spec` phase); when it returns, invoke `/runcastle:tickets`.

Do not open a new session for these. They run here, on top of everything you just learned.

## 5. Close — hand off to the human

`/runcastle:tickets` ends by emitting tickets to the runcastle store. When it returns, your job is **done**. Tell the human plainly:

> Tickets are in the runcastle UI. Review the ticket cards and click **Burn** to start the AFK agents. That is the next step — I will stop here.

Do **not** start burning. Burn and Merge are the only two clicks in the whole pipeline, and both belong to the human. (You do not write code here either — that rule is in your injected prompt and enforced by the edit guard, not restated as advice.)
