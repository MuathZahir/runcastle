---
name: revisit
description: Fold late-arriving information into a feature whose sessions are finished — amend the docs, then reconcile tickets (update/cancel/emit); a revisit never moves the feature. Entry skill for kind=revisit sessions.
disable-model-invocation: false
---

# Revisit

The human came back: they remembered a constraint, changed their mind, or learned something that the grilling/spec didn't capture. This session's job is to make the **record** and the **ticket queue** match the new reality — nothing more. The pipeline does not move; whatever phase the feature is in, it stays in.

Once the human gives Go the feature's chat is its lead and runs on the lead skill instead; this one serves a feature still in planning, a shipped one, and the errands your briefing names (a merge conflict to resolve, the orchestrator's message).

## Order of operations

1. **Listen first.** The human opens with what changed. If this terminal resumed the previous conversation, use that context; do not re-grill what is already settled. Ask only the questions the NEW information raises.
2. **Context.** Call `mcp__runcastle__get_feature_context` — the feature, its `phase` and `lap`, the canonical docs inlined in `docs[]` (brief, decisions, spec), an index of everything else in `moreDocs[]` (test notes and any other doc the feature's sessions left behind; fetch one with `mcp__runcastle__read_feature_doc({ relPath })`), and every ticket as a summary row with its id, `seq`, status and `goal` — its context, acceptance criteria and digest come from `mcp__runcastle__get_ticket({ seq })`. A canonical doc too large to inline is listed in `notInlined` instead; read it before acting. The injected system prompt carries the slug and paths; trust `get_feature_context` for the live state. When all you need is ticket ids to operate on, `mcp__runcastle__list_tickets({ status? })` is the cheap call — it returns the queue without the docs.
3. **Docs.** Capture the change as decision prose:
   - Append to `docs/features/<slug>/decisions.md` under a dated `## Revisited <date>` heading — never rewrite old decisions, supersede them ("Supersedes: <old decision>").
   - **Clear the assumed mark.** A decision the session made without the human carries an `**Assumed.**` line, and perhaps a `**Challenged:**` line. When the human confirms or changes such a decision, remove both lines from it in the same edit. Decisions the human did not touch keep theirs.
   - **A change on the orchestrator's message is not the human's.** When your briefing says the message is from the orchestrator, the decision you change keeps its `**Assumed.**` line, or gains one, and adds `**Changed by the orchestrator:** <why>` with the orchestrator's reason. The human has still not seen it, and the record must say who decided. **A message that relays the human's own answer** is the human confirming: remove the marks from that decision as above, `**Changed by the orchestrator:**` included.
   - If `spec.md` exists and the change touches it, amend the affected sections in place.
   - **Redraw the preview.** When the feature is at `planning` and `docs/features/<slug>/preview.html` exists, update `preview.html` in the same move as the decisions edit, before anything else, following `../ideate/references/preview.md`, check-first group included: a decision that lost its assumed mark leaves that group. The human reads the plan off the preview, so a preview that disagrees with `decisions.md` misleads them at Go.
4. **Ticket surgery.** Walk the ticket list against the new reality:
   - Stale but still needed → `mcp__runcastle__update_ticket({ id, ...changed fields })` (pending/failed only).
   - No longer needed → `mcp__runcastle__cancel_ticket({ id, reason })` (pending/failed only).
   - New work required → `mcp__runcastle__emit_tickets({ tickets })` (batch, same shape as ideation). Whether a ticket ships a scenario follows the same rule as planning: `../tickets/SKILL.md`, "Ship a scenario when the state is hard to reach".
   - `done` work now wrong → emit a NEW ticket that corrects it. Never touch done/burning tickets.
5. **Close.** `mcp__runcastle__record_event({ type: "feature.revisited", message: "<one-line gist of what changed>" })`, then tell the human what state you left things in — especially, at planning, whether the plan is ready for them to click **Go**.

## Designing UI

When the human wants to see how a screen looks or change it, show the real component rather than describing it. When what they brought changes a screen, offer it before they ask. Follow `../design/SKILL.md`: a preview page, the panel beside the chat, and a `design: <what>` commit once they approve. Approved design is committed before Go.

## Stand on the failure

Every bug the human reports gets exactly one of three answers before you card a fix for it:

- **Reproduced** — you drove it and saw the failure. Say what you did and what happened.
- **Traced** — you found it in the code. Name the file and line, and what there is wrong.
- **Unreproduced** — you could not do either. Say so plainly, and then make reproducing it the **first** acceptance criterion of the ticket that fixes it, so the burner stands on the failure before it changes anything.

Never card a fix for a failure nobody has stood on: a ticket written from a one-line report and a guess sends an agent to change the code it guessed at, and the next drive hits the same bug. This is what the human's report buys — it is the report, not a diagnosis.

## Do NOT

- **Never call `complete_phase`** — a revisit has no planning steps of its own to report; the human's clicks move the feature.
- **Code changes ride tickets** — the burner (or a human) implements them, never this session. (The no-code rule itself is in your injected prompt and enforced by the edit guard.)

## Scope check

If what the human brings is not an amendment but a whole new capability, say so — and park it rather than losing it:

> That reads like a new feature, not a revision of this one. I'll put it in the backlog so it isn't lost; you can start it from the runcastle UI when you want it, and it gets grilled there.

`mcp__runcastle__create_feature({ title, oneLiner, brief, draft: true })` — a backlog feature (status `draft`), no branch cut and nothing written, with the `brief` carrying why you deferred it and what it must not swallow. `draft: true` is the only door open to you; a full create belongs to the project session.
