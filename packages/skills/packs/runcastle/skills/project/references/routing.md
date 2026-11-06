# Routing, portfolio Q&A and curation

Load this when something arrives that needs a destination, when the human asks
what the portfolio already holds, or when you notice something to curate (§2–4
of `/runcastle:project`).

## 2. Routing — five destinations, and that is the whole list

Anything that arrives (from the human, or from a sweep in §6) goes to exactly one of:

1. **A new feature** — it has real design questions, which its *own* grill session will work. `create_feature` with a brief.
2. **A small, concrete change** — work too small for a design conversation ("make this darker"; "expected X, got Y, repro like this"), though §1b's floor still applies. Still `create_feature({ title, oneLiner, brief })`, with a brief concrete enough that nothing is left to grill: what to change, and the repro or the expected/got for a bug. Its own agent reads the brief and the code, does a small change itself or writes tickets, and asks the human for the yes in its chat. **One feature per change, not per fix:** several small fixes that belong to the same change go in that one brief; creating one each would give you a feature each. **During notes triage that rule widens to one batched feature per triage session** — every small theme of the pass goes into that single brief (**Notes triage**).
3. **An existing feature's change** — it belongs to a feature already in flight. Once the human agrees that is where it goes, **send it to that feature's agent** with `send_to_feature`, carrying the reasoning, not a pointer to this chat. When the feature is busy (**Orchestrating**), wait, or give the human the line to say in its chat themselves.
4. **More rounds** — the feature is ready and the drive taught them it is not right yet. Send what is wrong to its agent with `send_to_feature`, or the human says so in that feature's chat or with **Send to agent** from the drive; its agent runs more rounds.
5. **Nothing** — it is already decided, already built, or not worth doing. Say so plainly, with the ADR or the shipped feature that settles it.

Say which destination and why. Do not invent a sixth.

## 3. Portfolio Q&A

"Have we already decided X?" "Did we ever build Y?" "Who has touched this area before?"

Answer from `get_project_context` + `read_adr` (the charter and the live ADRs bind you and bind everyone), `get_work_record` (facts: what a feature's tickets touched, what failed), and ordinary reads of `docs/features/<slug>/` on disk for the unabridged argument.

Cite the address you read — `docs/adr/0007-….md`, `docs/features/notes-inbox/decisions.md#3`, a commit sha. An answer with no address is a guess with a confident tone. If a live ADR settles it, say so and stop; that is the current answer regardless of what any feature's docs argued on the way there.

## 4. Curation — advisory only

You may notice, and you should say:

- **two in-flight features on a collision course** — this is the one you can actually check rather than guess at. The index gives each in-flight feature its slug; `get_work_record({ featureSlug })` gives you the *seams* its tickets name. Two in-flight features whose tickets name the same seam are heading for the same files, and the one that lands second eats the conflict. Name both slugs and say which should land first.
- an ADR that looks stale, or two that disagree (`read_adr` to confirm before you say so);
- a term used with two meanings across features;
- docs that no longer describe the code.

**You do not fix any of it.** Report it, then route it through §2 like anything else — a fix rides a feature, or promotion at merge. The value of noticing a collision is fully captured by *saying so*; acting on it is how this session would quietly become a project editor.

The one exception is the charter, which is yours (§5) — and even there, a change that overturns an ADR is a decision, and decisions land as ADRs.

