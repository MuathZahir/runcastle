# Brief

## Why this feature exists

The human wants runcastle to feel like the Claude Code desktop app, where "an agent can just cut a feature into multiple agents that work on it and they return. Then the agent can create another round of agents, etc.", and said: "I don't really like the concept of laps."

Most lap machinery is already gone: "Four states and two hard rules" made a lap one burn plus its review. What remains rigid is a split between the agent you talk to and the machine that does the work:
- The feature chat can plan and edit tickets but **cannot start a burn** (`one-chat-per-feature` decision 3).
- Burn agents have **no channel back** (decision 6).

So the human is the relay: chat → tickets → click Burn → a fixed list runs → review → read results → back to the chat. Every loop crosses the human twice. Data from the 2026-10-17 project session: burn time is a small share of a feature's lead time. **The human is the bottleneck.**

Prototype: https://claude.ai/artifact/Cm8LdNz97tiZiweJ9qzoLf (the human's, private; the Coupons feature page shows the lead, rounds, the autonomy switch and the budget). The human: "This is much better."

## Settled in the project session

1. **The feature chat is the feature's lead.**
   - It plans with the human, or plans itself through the shipped self-planning run from "Whole cuts plan themselves".
   - It shows the preview and waits for **Go**.
   - Then it dispatches rounds.
2. **A round is a burn run the lead dispatches.**
   - The engine is unchanged: sandboxes, serialized landings (ADR-0002), digests, gates.
   - The lead **wakes when a round returns**, reads the digests, checks the work, then either fixes small things or plans the next round. Rounds adapt to what came back, unlike a fixed list.
   - It ends with "Ready for you: Test drive ▸ <scenario>".
3. **Laps disappear from the human's view.**
   - There is no Iterate button and no lap session. Drive notes go into the same chat, and more rounds follow.
   - A round counter remains as history, derived from runs as the lap counter is today.
4. **Two human checkpoints remain: the plan (Go) and the drive. Merge stays a human click.**
5. **Autonomy switch:** "Run until ready for me" or "Ask before each round".
   - It comes with a **budget** of rounds and tokens.
   - Recommendation from the prototype review: a project-wide default with a per-feature override.
   - The default depends on how well plans hold up. See the open question below.
6. **No agent-to-agent messaging. Coordination is a star with one owner.**
   - Workers report through their digests.
   - A worker that finds the contract wrong stops and reports.
   - The lead reconciles contracts and decisions between rounds. Each round is a sync point.
7. **Contract first when work spans layers.** The first worker lands the types, stubs or API contract in code; the others build against it in parallel in the same round. Contracts live in code, never in a separate document.
8. **Rules for the lead,** adapted from Nimbalyst's Meta Agent:
   - it only delegates;
   - every worker task names its deliverable and how it will be checked;
   - it trusts the record over the prose;
   - the number of workers per round is capped;
   - workers are titled "{group}: {task}".
9. **Absorbed from the shipped "Whole cuts plan themselves", whose parked list is otherwise closed:**
   - item 3, *send a run back to work* (runcastle answering the turn-end hook): the same mechanism as the lead waking;
   - item 7, *a time limit on a run*: part of the budget;
   - item 5, *self-planning a lap planned from review*: **dropped**, because laps disappear.
   - Items 4 and 6 stay with the draft `self-planning-polish`.

## What this feature must decide in its own session

- **The default autonomy.** "Whole cuts plan themselves" existed to measure how many of a self-made plan's decisions the human would overturn, and that count was never reported. **Ask the human for it first.** Few overturns means "Run until ready for me" by default; many means "Ask before each round" until plans prove themselves.
- **Whether the lead edits code directly between rounds for tiny fixes,** as the desktop agent does. Recommendation: yes, landing through the same queue.
- **How the lead is woken:** the turn-end hook, a server-side continuation at run end, or both, on Claude Code and Codex.
- **The lead's MCP surface:** dispatching a round, reading digests, and the budget.
- **Budget accounting.** Runcastle records no token or cost telemetry today; ticket timing has wall time and categories only (ADR-0008).
- **Stopping and runaway behaviour:** what the lead does at budget exhaustion, on a failed round, or on a provider limit. The draft "Auto-continue burns after provider limit reset" is adjacent.

## What this feature must NOT swallow

- **Before/after captures in the round check.** The draft "Round effects" owns them; this feature reports gates and digests only.
- **The map and the sidebar.** The draft "The map" owns them.
- **Burn engine internals.** Consume them, do not redesign them.
- **Merging, or starting drafts, without the human.**

## Decisions this overturns, recorded by the project session afterwards

- `one-chat-per-feature` decision 3 (the chat cannot start a burn), and what is left of ADR-0010 (laps).
- Charter decisions 9 (approvals) and 15 (laps).

Once this feature's `decisions.md` exists, the project session writes the ADR and amends `CONTEXT.md`. Feature sessions cannot.

## Already settled elsewhere, still binding

- ADR-0002 (serialized landings), ADR-0007 (landing conflicts resolved in-loop) and ADR-0013 (merge-order dependencies).
- `four-states-and-two-hard-rules`: two hard refusals; gates guide and never imprison.
- `one-chat-per-feature` decisions 2, 4 and 9: the chat worktree during a burn, unconditional resume, the worktree handoff at burn boundaries.
