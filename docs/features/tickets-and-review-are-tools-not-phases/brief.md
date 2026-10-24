# Brief

## Why this feature exists

The human, 2026-10-24, after the quick change "Make the sidebar grain visible": its chat (in design mode) made the whole change itself, live, on the design server. Then it told the human to press **Go** with no tickets, because Go is the only way to get a review. The human looked for a tickets page in the right panel and found none, and could not see a Go button. Their words: "I want these tickets to just be a tool that the agent can use. Not a mandatory phase. Same with the review agent. The agent can decide to create tickets but no review ticket if it thinks it's not needed. Also, I don't see the point of the 'Go' button. We can just make the agent start a round. It will ask the user first of course." They also want the agent, when it adds tickets, to switch the right panel to show them, opening the panel if it is closed.

The aim behind it is to ship faster and better than any other tool by taking out structure that makes the human push a feature through stages. The plan → tickets → review order survives as **good practice in the agent's instructions**, not as machinery.

## What the project session established

What Go does today. Each of these needs a replacement, or deliberate removal:
1. **Records the human's approval of the plan.** Replacement: the agent asks in chat, and the human says yes.
2. **Turns the planning chat into the lead.** It is already the same session; the role split goes.
3. **Unlocks rounds.** `dispatch_round` is lead-only and only exists after Go. Rounds must be available whenever the human has said yes, including while they are away afterwards (the lead's headless wakes).
4. **Moves the feature from planning to building** in the sidebar and status line. Replacement: status comes from what is happening — roughly talking, working (a round is running), waiting on you (a question or "ready"), shipped. Merge stays the one transition the human makes, and it is already reachable from every state.

Already there, so smaller than it looks:
- `show_panel` (packages/server/src/mcp/server.ts, around line 3736) already opens the panel beside the chat, including a `body` view (the current tickets, runs or review). Check why the tickets view was not offered to the human on the grain feature: the panel probably keys off the phase.
- `planFinished` (packages/core/src/pipeline.ts) already says "a finished plan with no tickets is one the lead builds itself".
- `declare_ready` only *warns* when nothing reviewed the work since the last change (packages/server/src/services/features.ts, around line 1158).
- Design mode already lets a human-attended chat write code and install in every state (`docs/features/design-mode/decisions.md` #2 and the side-session decision at line 119).

Machinery that forces structure today and has to change:
- Quick changes always get a review ticket appended (`quickReviewTicket`, features.ts around line 384). The agent decides instead.
- The tickets skill and the lead skill assume a review ticket closes every batch.
- Go's gate (`PLAN_UNFINISHED`, `UNCOMMITTED_DESIGN` in pipeline.ts), the next-step bar's Go, and the orchestrator's `go_feature` tool.

## Suggested by the project session, for this feature to decide

- **A cheap automatic floor under quality.** The agent decides whether a review agent is worth it. But it always runs the project's own verify commands (typecheck and tests) before saying "ready", and tells the human whether a review ran and why not. Agreed in direction; the exact form belongs to this feature.
- **Approval when the human is not in the chat.** A feature that planned itself while the human was away shows its question under Needs you. The human answers in its chat, or tells the orchestrator to start it. No button.
- **The human prefers general instructions over task-specific rules.** Write the agent's guidance as judgement the agent can apply to any task, not as "when X, do Y" recipes.

## Open

- What the derived statuses are exactly, and how the sidebar groups features by them.
- What happens to the planning → building → review → shipped pipeline data (`PIPELINE` in pipeline.ts), the gates, and features already past Go when this lands.
- Whether the ideation and lead skills merge into one, or stay as two texts for one role.

## Must not swallow

- **The orchestrator.** Removing the Orchestrator setting and the ownership marker is the sibling feature *One orchestrator, no mode*. This feature only retires `go_feature`'s reason to exist; leave the orchestrator's other tools and its skill text to that feature, beyond what removing Go strictly requires.
- **Designs made while the human is away.** That is *Designs wait for you*.
- **Review's own drive.** The in-flight feature *Review hands you a running drive with what it saw* keeps review's running app up and hands it to the human as the test drive. It edits the same review code (`packages/server/src/workflows/review-ticket.ts`). The intents don't clash: review becomes optional, and when it runs it still hands over its drive. Whichever lands second adjusts; read its branch before touching review.

## Ordering

First of a three-feature cut made in the project session on 2026-10-24. *One orchestrator, no mode* and *Designs wait for you* both wait on this one: they talk to the kind of feature agent this one creates.

## Charter

This overturns three of the charter's locked decisions (CONTEXT.md #7 phases, #8 enforced gates, #9 "two clicks"). The project session writes the ADR and rewrites the charter when this ships, so the charter keeps describing the present. Record the decisions clearly in decisions.md so that ADR can be written from them.
