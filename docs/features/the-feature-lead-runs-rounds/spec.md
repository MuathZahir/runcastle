# The feature lead runs rounds

## Problem

The human is the relay. The feature chat can plan and edit tickets but cannot start a burn, and burn agents have no way back to it. So every loop crosses the human twice: chat → tickets → click Burn → a fixed list runs → review → triage → Iterate → a lap session plans → click Burn again. Burn time is a small share of a feature's lead time, and the human is the bottleneck. The lap vocabulary (Iterate, lap sessions, triage, "carried from lap N") adds concepts the human does not want, when the human wants runcastle to feel like the Claude Code desktop app: an agent cuts the work into workers, they come back, and it sends out the next round.

## Approach

### What the human sees

The feature's chat becomes **the agent** (internally, **the lead**). The human's whole model is: talk to the agent → see the plan (the preview) → **Go** → rounds run → **"Ready for you · Test drive ▸ <scenario>"** with a short paragraph on exactly what to test → drive, and send what they found to the agent → more rounds or **Merge**. Anything not in that story is removed or hidden (decision 17).

- **Go replaces Burn** (decision 8). It approves the plan, moves planning → building and hands the feature to the agent, which dispatches round 1 itself. The human never clicks Burn again. Go carries today's burn warnings but has **no "no tickets" refusal**: the agent may do a small feature itself without any (decision 5).
- **No autonomy switch** (lap 2, decision 23). The agent judges when to ask: it carries on through anything the plan settled (fix rounds, small fixes it does itself) and stops to ask before anything the plan did not settle (a design decision, a scope change, a trade-off the human would have an opinion on). There is **no budget** of any kind (decision 2).
- **One status line per feature** (decision 21), from a fixed set: *Planning with you* · *Working · Round N* · *Waiting for you · <why>* (plan ready for Go, a question for you, stopped, stuck, provider limit) · *Ready for you · Test drive ▸ <scenario>* · *Merged*. The four phases stay underneath as machine states, and the phase stepper is gone from the page.
- **The header is two lines and one action row** (lap 2, decision 24): the title; one meta line (branch · started); the status line with exactly one primary button chosen by state (Go in planning, Start test drive when ready, Stop drive while driving, Stop while a round runs), Merge always present as a secondary, the rest in "⋯", and "What to test" one click away when ready. Nothing else sits above the content: no autonomy switch, no "Agent live" row (the top bar's Agent tab carries the live dot; End session lives inside the Agent tab), no header Agent button, no Review/Tickets/Test drive/Round fact list. The walkthrough-videos warning shows only where a drive starts and only when it applies; "Notes for the agent" shows only while driving or after a ready declaration. No burn or lap wording anywhere the human reads.
- **A round trail replaces laps** (decision 16). Each run is a round, numbered per feature: what it dispatched (workers titled "{group}: {task}"), what landed, gate results and the agent's one-line verdict. The agent's own fixes appear on the trail as "agent fix" entries, and ready declarations as the points where the human was asked to drive. Pending tickets read "not yet dispatched". Gone: Iterate and "Start lap N+1", the start-lap session, the review triage step, lap chips, "Lap N in progress", "carried from lap N", lap grouping. Shipped features' history reads as rounds too.
- **Drive notes**: the drive panel's composer stays (screenshots paste in), headed "Notes for the agent", with a **Send to agent** button that sends every unsent note as one message, screenshots attached as files, usable any time and more than once (decision 18). Typing in the chat works too. While a drive of the feature is active, **no round can start and the agent's own commits wait to land** (decision 19).
- **Tokens are recorded, never shown** (lap 2, decision 25): no token figure in the header, on the trail, on a ticket, or in the lead's feature context.
- **Vocabulary** (decision 20): "agent" and "workers" in the UI. "Lead" is internal.

### The lead's loop

1. **Planning is unchanged.** The chat plans with the human through the ideate skill, or plans itself through the self-planning run. It is docs-only and ends in the preview, with *Waiting for you · plan ready for Go*.
2. **Go.** The feature moves to building and the lead is woken with "Go given". From here a new **lead skill** drives the session: it delegates by default but may edit code itself, at its own judgement (decisions 5 and 6), and it dispatches rounds.
3. **Dispatch.** The lead writes or updates tickets with the existing tools, then dispatches a round naming which pending tickets it covers. Under the hood that is today's run start with explicit ticket ids. The engine is unchanged: blockedBy ordering, serialized landings (ADR-0002), in-loop conflict resolution (ADR-0007), digests, burn concurrency as the parallel width. "Contract first" is one ticket the others are blocked by, inside the same round (decision 13).
4. **Round end.** The run finalizes **without auto-advancing** building → review (decision 9). The project's verify commands run against the branch tip at every round end (decision 10). Then runcastle **wakes the lead** with the round's outcome, per-ticket status, gate results and pointers to the digests.
5. **Check.** The lead reads the digests (trusting the record over the prose), then fixes small things itself, dispatches another round, asks the human, or declares ready. Before declaring ready, its skill tells it to run a round that includes a review ticket. A review agent's findings now go to the lead: the burner **stops auto-minting fix tickets mid-run**, and the lead decides what each finding becomes.
6. **Ready.** The lead declares ready with a scenario title and a what-to-test paragraph (what changed, where to look, what counts as broken). This moves building → review (and stays in review afterwards, since states only move forward) and puts the drive in front of the human. It is a declaration, never a gate: it returns warnings the lead must relay ("failures in the last round", "nothing has reviewed the work since the last change").
7. **After the drive**, the human's notes wake the lead, more rounds run in review, and the lead may declare ready again with a new scenario. Merge stays the human's click throughout.

### Waking the lead (decision 12)

- **The lead is live** (its terminal is open): the orchestrator's existing waiter is opened to feature leads. On Claude Code that is the rewake hook on SessionStart and Stop, long-polling the server. On Codex it is `codex queue` delivery. A wake that arrives mid-conversation waits until the lead's turn ends. The notifier that today routes `run.finished` to the project's orchestrate session also routes a feature's round end to **that feature's own lead**.
- **The lead is not live** (terminal closed, session died, server restarted): runcastle resumes the feature's chat **headless** (`claude -p --resume` / `codex exec resume`) with the wake message. Unconditional chat resume later reopens the same conversation. While a headless lead runs, a human opening the chat sees it working, as today's one-headless-chat-at-a-time rule implies.
- **A headless wake never loses its message** (lap 3, decision 28). It resumes a conversation only when that conversation's transcript still exists; otherwise it starts the agent fresh from the docs with the messages. If the launched process dies before the agent takes its turn, the messages go back on the queue, `lead.wake_failed` says why, and the next wake trigger retries them. "Sent to the agent" is shown only for a message an agent received or that is still queued for it.
- **No wake on a provider-limit halt.** The lead runs on the same provider. The status shows *Waiting for you · provider limit* and the human's next message picks it up.
- **Live proof required**: a real round returning and visibly waking a real lead, once on Claude Code and once on Codex, both live and headless. The waiter's proof was never shown in "Whole cuts plan themselves". Lap 1 proved the live Claude Code wake only; lap 2 stands on the headless wake and both Codex wakes first, then fixes what fails (decision 26).
- **Permissions after Go** (lap 2, decision 27): the feature's chat on Claude Code runs with `bypassPermissions` once Go is given (Codex's acceptEdits posture already never asks inside its workspace-write sandbox), so a headless wake never stalls on a prompt nobody can answer. Before Go it stays docs-only and asking. A guard hook that runs in every permission mode denies, with a reason: merging into or pushing to the base branch, git operations on the main checkout or on other features' worktrees, and deleting the feature branch.

### Stopping (decision 15)

- **Stop** (feature page) stops the running round (landed work stays), marks the feature stopped, and tells the lead it was stopped. The status reads *Waiting for you · stopped*.
- **After Stop, nothing dispatches until the human replies — enforced, not advised** (lap 2, decision 23): a dispatch is refused while the feature is stopped and no human message has reached the lead since the Stop. Human messages are the human's chat turns, Send to agent, and the orchestrator's `send_to_feature`; wake messages runcastle itself delivers don't count. The first human message clears the stop. This replaces lap 1's Ask mode, which is removed with the autonomy switch.
- **The runaway guard is judgement in the lead skill:** when a round makes no progress on the same failure as the one before, stop, write the human a short status (what is stuck, what was tried, what is needed), and wait.

### The lead's MCP surface (new tools for feature-chat sessions)

- **dispatch round** `{ seqs }` starts a run over those pending tickets. **Refused** (the only hard refusals) when: a run is already active; a drive of this feature holds the drive slot; the feature is still in planning (Go not given); the feature is stopped with no human message since the Stop. Each refusal says why.
- **stop round** cancels the running run.
- **declare ready** `{ scenario, whatToTest }` moves building → review on the first call, records the declaration on the trail, and returns warnings.
- **wait for you** `{ why }` sets the *Waiting for you* reason the status line shows (a question the plan did not settle, stuck). It is cleared by the next human message or dispatch.
- **feature context** gains: round history (each round's tickets, outcome, gates), the latest ready declaration, whether a drive is active, and whether the feature is stopped. No autonomy mode and no tokens (lap 2).

Digests stay readable per ticket, as today.

### Code edits by the lead (decision 7)

- **Until Go** the edit and install guards bind the chat as today.
- **From Go on** (the feature has left planning), both guards lift for the feature's chat: it may edit code and install dependencies in its worktree, so it can typecheck and test.
- **Its commits reach the feature branch through the same serial landing queue as a worker's.** Outside a round they commit to the feature branch directly. During a round they ride the chat temp branch and land between ticket landings, as chat docs commits already do. While a drive of the feature is active, chat landings are deferred until the drive stops.
- The lead's commit subject convention stays the conventional `feat(scope): …`, distinct from the machinery's `ticket(<seq>)` and `runcastle:` forms.

### Settings and data

- **No autonomy setting** (lap 2): the project autonomy setting, the per-feature override and their UI are removed; a feature carries a stopped mark instead (set by Stop, cleared by the next human message).
- **Rounds are runs:** a round number per feature is derived from the feature's runs in order. The `lap` column stays as a historical field. It no longer moves, and nothing in the UI reads it. Features already in flight get no migration.
- **Ready declarations** are recorded (scenario, paragraph, after which round, timestamp) for the trail and the status line.
- **Token usage** is recorded per ticket (workers) and per session (the lead, and any other session). It is summed over each session's transcript, per message or per turn, not taken from the last message's context-size snapshot that sandcastle reports for Claude Code. Codex usage comes from its per-turn usage. Tokens only, never cost, and never a limit. The record, split by kind with the session ids, is the durable telemetry (the CLIs' own transcripts expire); nothing displays it (decision 25).
- **The waiting reason**, **the stopped mark** and **the last-human-message mark** live with the feature, so the status line and the after-Stop refusal both read them.

### The orchestrator (decision 11)

On orchestrated features the orchestrator plays the human's part through the lead:
- its burn tool becomes **Go**;
- it drives when a lead declares ready;
- it sends drive notes with `send_to_feature`, which counts as a human message.

`start_feature_lap` retires. The orchestrator never dispatches rounds. Its merge behaviour is untouched.

### Skills and UI craft

- **A new lead skill** in the runcastle pack (it loads for a feature's chat once Go is given) carries the rules for the lead:
  - delegate by default, do it yourself when it's small;
  - when to ask (lap 2): carry on through what the plan settled, stop and ask before what it did not;
  - every worker task names its deliverable and how it will be checked;
  - trust the record over the prose;
  - a soft cap on workers per round;
  - "{group}: {task}" titles;
  - contract first when work spans layers;
  - a review ticket before declaring ready;
  - the runaway guard;
  - check that no drive is active;
  - how to write the what-to-test paragraph.
- The revisit skill's **Lap mode retires**, and the ideate skill's Burn hand-off becomes Go.
- **Every ticket that touches `apps/web` works through the frontend-design approach** (plan, check against the brief, build, self-critique with screenshots) against runcastle's design system (decision 22):
  - first `apps/web/DESIGN.md` and `STYLE.md`;
  - then the reading copy of the Runcastle Design System in this feature's `design-system/` (start at `project/README.md`; `FeaturePage` is the feature-page showcase);
  - with the skill itself at this feature's `frontend-design/SKILL.md`, because workers cannot reach claude.ai or host plugins from their sandboxes.

  The design system wins over the skill's push for a distinctive look. The preview's mocks explain behaviour, not styling: their chips, pills and left-border cards are what the design system retires. Facts are text (PropertyList, MetaLine, StatusDot), with one primary button per view.

### Decisions this overturns (for the project session to record as an ADR and in `CONTEXT.md`)

- `one-chat-per-feature` decision 3 (the chat cannot start a burn);
- what is left of ADR-0010 (laps);
- charter decisions 9 (approvals) and 15 (laps);
- "talk sessions do not write code", for a feature's chat after Go;
- the brief's own budget (settled item 5) and the run time limit it absorbed;
- "it only delegates" (brief item 8), softened to "delegates by default";
- the brief's autonomy switch (settled item 5) — removed in lap 2; the lead judges when to ask.

`one-chat-per-feature` decision 6 (no channel from burn agents to the chat) stands: workers still speak only through digests, events and ticket updates.

## Seams

1. **The MCP tool surface** (existing seam, new tools): dispatch round, stop round, declare ready, wait for you, and the extended feature context, called as a feature chat would call them. Observe:
   - each refusal and its reason (run active, drive active, still planning, stopped with no human message since);
   - the run created with exactly the named tickets;
   - the phase move on the first ready declaration and none after;
   - the warnings returned;
   - the context's round history and stopped mark, with no autonomy and no tokens.
2. **The features service** (existing seam: today's burn and phase transitions): Go, round dispatch, ready declaration and Stop as service functions. Observe:
   - DB state (phase, runs, stopped mark, waiting reason, last-human-message mark, declarations);
   - the events each one emits, since every mutation emits.
3. **Run finalization** (existing seam: the workflow runner). Observe:
   - no building → review auto-advance;
   - verify commands run at every round end;
   - a lead wake produced for the feature with outcome, statuses, gates and digest pointers;
   - no wake on a provider-limit halt;
   - the review ticket no longer minting fix tickets into the run.
4. **Lead delivery** (existing seam, generalized: the orchestrator's message store, waiter route, delivery and notifier). Observe:
   - a wake queued for the right feature's lead session;
   - the live path chosen when the lead is live (rewake hook on Claude Code, `codex queue` on Codex);
   - the headless resume launched when it is not;
   - the waiter no longer refusing feature leads.

   The live proof (decision 12) is exercised here end to end; lap 2 adds the headless and Codex paths (decision 26).
5. **Session guards** (existing seam: the edit-guard and install-guard decisions, plus the launcher's permission mode). Observe that a feature chat is docs-only in planning and unguarded from building on, that chat landings defer while a drive of the feature is active, that a Claude Code feature chat launches with `bypassPermissions` after Go and the default posture before it, and that the lap-2 guard hook denies merge/push to the base branch, git on the main checkout or other worktrees, and deleting the feature branch, in every permission mode.
6. **Settings** (existing seam): lap 2 removes the project autonomy descriptor; observe it gone from the settings service and the Project settings page.
7. **Token accounting** (new seam, the one new pure function): sum a captured session transcript (Claude Code JSONL, Codex rollout) into a token total. Observe correct sums on recorded fixtures, then the burner storing per-ticket totals and sessions storing their own. Since lap 2 the totals are recorded only — no read path renders them.
8. **Web derivations** (existing seam: the pure feature-UI functions that today compute next steps and lap accounts). Observe:
   - the status line for every state, and the one primary action it picks;
   - the round trail derived from runs, declarations and agent fixes;
   - pending tickets as "not yet dispatched";
   - no lap vocabulary anywhere.

   Components are tested at the repo's two component-test tiers, and screens are checked against the design system.
9. **Skill content** (existing seam: the runcastle skill pack and burner templates). Observe that the lead skill exists and loads for a feature chat after Go, that Lap mode and the Iterate hand-off are gone, and that the ideate close says Go.

## Out of scope

- **Opening a worker interactively while it works.** Parked as the draft "Open a worker while it works" (decision 14). Workers stay as they are today.
- **Any budget**: rounds, wall time, tokens or cost (decision 2). Also cost display.
- **Before/after captures in the round check.** The draft "Round effects" owns them.
- **The map and the sidebar.** The draft "The map" owns them.
- **Auto-continuing after a provider limit resets.** The draft "Auto-continue burns after provider limit reset" owns it.
- **Self-planning polish** (items 4 and 6 of the old parked list). The draft `self-planning-polish` owns them.
- **Redesigning burn engine internals**: sandboxes, landing, conflict resolution, digests. They are consumed as they are.
- **Merging, or starting drafts, without the human.** The orchestrator's existing merge behaviour is not changed.
- **Lead-to-worker or worker-to-worker messaging.** Coordination is a star; each round is the sync point.
- **Writing the ADR and amending `CONTEXT.md`.** That belongs to the project session.

## Open questions

- **How a human message is told apart from a runcastle wake**, for the after-Stop refusal (lap 1 built it for Ask mode). The intent is fixed: human chat turns, Send to agent and `send_to_feature` count, while wakes and kickoffs don't. The mechanism is the builder's: tagging server-delivered prompts, or marking from the UI and hook side.
- **Codex parity for the live wake** rests on `codex queue` against a running interactive session. If the live proof shows it can't deliver at turn end, the fallback is the headless resume after the session's turn ends, and the digest must say so.
- **The soft cap on workers per round** is a number in the lead skill. Start at the project's burn concurrency, and tune it from use.
