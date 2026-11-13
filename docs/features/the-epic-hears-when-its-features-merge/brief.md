# Purpose

The human asked (2026-11-11): "Maybe a feature merging should always notify the orchestrator. I want to make sure that the dynamic between the feature agents and the orchestrator makes sense. The orchestrator should literally orchestrate the tasks and make sure things integrate well and are implemented smoothly."

Today the epic hears nothing about a feature it does not own, merges included. That was decided on purpose in `agents-are-woken-only-when-it-matters` (decision 23: the human's own merges tell the orchestrator nothing), after the orchestrator was pinged about fifteen times during one grill. The sibling "One place to answer" makes most features the human's, so without this the epic would go blind on its own cut: it could not check that merged pieces fit together, or warn a feature still in progress that something under it changed.

## Decided with the human

1. **A merge always tells the epic the feature came from**, whoever owns the feature and whoever merged it.
2. **It wakes that epic only while the epic has other unfinished features.** With none, there is nothing to check and no turn is spent.
3. **On that wake the epic checks the merged work fits with its siblings, and tells any sibling in progress what changed under it** (`send_to_feature`, marked as the orchestrator's). **It speaks to the human only if it found a problem.**
4. This knowingly reverses part of decision 23 of `agents-are-woken-only-when-it-matters` for merges only. The accepted cost is one orchestrator turn per such merge. A merge happens once per feature, so it is not the noise that decision removed.

# Must not swallow

- Any other news line. Rounds, reviews, planning runs, waits, drives and takes stay as `agents-are-woken-only-when-it-matters` left them; charter decision 17 (agents talk by tool call, machine events go only to the agent that owns the work) stands, with this one named exception.
- Ownership and where the human answers: "One place to answer".
- The epic asking the human anything about a feature it does not own. It reports a problem; it does not open a question on that feature.

# Understood

- "The epic a feature came from" must be distinct from "the owner". "One place to answer" merges first and keeps that distinction; build on what it left.
- When the line does not wake (no unfinished siblings), it can simply not be sent, or be logged in the chat without a turn; that is a how-it-is-built choice.
- The project skill's "Messages from runcastle" section lists the `[runcastle]` lines the orchestrator gets and what to do on each; this adds one, with the guidance in decision 3.
- A feature with no epic (created from the app's own button) has nobody to tell.

# Open

- What counts as "unfinished" for the wake test: started features only, or backlog drafts of that epic too. Recommend started features plus up-next drafts waiting on the merged one (those start themselves and already wake the epic).
- Whether an oversized or long-idle epic chat is woken, given `agents-are-woken-only-when-it-matters` decision 7 (news never restarts an oversized orchestrator chat).

# Ordering

Third of three from the epic "Agent Behaviour Tuning". Waits on "One place to answer".

Planning mode: plans itself
