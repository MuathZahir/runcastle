# Tickets and review are tools, not phases

## Problem

Runcastle makes the human push every feature through stages. A feature sits in a stored phase (planning → building → review → shipped). Go is the only door from planning to building. Go is also what turns the planning chat into "the lead", the only role allowed to start rounds. Every batch of tickets must end with a review ticket. A drive-and-fix cycle opens a new lap.

The stages get in the way. On the quick change "Make the sidebar grain visible", the chat did the whole change itself, live in design mode. It then had to tell the human to press Go with no tickets, because Go was the only road to a review. The human looked for a tickets page in the panel and found none: the panel's main view switches to tickets only when a non-review ticket exists. They could not find Go either.

The human wants one agent with tools and judgement, and nothing between them and the work but a yes in chat. That agent edits code, makes tickets, starts rounds, runs a review when it is worth it, and opens panels. The flow is: talk, the agent builds (itself or through rounds), the human test-drives, tells the agent what is wrong, the agent fixes it (itself or with more tickets), Merge. The order plan → tickets → review survives as good practice in the agent's instructions, not as machinery.

## Approach

### What the human sees

- **One agent, the lead from its first message** (decisions 4, 13). Every chat on a feature gets the same brief and the same skill, attended or headless, before or after any round. Feature sessions run without permission prompts, self-planning runs included.
- **No Go** (decisions 3, 12). The agent asks "Start round 1?" in chat and starts it after the human's explicit yes. It asks again before any round the agreed plan did not settle. Only the instructions enforce this. The server's existing refusals stay: a round already running, a drive in progress, and after Stop until the human replies.
- **Status from facts** (decisions 2, 7). The sidebar lanes stay: Needs you, Agent working, In progress, Backlog, Shipped.
  - **Needs you**: the chat is waiting for the human's input, or the feature has a waiting reason. A waiting reason is set by `wait_for_you`, by Stop, by a provider halt, or now by `declare_ready` ("ready to test"). It clears on the human's next message or the next round.
  - "Needs planning", "ready to Go" and "a ticket failed" are no longer reasons.
  - The feature page's status line keeps its fact-based words: "Working · Round N", "Waiting for you · <why>", "Ready for you · Test drive ▸ <scenario>", "Merged". "Planning with you" becomes "Talking with you", for a feature with nothing running and nothing asked.
  - The state line injected into chats uses the same words instead of `phase=`.
- **The panel** (decision 8) holds four fixed views, each offered once it has content:
  - **Plan**: the plan preview, with decisions and spec reachable inside it.
  - **Work**: every ticket, review tickets included, grouped by the round that ran it, with live status. A running ticket opens its live log, folding in today's Run view.
  - **Review**: ready declarations, the review's findings and evidence, and what shipped once merged, folding in today's Outcome view.
  - **Details**: timeline, docs, sessions.

  **Design** and **Drive** appear only while running. The view picker shows each view's icon. `show_panel` opens any view by name. `emit_tickets` opens Work itself, opening the panel if it is closed. The design for all of this is committed (`design: feature page with fixed panel views and a progress glyph`): the view names, labels and icons in the panel module, and a preview page at `/preview/feature-page.html`.
- **The feature glyph** (decision 9) beside a title, in the page header and on sidebar rows, is `ProgressIcon`. Its pie is the share of the feature's non-cancelled tickets that landed. It is a dashed ring for a draft and a filled check once shipped. It replaces `PhaseIcon` for features.
- **Ready** (decision 6). Before declaring ready, the agent always runs the project's checks (typecheck and tests). Its chat message says what to test and how the work was checked. `declare_ready` takes only the scenario the Test drive button starts. The "What to test" notice above the chat goes, and the review history shows the scenario alone. Review is optional:
  - no review ticket is appended anywhere;
  - no batch is required to have one;
  - the "nothing has reviewed the work since the last change" warning goes;
  - the "last round had failures" warning stays.
- **Driving and notes** (decisions 11, 12). Notes with screenshots jotted during a drive, and "Send to agent", stay: the notes reach the chat as one message. Gone: marking notes done or open, promoting a note to a ticket, carrying, triage, and the generated `test-notes.md`.

### What goes

- **The stored phase** (decision 2). Drop the feature's `phase` column, `PIPELINE`, `nextPhase`/`isPastPhase`, the planning steps (`completedPlanningSteps`, `nextPlanningStep`, `planFinished`) and the `Phase` type. A feature's `status` (draft, active, shipped, archived) is the only stored lifecycle; merge sets it to shipped. Rewrite every reader of the phase to ask about the fact it cares about:
  - is it shipped or a draft;
  - is a round running;
  - is the human driving;
  - is there a waiting reason;
  - is the chat live.
- **Laps** (decision 11):
  - the feature's `lap` and `ticketsReadyLap`;
  - the `lap` on tickets, sessions and events;
  - the `lap`/`carriedLap` on findings and test notes;
  - lap-scoped tallies, carried defects, `carryPendingTicketsIntoLap`, lap grouping in the timeline and in review evidence, the feature context's `lap`/`ticketsNotInlined`/`carriedDefects`/`testNotes`/`reviewEvidence`-of-the-previous-lap fields.

  Tickets accumulate on the feature. A review finding stays open until the agent resolves it (addressed or dismissed). One migration drops the columns.
- **Go and the human's hand on the machinery** (decision 12):
  - `go()` and `feature.go`/`feature.goWarnings`, plus `GoFeatureDialog`, `GoAction` and the status line's go/goGated/goBlocked primaries;
  - `PLAN_UNFINISHED`, `UNCOMMITTED_DESIGN` and the uncommitted-design check;
  - the human `feature.burn` door and the burn warnings;
  - `agenticReview`;
  - the orchestrator's `go_feature`;
  - `complete_phase` and its warnings;
  - the next-step bar's per-phase resolvers, the phase stepper, pinned past-phase views (`PinnedBody`, `ReadonlyBanner`) and the panel's phase-keyed `body`.

  The burn engine stays: `dispatch_round` runs rounds through it, and the engine's own retries and restarts keep working.
- **Quick changes** (decision 10): `quickChange`, `quickReviewTicket`, `feature.quickChange`, and `create_feature`'s `tickets` parameter. A feature is created with a title, a one-liner and a brief, nothing more.
- **Role split** (decisions 4, 13):
  - `chatOpening`'s ideate/revisit/lead split and the separate lead, revisit and ideation briefs;
  - the Go wake text ("you are now this feature's lead");
  - `isUnguardedLead`'s phase test;
  - the self-plan run's docs-only edit lock.

  Every feature chat launches with the same brief and kickoff, in the permission mode the lead has today. Relays, merge conflicts and chats on a shipped feature are situations that one brief names, not separate briefs.

### The skill

One entry skill for the feature lead (decision 4), written as judgement the agent applies to any task, not as recipes:

- grill when the intent is unclear, and record decisions in `decisions.md` as they settle;
- write `spec.md` once the feature is concrete (decision 5), whether or not tickets follow;
- do small work directly, and write tickets when work is worth handing to workers;
- draw the preview and get the human's yes;
- run rounds;
- review when it is worth it;
- run the project's checks;
- tell the human in chat what to test and how the work was checked;
- fix what they report, itself or with tickets.

It commits its own docs like any other change. The detail of today's ideate, spec, tickets, lead and revisit skills moves into reference files inside it, read when needed:

- grilling;
- the spec;
- writing tickets, minus the mandatory review ticket, laps and Go;
- running rounds;
- planning with no human present: ends by asking for the yes with `wait_for_you`, plans and does not build;
- the preview;
- design: the design skill's text, minus "Go waits".

The ideate, lead, spec, tickets and revisit skills are deleted. The code-review skill stays separate, for review agents. The project skill's mentions of Go, `go_feature` and quick changes are rewritten, and only those. The other session kinds (qa, prepare, project) are otherwise untouched.

The pack's settings that deny other sessions' entry skills are updated to the new skill set.

### Interactions worth pinning

- `dispatch_round` refuses only for real reasons:
  - a draft or a shipped feature;
  - a round already running;
  - a drive in progress;
  - stopped and not yet replied to;
  - a blocker outside the round.

  It never refuses for phase or for the absence of a human message.
- `declare_ready({ scenario })` records the declaration and sets the waiting reason to "ready to test". The next human message (`markHumanMessage`) or the next dispatch clears it, as for any waiting reason.
- `emit_tickets` emits `panel.show { view: 'work' }` after storing, the same event `show_panel` emits, so the web opens Work as the agent's act.
- Headless wakes (`deliverToLead`, `wakeLeadHeadless`) are unchanged. They never read the phase, and the single brief replaces the "lead" brief they relied on.
- The orchestrator's `send_to_feature` today relays instead of delivering when a feature is in planning. With no planning it always delivers to the feature's lead. That is the minimum this feature changes in the orchestrator.

## Seams

- **The status helper (existing, reshaped).** The web's `featureStatus` (status line) and `needsMe`/`triageOf` (sidebar lanes) are pure functions over the feature row, rounds, declarations and session state. Testing them over fact combinations shows every status and lane, with no phase in the input.
- **The panel module (existing, extended by design).** `availableViews` and `panelShowRequest` are pure. Given a feature's facts, they say which of Plan, Work, Review, Details, Design and Drive are on offer and what a `panel.show` opens.
- **The MCP tools (existing).** `dispatch_round`, `declare_ready`, `emit_tickets`, `create_feature`, `show_panel` and `wait_for_you`, called through the MCP server's in-process test harness. They show refusals, the waiting reason, the `panel.show` event, and the absence of retired tools (`complete_phase`, `go_feature`) and parameters (`tickets`).
- **The launcher's prompt renderers (existing).** `renderSystemPrompt` and the kickoff text for each session purpose (attended, headless wake, self-plan, relay, conflict, shipped). One brief, one skill, no phase, and the permission mode at launch.
- **The tRPC feature router (existing).** `feature.get` and `feature.list` carry no phase or lap. `go`, `goWarnings`, `burn`, `agenticReview` and `quickChange` are gone.
- **The skill pack (existing).** The pack's own content tests, and a grep that no remaining skill text names Go, laps, phases, `complete_phase` or a mandatory review ticket.

## Out of scope

- The Orchestrator setting and the ownership marker. They belong to *One orchestrator, no mode*, beyond removing `go_feature` and the planning relay.
- Designs made while the human is away belong to *Designs wait for you*.
- Review handing its running drive to the human belongs to *Review hands you a running drive*. Whichever lands second adjusts `review-ticket.ts`.
- Rewriting CONTEXT.md and writing the ADR is the project session's job once this ships. The charter decisions overturned are #7 (phases), #8 (enforced gates), #9 (two clicks) and #15 (laps).
- Migrating features already in flight: status is read off facts, and dropping the columns is the only data change.

## Open questions

- Two things settle when the files move: the new skill's name, and which existing qa/project texts reference the deleted skills by path. Whoever writes it picks a name in the pack's vocabulary (for example `feature`) and fixes every reference.
