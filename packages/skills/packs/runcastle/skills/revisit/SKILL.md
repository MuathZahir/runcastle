---
name: revisit
description: Fold late-arriving information into a feature whose sessions are finished — amend the docs, then reconcile tickets (update/cancel/emit). Never advances phases. Entry skill for kind=revisit sessions.
disable-model-invocation: false
---

# Revisit

The human came back: they remembered a constraint, changed their mind, or learned something that the grilling/spec didn't capture. This session's job is to make the **record** and the **ticket queue** match the new reality — nothing more. The pipeline does not move; whatever phase the feature is in, it stays in.

## Order of operations

1. **Listen first.** The human opens with what changed. If this terminal resumed the previous conversation, use that context; do not re-grill what is already settled. Ask only the questions the NEW information raises.
2. **Context.** Call `mcp__runcastle__get_feature_context` — it returns the feature, phase, all docs, and all tickets with their ids and statuses. You need the ticket list before any surgery.
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

## Review iteration ("Iterate")

At the **review** phase this same session is surfaced as **Iterate**: the tickets were burned, the human test-drove the branch, and now they want to fix what they found. The moves are the same — docs, then ticket surgery — with a review flavour:

1. **Read the outcome first.** `get_feature_context` carries the latest run outcome and every ticket's final state (done / failed / cancelled). Skim it before the interview so you know what already shipped and what failed.
2. **Interview about the test drive.** Ask what they hit — bugs, rough edges, missing polish, follow-on tweaks. One concrete change per fix ticket.
3. **Emit fix tickets.** New work → `emit_tickets`. If a just-burned ticket was wrong, emit a NEW fix ticket (never reopen `done` work). Reconcile stale pending tickets with `update_ticket` / `cancel_ticket`.
4. **Hand back to Burn.** Do NOT advance the phase. When the cards are ready, tell the human to review them and click **Burn** — burning from review loops the feature back through implementation, and the run returns it to review when it finishes. The loop repeats until they click Merge & ship.

## Do NOT

- **Never call `complete_phase`.** A revisit has no gates to cross; the human drives the pipeline from the UI.
- **Never resolve or reopen waypoints.** If a resolved waypoint's answer is now wrong, record the superseding decision in `decisions.md` — the map's history stays intact.
- **Never implement changes.** Code changes ride tickets; the burner (or a human) implements them.

## Scope check

If what the human brings is not an amendment but a whole new capability, say so:

> That reads like a new feature, not a revision of this one. Create it in the runcastle UI and grill it there — I can record a pointer note here.

Then `record_event` a one-line note so the idea is not lost.
