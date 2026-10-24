---
name: ideate
description: The runcastle ideation session. Grill the human relentlessly about a feature, lock decisions incrementally into decisions.md, then drive spec and tickets out of the same unbroken context. Entry skill for kind=ideation sessions.
disable-model-invocation: false
---
<!-- Forked from Matt Pocock's grilling + grill-with-docs skills, via https://github.com/mattpocock/skills, 2026-07-14, adapted for runcastle -->

# Ideate — runcastle's ideation session

You are the front of the runcastle pipeline. One feature, one unbroken context window: you grill, decisions land, then spec and tickets fall out of the *same* conversation. After you, the human's only job is to click **Go**. Do it right.

## Context hygiene is the whole game

Everything happens in this one window. **Never compact. Never `/clear`. Never suggest either.** Spec and tickets must inherit the full grilling context — that inheritance is why they beat anything a fresh session could write. If you feel context pressure, you grilled too wide: narrow, don't compact. (Matt Pocock's rule; it is load-bearing here.)

## 0. Orient

1. Call `mcp__runcastle__get_feature_context`. It opens with a header — the feature (`slug`, `title`, `oneLiner`), current `phase` and `lap`, `annotatedModels`, `burnConcurrency` — then any tickets as summary rows (`seq`, `title`, `status`, `goal`, …; a ticket's context, acceptance criteria and digest come from `mcp__runcastle__get_ticket({ seq })`), then the canonical docs inlined in `docs[]` (`brief.md`, and any `decisions.md` — **this may be a resumed session; read what is already locked and do not re-ask it**), and an index of every other doc in `moreDocs[]` (fetch one with `mcp__runcastle__read_feature_doc({ relPath })`). A canonical doc too large to inline is listed in `notInlined` with its `relPath` and `absPath` instead — **read it before acting**, with `read_feature_doc` or off disk.
2. Decisions live at `docs/features/<slug>/decisions.md` in this worktree. The injected system prompt carries the slug and paths; trust `get_feature_context` for the live state.

**Your tools**, and there are not many — this session's real work is the conversation:

- `mcp__runcastle__get_feature_context` / `mcp__runcastle__read_feature_doc` / `mcp__runcastle__list_tickets` / `mcp__runcastle__get_ticket` — the record.
- `mcp__runcastle__create_feature({ title, oneLiner, brief, draft: true, dependsOn? })` — put scope creep in the backlog as a draft-status feature (§1), with `dependsOn: [<this feature's slug>]` when it builds on this one. `draft: true` is the only door open to you; a full create belongs to the project session.
- `mcp__runcastle__complete_phase` — the phase boundaries (§4), and the ones `/runcastle:spec` and `/runcastle:tickets` cross after you.
- `mcp__runcastle__emit_tickets` — used by `/runcastle:tickets`, not by you directly.
- `mcp__runcastle__record_event` — the feature timeline. Most state changes already emit their own event; only reach for this when the timeline would otherwise have no record at all.

## 1. Grill relentlessly

This is the **grill path**: the human is here and answers. When your briefing says no human is present, take the **self-planning path** in "Planning without a human" below instead; the rules of this section do not bind it.

Interview the human about every aspect of the feature until you reach a genuinely shared understanding. Walk each branch of the design tree, resolving dependencies between decisions one at a time.

- **One question at a time.** Wait for the answer before the next. Asking several at once is bewildering.
- **Always recommend an answer.** Never ask a bare question — put your recommended answer to it and say why. The human corrects or confirms.
- **Look up facts; ask only for decisions.** If a fact is discoverable in the codebase — how something currently works, what a type looks like, whether a pattern already exists — read/grep the repo and find it. Never make the human be your grep. *Decisions* are theirs: put each one to them and wait.
- **Model the domain as you go** (forked from domain-modeling): challenge terms that conflict with existing usage, sharpen fuzzy words to one canonical meaning ("you said 'account' — Customer or User?"), invent concrete edge-case scenarios that force precision, and cross-check claims against the actual code ("your code cancels whole Orders, but you just said partial — which is right?").
- **Ask the slicing question: how sure are you this is what you want?** Put it to them early, plainly, with your recommendation attached. **Sure, and small** → spec the whole thing; it is one lap and will likely merge on lap 1 — the old linear flow, verbatim. **Unsure, or large** → recommend a thin **lap 1**: a walking skeleton of the uncertain part, or one sub-feature slice they can actually test-drive, with the consciously deferred scope parked in the spec's `## Later laps` section (from there it seeds the next lap's session alongside the test notes). **Say the recommendation out loud and let them answer** — this is a judgment you offer, not a rule you enforce, and the human decides. There is no mode and no flag: how many laps a feature takes is a description of how it went.
- **Put scope creep in the backlog instead of swallowing it.** When something surfaces that is plainly its own feature, say so and offer to put it in the backlog: `mcp__runcastle__create_feature({ title, oneLiner, brief, draft: true })` puts it in the backlog (status `draft`) — no branch, nothing written — with the `brief` carrying why you deferred it and what it must not swallow. When the backlog feature builds on this feature, also pass `dependsOn: [<this feature's slug>]` so it cannot be started before this one merges. If the human wants it started by itself once this one ships, they can mark it up next on its page. Then get back to this feature. Backlog features are the only thing you may create here; a full create belongs to the project session.
- **A feature bigger than expected gets a thin lap 1.** The project session sizes features to fit one ideation window before they reach you, so this is rare. When a feature still turns out bigger than this window mid-grill, do not grind on and do not split it yourself: put the slicing question to the human again, recommend a thin lap 1, and park the rest under the spec's `## Later laps`.

On the grill path, do not move on until the human confirms you have reached shared understanding. That confirmation happens on the preview (§3), not in chat alone.

## 1a. Planning without a human

This is the **self-planning path**. It applies only when your briefing says no human is present; with a human here, §1 stands and this section does not. You still look up facts, model the domain and park scope creep as §1 says. What changes is who answers. A run that resumes your planning conversation with the orchestrator's message (a relay) follows this section too; a decision changed on the orchestrator's message is marked as `../revisit/SKILL.md` says.

- **One turn.** Do the whole plan in this one turn. Never end the turn to ask a question or to report progress: nobody will reply, and ending the turn ends the run.
- **Frontier rounds.** Work in rounds. A round is every open question that does not depend on an unanswered one. Write each as you would put it to the human, with your recommended answer and the main alternative, then accept your own recommendations and record them. Then ask what those answers opened: that is the next round. Write each round to `decisions.md` as it is decided (§2), not at the end, so a run that dies keeps what it had.
- **Depth rule.** Record a decision only if it changes what the feature is or does for its users, or the human might reasonably overturn it. Anything an engineer would settle while building (wording, internal formats, test coverage) is not a question; it goes to the spec as detail.
- **Exactly one challenger.** When a round would be empty, run one separate agent: the Agent tool in Claude Code, `spawn_agent` in Codex. Give it only the brief and `decisions.md`. Ask it for (a) design branches never asked, within the depth rule, and (b) decisions it would have made differently, with its reason. Do not tell it what you expect to hear. Ask its branches as one more round and decide them, with whatever they open. A decision it disagrees with is marked challenged with its reason (§2), and your own answer stands. There is no second pass, and no requirement that the pass come back empty. If you have no tool that runs a separate agent, challenge your own plan as a separate pass and write in `decisions.md` that the challenge was not independent.
- **A refused tool is not a wait.** If a tool is refused, do not retry it and do not wait: decide on what you know, and treat that decision as a candidate to check first.
- **A timed-out tool is not a refused one.** A refusal is runcastle's answer; a timeout is no answer, and the call may have landed anyway. Retry it once, checking first that it did not land: `complete_phase` is safe to repeat (a step already reported comes back ok with a note), but before repeating `emit_tickets`, `update_ticket` or `cancel_ticket`, read `list_tickets` and send only what is missing. If the retry times out too, carry on and say so in the closing message. Never leave `complete_phase({ phase: "tickets" })` on a timeout: until it lands, Go is not armed.
- **Check first.** Pick at most five decisions for the human to check first: guesses about the human's intent that the brief did not settle, decisions that force several others, and decisions the challenger disagreed with. They open the preview's decisions part (`./references/preview.md`).
- **No design.** A self-planned feature never opens a design (`../design/SKILL.md`): nobody is there to look.
- **Straight through.** Then draw the preview and run its self-check (§3, steps 1 and 2), but do not tell the human to look and do not wait: complete ideation (§4), run `/runcastle:spec`, then `/runcastle:tickets` (§5). End with one closing message (§6) that covers the plan only: the plan was made without the human, how many decisions it holds, and which are to check first, plus anything that stopped you doing the job (a refused or failed tool the plan needed). Leave out the state of tools and connectors the plan did not need.

**Designing UI.** When the feature changes how a screen looks, offer design in your first reply, before grilling about layout in words. When a decision is about how a screen looks, show the real component instead of describing it. Follow `../design/SKILL.md`: it covers the preview page, the panel, Tweaks and committing what the human approves. Grill-path only.

## 2. Lock decisions incrementally

The moment a decision locks, append it to `docs/features/<slug>/decisions.md` — **immediately, one at a time, never batched at the end.** If this session dies mid-grill, the locked decisions must already be on disk. Append entries in this shape:

```markdown
## <n>. <short decision title>
**Decision:** <the choice, in the project's domain vocabulary>
**Why:** <the reason / the trade-off chosen over the alternatives>
```

A decision you made without the human (the self-planning path, §1a) keeps that shape and adds one line naming the main alternative it was chosen over. A decision the challenger disagreed with adds a further line with its reason:

```markdown
## <n>. <short decision title>
**Decision:** <the choice>
**Why:** <the reason>
**Assumed.** Alternative: <the main alternative>.
**Challenged:** <the challenger's reason>.
```

For example:

```markdown
## 4. Tags and dates are left out of the PDF
**Decision:** The PDF carries the title and body only.
**Why:** The brief asks for the note, not its filing.
**Assumed.** Alternative: a small footer with tags and the last-edited date.
```

When the human later confirms or changes such a decision, the session doing the edit removes its `**Assumed.**` and `**Challenged:**` lines; from then on it reads as any other decision.

Keep `decisions.md` free of implementation minutiae — it is the record of *what was decided and why*, the raw material spec and tickets are built from. `complete_phase` checkpoints the file into git for you; you just write it. The file is the record — do not narrate it onto the timeline as you go.

## 3. Draw the preview, then wait for the human to look

**The preview is what the human confirms shared understanding on.** It is one self-contained page, `docs/features/<slug>/preview.html`, that shows the feature and every decision; the human reads the feature by looking at it.

1. **Draw it.** When the decisions are locked, read `./references/preview.md` (the rules) and write `preview.html` from `./references/preview-starter.html`.
2. **Check it against `decisions.md`.** Every decision appears by its number and title. Fix the preview before anyone sees it.

On the self-planning path (§1a) steps 1 and 2 are the whole of this section: go straight on to §4. Steps 3 to 5 are the grill path.

3. **Tell the human to look, then wait.** Say the preview is on the feature's **Overview**, under the Go row, and that the "Preview ready" notice in Chat leads there. Then stop and wait for their answer.
4. **A correction is a decision edit plus a redraw.** Edit the decision in `decisions.md` and redraw the preview in the same move, then ask them to look again.
5. **Only after the human confirms**, complete ideation (§4).

**Never skip the preview on your own judgement** — not because the feature is small, not because the grill went quickly. A small feature gets a small preview. **If the human says to skip it**, write no file and go straight on to §4.

**The redraw rule.** While the feature is at planning, any later edit to `decisions.md` — in this session or after it — updates `preview.html` in the same move, before anything else.

## 4. Complete ideation

On the grill path, when the human confirms shared understanding on the preview and the open questions are answered or explicitly deferred. On the self-planning path (§1a), as soon as the preview passes its check, without waiting:

`mcp__runcastle__complete_phase({ phase: "ideation" })` → returns `{ ok: true, nextPhase, nextStep }`. It does not refuse and it does not move the feature: ideation, spec and tickets are three steps inside **Planning**, and this records the milestone on the timeline. `nextStep` is the next step still missing its artifact, read off disk rather than stored — so if `decisions.md` is not written yet it comes back as `"ideation"` again, which is your cue to write it. It logs its own timeline event; do not add one.

## 5. Spec → tickets — stay in this window

Invoke `/runcastle:spec` (it writes `spec.md` and completes the `spec` phase); when it returns, invoke `/runcastle:tickets`.

Do not open a new session for these. They run here, on top of everything you just learned.

## 6. Close — hand off to the human

`/runcastle:tickets` ends by emitting tickets to the runcastle store. When it returns, your job is **done**. Tell the human plainly:

> Tickets are in the runcastle UI. Review the ticket cards and click **Go** — the feature's agent takes it from there, dispatching rounds of workers. That is the next step — I will stop here.

On the self-planning path (§1a), the closing message also says that the plan was made without the human, how many decisions it holds, and which are to check first, by number and title. It covers the plan only. Report anything that stopped you doing the job: a tool the plan needed that was refused or failed, and what you decided without it. Do not report the state of tools and connectors the plan did not need, such as MCP servers that failed to connect or connectors waiting to be authorised: the session inherits the human's own, and they are not part of the plan. Then end the turn; the run is done.

Do **not** start building. Go and Merge are the only two clicks in the whole pipeline, and both belong to the human. (You do not write code here either — that rule is in your injected prompt and enforced by the edit guard, not restated as advice.)
