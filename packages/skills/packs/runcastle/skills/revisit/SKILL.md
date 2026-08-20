---
name: revisit
description: Fold late-arriving information into a feature whose sessions are finished — amend the docs, then reconcile tickets (update/cancel/emit); an ordinary revisit never advances phases. Also the lap session: on a Rethink from review, digest the test drive, amend decisions + spec, emit the lap's tickets and complete ideation → spec → tickets in the one session. Entry skill for kind=revisit sessions.
disable-model-invocation: true
---

# Revisit

The human came back: they remembered a constraint, changed their mind, or learned something that the grilling/spec didn't capture. This session's job is to make the **record** and the **ticket queue** match the new reality — nothing more. The pipeline does not move; whatever phase the feature is in, it stays in.

That is the ordinary revisit, and it is what the moves below describe. The one exception is a **lap**: a Rethink from review opens this same session with a lap kickoff and a bigger job — see **Lap mode** below, and work that section instead.

## Order of operations

1. **Listen first.** The human opens with what changed. If this terminal resumed the previous conversation, use that context; do not re-grill what is already settled. Ask only the questions the NEW information raises.
2. **Context.** Call `mcp__runcastle__get_feature_context` — the feature, its `phase` and `lap`, the canonical docs inlined in `docs[]` (brief, map, decisions, spec), an index of everything else in `moreDocs[]` (test notes, `research/*.md`; fetch one with `mcp__runcastle__read_feature_doc({ relPath })`), and every ticket with its id and status. The injected system prompt carries the slug and paths; trust `get_feature_context` for the live state. When all you need is ticket ids to operate on, `mcp__runcastle__list_tickets({ status? })` is the cheap call — it returns the queue without the docs.
3. **Docs.** Capture the change as decision prose:
   - Append to `docs/features/<slug>/decisions.md` under a dated `## Revisited <date>` heading — never rewrite old decisions, supersede them ("Supersedes: <old decision>").
   - If `spec.md` exists and the change touches it, amend the affected sections in place.
   - If the feature is mapped, keep `map.md` honest (destination/out-of-scope).
4. **Ticket surgery.** Walk the ticket list against the new reality:
   - Stale but still needed → `mcp__runcastle__update_ticket({ id, ...changed fields })` (pending/failed only).
   - No longer needed → `mcp__runcastle__cancel_ticket({ id, reason })` (pending/failed only).
   - New work required → `mcp__runcastle__emit_tickets({ tickets })` (batch, same shape as ideation).
   - `done` work now wrong → emit a NEW ticket that corrects it. Never touch done/burning tickets.
5. **Close.** `mcp__runcastle__record_event({ type: "feature.revisited", message: "<one-line gist of what changed>" })`, then tell the human what state you left things in — especially whether a re-Burn is needed (pending tickets exist and the feature is at `implementation`).

## Lap mode (a Rethink)

Your kickoff line reads `LAP <n> REVIEW ITERATION`. The human burned the last lap, test-drove the branch, and clicked **Rethink**: the code was right, the *spec* wasn't. `feature.rethink` has already incremented the lap and looped the feature back, so it sits at **ideation**, not review. One trip round the pipeline is a lap, and this session is the whole front half of lap `<n>` — you carry it from what-the-drive-taught to ticket cards waiting on the human's **Burn** click, in this one conversation:

1. **Digest what the drive taught.** Your two inputs are the previous lap's section of `docs/features/<slug>/test-notes.md` — it is in `moreDocs[]`, so read it with `mcp__runcastle__read_feature_doc({ relPath: "test-notes.md" })` (or off disk) — and the `## Later laps` section of `spec.md`, which is inlined in `docs[]`. **Both may be absent** — that is not an error and not something to go hunting for: interview the human from scratch instead. What did they hit, what surprised them, what do they want instead now they've used it?
2. **Context.** `mcp__runcastle__get_feature_context` — the feature (including its `lap`), the docs, and the full ticket history across every lap; each ticket's own `lap` is what separates them. Skim what the last lap actually landed and what failed before you interview.
3. **Never re-emit a promoted note.** Notes the human already promoted from the review checklist are tickets in *this* lap and arrive as ids in your context. However well such a note reads as a ticket, if its id is in front of you the work is already carded — emitting it again gives the burner the same job twice.
4. **Grill, briefly.** A small rethink is a short grilling: a few questions, one at a time, each with your recommended answer attached. Prune and promote `## Later laps` entries with the human as part of that conversation — what the drive taught is usually what decides which deferred scope this lap picks up and which stays parked.
5. **Amend the docs.** Append this lap's learning to `docs/features/<slug>/decisions.md` under a `## Lap <n>` heading (the convention) — never rewrite old decisions, supersede them. Then amend `spec.md` in place: the sections this lap changes, plus the pruned `## Later laps`.
6. **Emit this lap's tickets.** `mcp__runcastle__emit_tickets({ tickets })` — only the work this lap will burn; the rest stays in `## Later laps`. Reconcile stale pending tickets with `update_ticket` / `cancel_ticket`; `done` work that is now wrong gets a NEW ticket, as always.
7. **Advance the pipeline.** `mcp__runcastle__complete_phase` through `ideation` → `spec` → `tickets`, here, without opening another session. It will not cross into implementation: the `tickets` call comes back `ok: true` with `waitingOn: "human burn"` and the feature parks at `tickets` instead of advancing — that gate (G3) is the human's Burn click, which is the point.
8. **Hand to Burn.** Tell the human in a line or two what this lap does, then:

   > Lap `<n>` is specced and carded. Review the ticket cards and click **Burn** — I'll stop here.

If the rethink turns out to be genuinely big — whole branches of design reopened, decisions hanging on material nobody has read — say so and escalate the way ideation would (`/runcastle:ideate` §3, the map), rather than grinding it out here.

## Do NOT

- **Never call `complete_phase` in an ordinary revisit.** It has no gates to cross; the human drives the pipeline from the UI. **Lap mode is the one exception** — advancing ideation → spec → tickets is its job (move 7), and nothing else here licenses it.
- **Never resolve or reopen waypoints.** If a resolved waypoint's answer is now wrong, record the superseding decision in `decisions.md` — the map's history stays intact.
- **Code changes ride tickets** — the burner (or a human) implements them, never this session. (The no-code rule itself is in your injected prompt and enforced by the edit guard.)

## Scope check

If what the human brings is not an amendment but a whole new capability, say so — and park it rather than losing it:

> That reads like a new feature, not a revision of this one. I'll park it as a draft so it isn't lost; you can start it from the runcastle UI when you want it, and it gets grilled there.

`mcp__runcastle__create_feature({ title, oneLiner, brief, draft: true })` — a parked draft, no branch cut and nothing written, with the `brief` carrying why you deferred it and what it must not swallow. `draft: true` is the only door open to you; a full create belongs to the project session.
