# One chat per feature

## Problem

The human's conversation with the agent is scattered across door-specific session kinds and forbidden in exactly the states where it is most wanted. During a burn every terminal is refused because the run holds the feature branch — the worst hour of the 2026-09-14 post-mortem was waiting on a dead run with nothing to talk to. The review page has no session door at all; asking a question from review meant clicking Rethink, which bumped the lap and threw the feature back to ideation. On Shipped only a read-only `qa` kind exists. Meanwhile resume is already kind-blind under the hood, so "one continuous conversation" is half-built: the pieces exist, but the human sees three differently-named doors and two states with no door.

## Approach

From the user's perspective: every feature has **one chat** — one conversation, resumed by a single, constant **"Chat"** action visible in all four states (Planning, Building, Review, Shipped), including while a burn is running and on the review page. It knows the feature's full current state, answers questions, records notes, and edits tickets for the next burn. Opening it never changes phase, never bumps the lap; Rethink is gone. Burn and Merge remain the human's clicks.

The shape:

**One kind.** `ideation`, `revisit`, and `qa` collapse into a single session kind `chat` (decision 3). `waypoint`, `converge`, `prepare`, `project`, and `drive-fix` are untouched; the map stays its own mode. A one-time DB migration rewrites existing session rows of the three collapsed kinds to `chat` (decision 5) — no legacy aliases; the newest migrated row's transcript becomes the seed of the feature's one chat. The shipped body's Q&A panel filter follows the rename.

**One transcript, unconditional resume.** Every door resumes the most recent `chat` session. The `chat` kind skips the resume-cap check entirely — no byte cap, no re-entry cap (decision 4); Claude Code's own auto-compact manages the window, and the docs on disk plus the kickoff carry the record. The cap machinery survives unchanged for the kinds that keep it. Kickoff overrides ride the resume (decision 13): resolveConflict, stopDriveAndIterate and lap briefings are delivered into the resumed transcript, never a reason to discard it, and every resume re-delivers the fresh feature-state header. Clicking Chat while a chat is already live returns you to the live conversation — the one-live-session guard prevents a second spawn without presenting as an error (decision 12). Briefing delivery to a live chat is observable (decision 15): the terminal write returns success or failure, `session.kickoff` is emitted only after a successful write, and a live DB row with no PTY behind it is a reported failure, never a silent drop of the override.

**Coexistence with a burn** (decisions 2, 9). Outside a burn the chat lives in the talk worktree checked out to the feature branch, committing docs directly — unchanged. During a branch-claiming run the same worktree sits on a temp chat branch forked from the feature tip instead of detached HEAD; each docs commit lands promptly through the landing queue, which is **promoted from per-run to per-feature** so chat landings serialize with ticket landings (ADR-0002's queue, wider scope). At the boundaries: Burn clicked under a live chat switches the worktree to a fresh chat branch in place (files unmoved, session unaffected); run end lands any unlanded chat commits as the last landing and checks the worktree back out to the feature branch. An empty chat branch is deleted; the boot sweep's merged/unmerged rule covers crashes. The spawn guard splits: "one live HITL session per feature" stays; "refuse terminals while a run claims the branch" is deleted.

**State knowledge** (decision 7). The kickoff is a short header — state, lap, ticket counts by status, latest run status, and in Review the drive outcome named with a pointer to the evidence — ending with "call `get_feature_context` for the full picture." `get_feature_context` grows the missing state: a latest-run summary (status, tickets landed/failed, error headlines), the review outcome and findings, and test notes. No per-state kickoff variants beyond the header's wording; no delta digest.

**MCP policy** (decision 3). `chat` registers one toolset regardless of state — the union of today's ideation/revisit registration. The qa read-only contract dies with the kind. Per-state rules live at call time, deliberately few: ticket writes refuse a ticket claimed by an active run (the chat edits the next burn's work, never the live one's); `complete_phase` stays gated by the gates. On Shipped, a ticket write is drafting the next lap.

**Burn agents stay headless** (decision 6). No channel to the chat in either direction; the run's events and ticket updates are their voice.

**UI** (decisions 8, 16). One action kind `chat` replaces `startGrill`, `askQuestions`, and `revisit` in the next-step vocabulary. It is a constant secondary on the bar in all four states — same position, one-word label "Chat" — promoted to primary only where talking is genuinely the next step (planning with nothing live). During a burn the bar keeps "Cancel run" primary and gains Chat. On Review, Chat sits beside the trail's actions without touching them. `resolveConflict` and `stopDriveAndIterate` survive as roads launching `chat` with their kickoff overrides. As of lap 3 the door toggles an **inline panel docked beside the feature body** (decision 16): the body keeps doing its phase job while the panel sits to its right in all four states, reusing the existing transcript rendering — compact header, roled transcript, composer — collapsible, and inert when collapsed. Prototypes of the three candidate placements live at `docs/features/one-chat-per-feature/prototypes/chat-placement/`.

## Seams

- **`get_feature_context` (MCP, existing, extended).** Observe the fattened payload: latest-run summary, review outcome and findings, test notes, in every state.
- **Session launch (tRPC `launchSession` → `assertSpawnable`, existing, behavior change).** Observe: a `chat` session spawns in all four states, spawns during a running burn, still refuses a second live session, and always resumes the newest `chat` transcript with no cap check.
- **The landing queue (existing, scope widened to per-feature).** Observe: a chat docs commit made mid-burn lands on the feature branch serialized between ticket landings; at run end the worktree is back on the feature branch with all chat commits present.
- **Next-step resolvers (existing pure functions, per state).** Observe: every state's bar carries the Chat action; the collapsed action kinds are gone from the vocabulary; the dispatch test names any unanswered kind.
- **MCP audience table (`registeredFor`, existing pure function).** Observe: `chat`'s tool list is the settled union; the three collapsed kinds are gone.
- **DB migration (existing drizzle migration seam, new migration).** Observe: after migrate, no session row carries `ideation`/`revisit`/`qa`; schema parse of every row succeeds.
- **Call-time ticket guard (MCP tool handlers, new check at an existing boundary).** Observe: `update_ticket`/`cancel_ticket` on a run-claimed ticket refuse with a legible error; the same call on an unclaimed ticket succeeds mid-burn.

## Out of scope

- The state model and the gates ("Four states and two hard rules" owns them).
- The review page's trail, unverified outcome, and agentic-review button ("Review as a lap trail" owns them); this feature only places the Chat door on that page.
- Kickoff delivery mechanics and the Codex resume lifecycle (the two prerequisite features own them; this feature consumes them).
- The map: waypoint and converge sessions stay as ADR-0001 defines them.
- Any summarization/compaction machinery for long transcripts.
- Any channel between burn agents and the chat.

## Lap 2 scope

A pure fix lap (decision 10): the lap-1 review's 11 open defects, consolidated to eight work items — the broken test suite and lost transcript-marker producer, the resume/override/header semantics (decision 13), the Chat door's live-chat behavior (decision 12), the review kickoff's real drive outcome, `stepModels` read-compat (decision 11), the missing `chat-branch.ts` event emissions, and the dead qa leftovers in the MCP server. Nothing promoted from `## Later laps`.

## Lap 3 scope

No test drive preceded this lap. Two work items (decision 14): the delivery-observability fix for lap 2's open defect (`finding_8EGyEYX6ye8B`, decision 15), and the inline chat panel promoted from `## Later laps` (decision 16). The rollover deferral is closed as a permanent no — unconditional resume plus auto-compact is the final answer (decisions 4, 14).

## Open questions

None blocking. The prerequisite features (`native-first-message-delivery-for-session-kickoffs`, the Codex resume-lifecycle fix) are in flight; tickets that depend on reliable kickoff delivery and resume land after they do.

## Later laps

Nothing parked. Both lap-1 deferrals were settled in lap 3: UI placement became the inline panel (decision 16), and the richer-rollover question was closed as a permanent no (decision 14).
