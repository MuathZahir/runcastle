---
name: revisit
description: Fold late-arriving information into a feature whose sessions are finished — amend the docs, then reconcile tickets (update/cancel/emit); an ordinary revisit never moves the feature. Also the lap session: digest the test drive, amend decisions + spec, emit the lap's tickets and report ideation → spec → tickets in the one session. Entry skill for kind=revisit sessions.
disable-model-invocation: true
---

# Revisit

The human came back: they remembered a constraint, changed their mind, or learned something that the grilling/spec didn't capture. This session's job is to make the **record** and the **ticket queue** match the new reality — nothing more. The pipeline does not move; whatever phase the feature is in, it stays in.

That is the ordinary revisit, and it is what the moves below describe. The one exception is a **lap**, and your kickoff line is what tells you: a lap briefing opens this same session with a bigger job — see **Lap mode** below, and work that section instead. Go by the line you were given, never by a guess from the feature's state.

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
5. **Close.** `mcp__runcastle__record_event({ type: "feature.revisited", message: "<one-line gist of what changed>" })`, then tell the human what state you left things in — especially whether a re-Burn is needed (pending tickets exist and the feature is at `building` with no run behind them).

## Lap mode (another lap over the same feature)

Your kickoff line reads `LAP <n> REVIEW ITERATION`. The human burned the last lap, test-drove the branch, and came back with what it taught them: the code was right, the *spec* wasn't. Nothing looped the feature backwards to get you here and nothing can — **Planning → Building → Review → Shipped** runs one way only — so read its `phase` off `get_feature_context` rather than assuming which one you are standing in. One trip round is a lap, and this session is the whole front half of lap `<n>` — you carry it from what-the-drive-taught to ticket cards waiting on the human's **Burn** click, in this one conversation:

1. **Context.** `mcp__runcastle__get_feature_context` — the feature (including its `lap`), the docs, `reviewEvidence`, and the full ticket history across every lap; each ticket's own `lap` is what separates them. Skim what the last lap actually landed and what failed before you interview.
2. **Read the evidence before you plan.** Not after, and not instead of the interview. Your inputs, in reading order:
   - **The previous lap's review evidence.** Your injected prompt names it by absolute path, and `get_feature_context` → `reviewEvidence` carries the same paths: `digestPath` is the review agent's own account of what it found, `dir` holds that pass's screenshots and `walkthrough.webm`, and `status` is how the pass itself ended — the review outcome. It reaches you through nothing else: the directory is host scratch space outside the repo, and every ticket's `digest` is stripped out of the context payload. An empty `reviewEvidence` means the previous lap finished no review pass — say that plainly rather than implying you read one.
   - **What the human wrote down**: the previous lap's section of `docs/features/<slug>/test-notes.md` — it is in `moreDocs[]`, so read it with `mcp__runcastle__read_feature_doc({ relPath: "test-notes.md" })` (or off disk) — and the `## Later laps` section of `spec.md`, which is inlined in `docs[]`. **Both may be absent** — that is not an error and not something to go hunting for: interview the human from scratch instead. What did they hit, what surprised them, what do they want instead now they've used it?
   - **What the docs say is not demonstrable yet.** Grep `spec.md` and this feature's tickets for `not demonstrable`, `do not demo` and `later laps`, and tell the human what you found **before** you offer a test drive. A human was once handed a lap-1 build whose own plan said "no UI, nobody should demo this before ticket X"; the drive taught nothing and cost them the time to find that out. Say which parts are drivable and which are not, then offer the drive.
3. **Never re-emit a promoted note.** Notes the human already promoted from the review checklist are tickets in *this* lap and arrive as ids in your context. However well such a note reads as a ticket, if its id is in front of you the work is already carded — emitting it again gives the burner the same job twice.
4. **Grill, briefly.** A small lap is a short grilling: a few questions, one at a time, each with your recommended answer attached. Prune and promote `## Later laps` entries with the human as part of that conversation — what the drive taught is usually what decides which deferred scope this lap picks up and which stays parked.
5. **Amend the docs.** Append this lap's learning to `docs/features/<slug>/decisions.md` under a `## Lap <n>` heading (the convention) — never rewrite old decisions, supersede them. Then amend `spec.md` in place: the sections this lap changes, plus the pruned `## Later laps`.
6. **Emit this lap's tickets, dispositioning the defects as you do.** `mcp__runcastle__emit_tickets({ tickets })` — only the work this lap will burn; the rest stays in `## Later laps`. Every ticket that answers a bug the human reported obeys **Stand on the failure** below. Reconcile stale pending tickets with `update_ticket` / `cancel_ticket`; `done` work that is now wrong gets a NEW ticket, as always.

   The defects an **earlier** lap's review left open arrive in your context as `openDefects` (`carriedDefects` are the ones a lap already parked — agenda, not obligation). Each open one needs exactly one of three answers. Nothing refuses over the ones you leave: `complete_phase({ phase: "tickets" })` names them back at you as a warning and the human reads the same list in the Burn dialog, so finishing this triage is yours, not a gate's:

   - **Link** — this lap is carding the work that fixes it: emit that ticket with `originFindingId: "<the defect's id>"`. Nothing else to do; the burn closes the finding itself when the ticket lands.
   - **Carry** — nobody is answering it this lap: `mcp__runcastle__resolve_finding({ findingId, disposition: "carry" })`. It leaves the open count, stays visible, and only the human reopens it.
   - **Close as addressed** — this lap's work already answers it and no ticket names it: `mcp__runcastle__resolve_finding({ findingId, disposition: "addressed", note: "<what addressed it>" })`. The note is required and is your attestation, so make it specific ("lap 2's ticket 7 rewrote the endpoint").

   Judge each against what you and the human just settled — you are the only party that knows whether this lap's tickets touch a defect, which is why this is yours and not a dialog. If one genuinely is not this lap's business, carry it; do not close what you have not established.
7. **Report the planning steps.** `mcp__runcastle__complete_phase` through `ideation` → `spec` → `tickets`, here, without opening another session. They are three steps inside Planning, not three gates: each records a milestone on the timeline and moves the feature nowhere. The `tickets` call comes back `ok: true` with `waitingOn: "human burn"` and a `warnings` array — the lap waits on the human's Burn click, which is the point. Whatever is in `warnings` is what they will read in the Burn dialog (un-dispositioned defects from move 6, no review ticket in the batch, no `spec.md` on disk): fix what you can while you are still the session that can, and call again.
8. **Hand to Burn.** Tell the human in a line or two what this lap does, then:

   > Lap `<n>` is specced and carded. Review the ticket cards and click **Burn** — I'll stop here.

If this lap turns out to be genuinely big — whole branches of design reopened, decisions hanging on material nobody has read — say so and escalate the way ideation would (`/runcastle:ideate` §3, the map), rather than grinding it out here.

### Stand on the failure

Every bug the human reports gets exactly one of three answers before you card a fix for it:

- **Reproduced** — you drove it and saw the failure. Say what you did and what happened.
- **Traced** — you found it in the code. Name the file and line, and what there is wrong.
- **Unreproduced** — you could not do either. Say so plainly, and then make reproducing it the **first** acceptance criterion of the ticket that fixes it, so the burner stands on the failure before it changes anything.

Never card a fix for a failure nobody has stood on: a ticket written from a one-line report and a guess sends an agent to change the code it guessed at, and the next drive hits the same bug. This is what the human's report buys — it is the report, not a diagnosis.

## Do NOT

- **Never call `complete_phase` in an ordinary revisit.** It has no planning steps of its own to report; the human drives the pipeline from the UI. **Lap mode is the one exception** — reporting ideation → spec → tickets is its job (move 7), and nothing else here licenses it.
- **Never resolve or reopen waypoints.** If a resolved waypoint's answer is now wrong, record the superseding decision in `decisions.md` — the map's history stays intact.
- **Code changes ride tickets** — the burner (or a human) implements them, never this session. (The no-code rule itself is in your injected prompt and enforced by the edit guard.)

## Scope check

If what the human brings is not an amendment but a whole new capability, say so — and park it rather than losing it:

> That reads like a new feature, not a revision of this one. I'll park it as a draft so it isn't lost; you can start it from the runcastle UI when you want it, and it gets grilled there.

`mcp__runcastle__create_feature({ title, oneLiner, brief, draft: true })` — a parked draft, no branch cut and nothing written, with the `brief` carrying why you deferred it and what it must not swallow. `draft: true` is the only door open to you; a full create belongs to the project session.
