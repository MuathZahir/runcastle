# Brief

## Why this feature exists

In the 2026-09-14 post-mortem the human's worst hour was waiting on a dead session with nothing to talk to, and the recurring complaint was "I want to ask the agent something but I'm in review". Today the chat exists only in the planning phases plus a revisit door at idle implementation. During a burn every terminal is refused because the run holds the feature branch (`packages/server/src/launcher/launcher.ts:221-234`); the bar shows one button, Cancel run (`apps/web/src/lib/feature-ui/next-step/implementation.ts:24-33`). The review page has no session door at all: `review-arrival-is-legible` decision 5 dropped its terminal band, and `resolveReview` emits no session action. The read-only `qa` kind is offered only on Shipped (`next-step/shipped.ts:10`). To talk to an agent from review the human had to click Rethink, which bumped the lap and moved the feature to ideation. Resume already ignores phase (`mostRecentResumableSession`, `launcher/sessions.ts:918`; revisit resumes kind-blind at `launcher.ts:450`), so "one continuous conversation" is half-built.

## Settled in the project session (2026-09-15)

1. **One chat per feature, one transcript, every door resumes it, available in all four states** (Planning, Building, Review, Shipped) as defined by the feature "Four states and two hard rules", which lands first.
2. **During Building the chat works in a docs-only worktree and cannot touch the feature branch while a burn holds it.** Its commits queue behind the burn's landings, riding the same serialized landing burns already use (ADR-0002), or land when the run finishes. It can read the run, record notes, answer questions, and draft or edit tickets for the next burn. It cannot start a burn or merge; those stay human clicks.
3. **It knows the full current state**: phase/state, lap, tickets by status, the latest run, review outcome and findings, test notes, the docs on disk. The kickoff and `get_feature_context` carry it; `review-arrival-is-legible` decision 7 (name the carried work in the kickoff) is the precedent to extend, not replace.
4. **It can edit tickets** (`update_ticket`, `cancel_ticket`, `emit_tickets` already exist for write kinds; extend rather than duplicate).
5. **The kinds ideation, revisit and qa collapse into it.** Waypoint and converge stay: the map is a mode with its own sessions. Prepare, project and drive-fix are untouched.
6. **In Review the same chat has the drive evidence injected.** "Iterate" means talking to it, not a phase jump. Rethink no longer exists.
7. **Placement in the UI is a design question for this feature's session**, explicitly: the operator wants it well placed and not cluttering the interface. Do not assume the old SessionPanel band; `review-arrival-is-legible` decision 5 records why it was dropped.

## Prerequisites, land first

- `native-first-message-delivery-for-session-kickoffs` (in flight): the kickoff line moves from PTY typing to the CLI's argv. A chat with long injected state depends on delivery being reliable. Audit rec 11 (a session that never goes live gets one `session.not_ready` event then silence, `sessions.ts:716`) belongs to that feature, not this one.
- `codex-interactive-sessions-sessionend-and-resume-lifecycle-is-borrowed-from-claude-code-and-wrong` (in flight): Codex rows ended per turn and resume targeting a wrong id. A chat that resumes one transcript across states needs resume to work.

## What this feature must decide in its own session

- The write policy per state in detail: what the chat may commit and when, and how a docs commit made during a burn is landed without racing the burn (ADR-0002 landing queue vs. defer-until-run-end).
- The one-terminal-per-feature rule (`launcher.ts:221`, duplicated at `features.ts:827`): it came from the docs-only worktree being a checkout of the feature branch. Decide whether the chat's worktree is that checkout or something that does not conflict with the burn's landings.
- Resume caps (`RESUME_MAX_TRANSCRIPT_BYTES`, `RESUME_MAX_REENTRIES`, `sessions.ts:1082`): a chat that lives for the whole feature will hit them. Decide what happens then.
- The MCP audience table (`packages/server/src/mcp/server.ts:1691`, `FEATURE_WRITE_KINDS` at `:1668`): what the single kind gets in each state.
- Migration of existing session rows and the `shippedQaSessions` filter (`apps/web/src/lib/feature-ui/session.ts:80`).
- Whether burn agents get any channel to the chat (today they are headless with no talk channel). Default answer: no; the run's events are the channel.

## What this feature must NOT swallow

- **The state model and the gates.** "Four states and two hard rules" owns them. This feature designs against four states and does not reopen them.
- **The review page's trail, the unverified outcome, the agentic-review button.** "Review as a lap trail" owns them; this feature decides only where the chat sits on that page.
- **Kickoff delivery mechanics and the Codex runtime adapter.** The two prerequisite features own them. Consume, do not redesign.
- **The map.** Waypoint and converge sessions are ADR-0001's and stay as they are.

## Already settled elsewhere, still binding

- ADR-0009: a briefing is delivered and confirmed, never assumed; the watchdog never types blind.
- ADR-0010 decision 5's spirit survives: one conversation per lap, two clicks. The "revisit kind reused" clause is superseded by the collapse above.
- `review-arrival-is-legible` decision 4: no disabled buttons because of a live session; compound "End session & verb" labels are the pattern if any action still needs the terminal gone.
- `flow-redesign-ideation-through-tickets` decision 13: End session has no confirm dialog; the conversation stays on disk.
