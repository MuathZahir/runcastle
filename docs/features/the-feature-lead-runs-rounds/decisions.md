# Decisions — The feature lead runs rounds

## 1. Default autonomy is "Run until ready for me"
**Decision:** The project-wide default autonomy is "Run until ready for me". A feature can override it to "Ask before each round".
**Why:** The human reports few overturns of self-made plans' decisions, so plans hold up well enough for the lead to keep going without a click per round. The switch makes the more cautious mode one click away for any feature that needs it.

## 2. There is no budget
**Decision:** The lead runs without a budget — no round limit, no wall-time limit, no token or cost cap. This drops the brief's budget (settled item 5) and the "time limit on a run" it absorbed (item 9). What bounds the lead is the autonomy switch, the human's ability to stop it at any moment, and its own judgement about when to stop and ask.
**Why:** The human: Claude Code has no budget concept and people run `/goal` without one; a budget is bookkeeping nobody asked for. Chosen over a rounds-and-wall-time budget per stretch of autonomy.

## 3. Token telemetry is recorded anyway
**Decision:** Runcastle records token usage — tokens only, no cost — for the workers and for the lead itself, per ticket and per session, kept as history. It is shown in three places only: one number per round on the round trail ("Round 3 · 4 workers · 1.8M tokens"), a feature total in the feature header, and per worker on its ticket. It informs, it never limits anything (decision 2). Totals are real sums over each session, not the last message's context size.
**Why:** The human wants the numbers visible even with no cap on them. Cost is left out because on a subscription a dollar figure is wrong and a computed one is a guess; the lead is counted because it does real work now (decision 5). Chosen over workers-only counting, and over showing cost where reported.

## 4. The whole feature ships in one lap
**Decision:** Everything in the brief lands in lap 1 — the lead's dispatch and wake loop on Claude Code and Codex, the autonomy switch, stop behaviour, token telemetry and the removal of laps from the UI. Nothing is parked under Later laps.
**Why:** The human is sure of the shape (the prototype settled it) and wants it whole rather than in slices.

## 5. The lead may edit code itself, at its own judgement
**Decision:** The lead can change code directly — a tiny fix between rounds, or a change small enough that it does not split into tickets at all. Whether to do it itself or dispatch a round is the lead's call. This overturns "talk sessions do not write code" for the lead, and softens brief item 8 ("it only delegates") into "it delegates by default".
**Why:** The human wants the desktop-app feel and as much flexibility as possible; forcing a sandbox round for a one-line change is ceremony. Chosen over "a tiny fix is a one-worker round".

## 6. Flexibility over restriction
**Decision:** Where the lead's behaviour is a judgement call, the lead gets the judgement: rules for the lead are defaults and guidance in its skill, not hard refusals in the machine. The hard stops are the human's checkpoints (Go, the drive, Merge).
**Why:** The human: "I want things to be as flexible as possible, don't make things too restricted." Consistent with `four-states-and-two-hard-rules` — gates guide and never imprison.

## 7. The lead edits from Go onwards, verified, through the landing queue
**Decision:** Until Go the lead is docs-only, as today. From Go on, the edit guard lifts for the lead, package installs are allowed in its worktree so it can typecheck and test, and its commits reach the feature branch through the same serialized landing path as a worker's (ADR-0002), gates included.
**Why:** Go keeps its meaning — nothing touches code before the human approves the plan. A real worktree lets "just do the thing" be verified, and one landing path means the lead's change never races a running round. Chosen over letting the lead edit during planning (spikes before the plan).

## 8. Go replaces Burn
**Decision:** Go is the human's one click that approves the plan: it moves planning → building as Burn does today and hands the feature to the lead, which dispatches round 1 itself. The human never clicks Burn on a feature again; the lead dispatches every round. In "Ask before each round" mode the lead proposes the next round in chat and the human's reply is the approval — no extra button, and the reply can amend the round ("go, but drop ticket 4").
**Why:** One name for one act. "Go and Merge" become the human's two clicks. Chosen over keeping Go as a chat word with Burn still the button.

## 9. The lead declares "Ready for you", and that is what moves to review
**Decision:** Runs no longer auto-advance building → review. The feature moves to review when the lead declares it ready through an MCP call carrying a short scenario title and a short paragraph telling the human specifically what to test (what changed, where to look, what would count as broken). That call puts the drive in front of the human. It is a declaration, not a gate: failures in the last round produce warnings the lead must relay, never a refusal. Rounds after a drive happen in review (states only move forward); the lead declares ready again, with a new scenario and paragraph, when it is satisfied. Merge stays available to the human throughout.
**Why:** Only the lead knows when a feature is worth driving; a first round succeeding is not that. The what-to-test paragraph was the human's addition: a drive is worth more when it is aimed. Chosen over keeping auto-advance and moving the feature back, which breaks forward-only.

## 10. Gates run every round; the review agent is the lead's tool
**Decision:** The project's verify commands run automatically at the end of every round, and their results are part of what wakes the lead. A review ticket (the independent review agent with its drive, screenshots and findings) is no longer a fixed part of every burn: the lead's skill tells it to include one in the round before it declares ready, and when to use it is the lead's call. The "no review ticket" burn warning becomes a warning on the ready call when nothing has reviewed the work since the last change. Findings go to the lead, which fixes them in a round, fixes them itself, or relays them to the human — the human's triage step goes away.
**Why:** The lead needs a deterministic check every round; the full review is what makes "Ready for you" trustworthy, but every round paying for it doubles small rounds and contradicts decision 6. Chosen over a review ticket in every round.

## 11. The orchestrator plays the human's role, one level up
**Decision:** The project session's orchestrator keeps standing in for the human on features it orchestrates, and works through their leads: its burn tool becomes a Go tool, it drives when a lead declares ready, and it sends drive notes to the lead with `send_to_feature`. `start_feature_lap` retires with laps. The orchestrator never dispatches rounds itself. Its existing merge behaviour is untouched.
**Why:** One owner per level — the human or orchestrator owns the checkpoints, the lead owns the rounds. Chosen over letting the orchestrator keep burning directly, which gives a feature two dispatchers that can race.

## 12. The lead is woken live when it can be, headless when it cannot
**Decision:** When a round returns, runcastle wakes the feature's lead with the round's outcome and gate results. A live lead is woken through the existing waiter, opened to feature leads: the rewake hook on Claude Code, `codex queue` on Codex; a wake that arrives mid-conversation waits for the lead's turn to end. A lead that is not live (terminal closed, session died, server restarted) is resumed headless with the wake message, so "Run until ready" keeps going while the human is away; unconditional resume later reopens the same conversation. The feature is not done until a real round has visibly woken a real lead on both runtimes.
**Why:** Running until ready while the human is away is the point of the feature, and a hook alone stops at a closed terminal. The live proof is required because the waiter's proof was never shown in "Whole cuts plan themselves". Chosen over the hook alone.

## 13. A round is one run over the tickets the lead names, one at a time
**Decision:** The lead writes tickets with `emit_tickets`/`update_ticket` as today, then dispatches a round naming which pending tickets it covers; unnamed tickets wait for a later round. The engine is unchanged underneath (blockedBy ordering, serialized landings, digests, burn concurrency as the parallel width); "contract first" is a ticket the others are blocked by inside the same round. Only one round runs at a time — dispatching during a round is refused, as a second burn is today. The lead's surface adds: dispatch a round, stop the running round (landed work stays), declare ready (decision 9), and the round history in its feature context; digests are read per ticket as today. The worker cap per round and the "{group}: {task}" title convention are guidance in the lead's skill, not engine rules.
**Why:** A round is the sync point where the lead reconciles contracts, so it must have a clear "what came back". Chosen over letting the lead add tickets to a running round.

## 14. Workers stay as they are; opening a worker is parked
**Decision:** Workers run exactly as today: headless in their sandboxes, watched through the live per-ticket transcript, stoppable per ticket. Opening a worker interactively while it works is out of this feature, parked as the draft "Open a worker while it works", which depends on this one.
**Why:** A true terminal attach rewrites how the engine runs and watches an agent (done detection, transcript, timing, error classification, on both runtimes); the human chose to keep this feature off the engine and do it later.

## 15. How the loop stops
**Decision:** The human stops the lead with one move: a Stop control on the feature page stops the running round (landed work stays) and flips the feature to "Ask before each round", so nothing new is dispatched until the human replies. Flipping the switch to Ask alone is the gentle pause — the current round finishes, then the lead proposes instead of dispatching. A failed round is just what came back; the lead re-plans, retries or fixes it itself. Its skill carries the runaway guard as judgement: when a round makes no progress on the same failure as the one before, stop, write the human a short status (what is stuck, what was tried, what is needed), and the feature shows "Waiting for you". On a provider limit (which already halts a run) runcastle does not wake the lead, since it would hit the same wall; the feature shows "Waiting for you · provider limit" (decision 21) and the human's next message picks it up. Auto-resuming after a limit reset stays with the draft "Auto-continue burns after provider limit reset".
**Why:** With no budget (decision 2) and headless wakes (decision 12), stopping must be one move and the lead must know when to ask. Chosen over a hard round counter.

## 16. Rounds replace laps everywhere the human looks
**Decision:** Every run is a round, numbered per feature and derived from runs, as the lap counter is today. The feature page shows a round trail — what each round dispatched, what landed, gate results, the lead's one-line verdict — with the ready declarations on it as the points where the human was asked to drive. Gone: Iterate / "Start lap N+1", the start-lap session, the review triage step, lap chips, "Lap N in progress", "carried from lap N", and lap grouping in the ledger, review trail and run lanes; tickets group by the round that burned them, and pending ones read "not yet dispatched". Shipped features' history reads as rounds too. The `lap` column stays in the database as a historical field that no longer moves or drives the UI.
**Why:** After decision 10 a round is any run, so lap semantics (a burn plus its review) no longer fit; one vocabulary across old and new features. Chosen over renaming laps to rounds with lap semantics kept, and over a history-rewriting migration.

## 17. The human's mental model is as simple as possible
**Decision:** From the human's point of view the system is: talk to the feature's lead → see the plan → Go → rounds run → "Ready for you" with what to test → drive and say what you found, in the same chat → Merge. Any surface, state or word that is not part of that story is removed or hidden, and every remaining choice in this feature is made in favour of fewer concepts.
**Why:** The human: "I want things as simple as possible. The mental model of the system should be very simple from the user's pov."

## 18. Drive notes reach the lead with one "Send to agent" click
**Decision:** The drive panel's note composer stays (it is where screenshots go in easily) and its notes are for the lead. A "Send to agent" button sends every unsent note, screenshots attached as files the lead can read, as one message that wakes the lead; it works at any point in the drive and can be used more than once. The human can also just type in the chat — both land in the same conversation. Sending with no notes ("all good") is a valid message. The triage step that used to receive notes is gone (decision 16).
**Why:** One message per send, not one per note, so the lead acts on a considered batch. The button was the human's addition. Chosen over dropping the composer and typing everything in the chat, which loses screenshots.

## 19. No round starts while the feature is being driven
**Decision:** Dispatching a round is refused while a drive of this feature holds the drive slot, and the refusal says so; the lead's skill also tells it to wait for the drive to end. The lead's own commits made during a drive wait to land until the drive stops.
**Why:** The drive runs the feature branch on the main checkout; landing work under it changes the app the human is testing. This is a safety rule tied to a human checkpoint (decision 6), so the machine enforces it rather than leaving it to judgement.

## 20. The UI says "agent" and "workers"; "lead" is internal
**Decision:** The UI calls the feature's chat "the agent" — the one the human talks to — and what a round runs "workers", shown only inside a round ("Round 3 · 4 workers"). Round, Go, Ready for you and Merge stay as decided. "Lead" remains the internal word in docs, skills and code, where it must be told apart from workers.
**Why:** "Agent" is the human's own word and needs no explanation; "lead" only means something next to "workers" (decision 17). Chosen over "Lead" in the UI, as in the prototype.

## 21. One status line per feature, from a fixed set
**Decision:** Each feature shows one status line: "Planning with you" (before Go); "Working · Round N" (a round is running, or the agent is working between rounds); "Waiting for you · <why>" — one status for every case where the agent needs the human (plan ready for Go, an Ask-mode round proposed, stuck on the same failure, provider limit), the why in a few words; "Ready for you · Test drive ▸ <scenario>", with the what-to-test paragraph one click away; "Merged". The four phases stay underneath as machine states; this line is what the human reads. Beside it sit the autonomy switch (defaulting from Project settings, where the project-wide default lives) and Stop, shown only while working.
**Why:** Decision 17 — one glance, one vocabulary, replacing today's mix of phase, lap and next-step text. Chosen over separate statuses for each kind of pause; they are one fact: nothing moves until the human acts.

## 22. UI work follows the design system, built with the frontend-design skill
**Decision:** Every ticket that touches `apps/web` tells its worker to work as the frontend-design skill says (plan, check against the brief, build, self-critique with screenshots) and to follow runcastle's design system: `apps/web/DESIGN.md` and `STYLE.md` first, then the Runcastle Design System artifact. Workers cannot reach claude.ai or the host's plugins from their sandboxes, so both travel in this feature's docs: `design-system/` (a reading copy of the artifact's files) and `frontend-design/SKILL.md` (with its Apache-2.0 licence). The design system wins over the skill's push for a distinctive look; the preview's mocks explain behaviour, not styling.
**Why:** The human wants the real UI better than the preview's mocks, built with /frontend-design against the existing design system.

## Lap 2

## 23. No autonomy switch; the lead judges when to ask
**Decision:** The autonomy switch, the project "Default autonomy" setting, the per-feature override and Ask mode (with its dispatch refusal) are removed. The lead's skill decides: it carries on by itself through anything the plan already settled — fix rounds, small fixes it does itself — and stops to ask before anything the plan did not settle (a design decision, a scope change, a trade-off the human would have an opinion on). One machine rule stays: after the human presses Stop, no round dispatches until the human replies; the status reads "Waiting for you · stopped".
**Why:** The human, after driving lap 1: "I don't want the 'Run until ready' and 'Ask before each round' selector. The agent can tell when the user wants to start or not." Stop keeps one guarantee so it still means something when the lead runs headless.
**Supersedes:** decision 1, and the Ask-mode parts of decisions 8 ("In Ask before each round mode…") and 15 (Stop "flips the feature to Ask before each round").

## 24. The feature header is two lines and one action row
**Decision:** Above the content the feature page shows only: the title; one meta line (branch · started); and the status line with its actions — exactly one primary button chosen by state (Go in planning, Start test drive when ready, Stop drive while driving, Stop while a round runs), Merge always present as a secondary, the rest in the "⋯" menu, and "What to test" one click away when ready. Removed from the header: the phase stepper, the autonomy switch, the "Agent live" row (the top bar's Agent tab carries the live dot; End session moves into the Agent tab), the header "Agent" button, and the Review/Tickets/Test drive/Round fact list (the status line and the round trail say it). The walkthrough-videos warning moves to where a drive starts and shows only when it applies; "Notes for the agent" shows only while driving or after a ready declaration. The burn and lap wording lap 1's review still found is removed in the same pass.
**Why:** The human, after driving lap 1: "There are so many header lines … It's so confusing." Seven stacked rows said the same state up to four times. Chosen over keeping the phase stepper from the design system's FeaturePage showcase: the status line already says where the feature is (decision 21).
**Supersedes:** the header layout of decision 21 ("Beside it sit the autonomy switch and Stop") and the phases-as-stepper presentation.

## 25. Tokens are recorded, never shown
**Decision:** Token usage keeps being recorded exactly as lap 1 built it — per worker on the ticket and per chat session, with the breakdown by kind (input, cache writes, cache reads, output) and the session ids — as durable telemetry in runcastle's database. Nothing shows it: no token figure on the header, the round trail or the ticket, and none in the lead's feature context.
**Why:** The human: the point of the count is observability and telemetry, so there is no point showing it. The figure shown in lap 1 (1.7M for a seconds-long round) summed cache re-reads on every turn plus the whole planning chat (traced to `featureTokensTotal` in services/usage.ts and per-call cache reads in core usage.ts) — accurate as a sum, misleading as a number. The CLIs' own transcripts expire (Claude Code cleans them up after its retention period), so the database is the record that lasts.
**Supersedes:** decision 3's "shown in three places only".

## 26. Lap 2 proves the headless wake and the Codex wakes
**Decision:** One lap-2 ticket stands on the paths lap 1 never exercised before changing anything: a lead whose terminal is closed when a round ends resumes headless, acts (dispatches or declares ready) and later reopens as the same conversation; and the same on Codex, live and headless. It fixes whatever fails and records exactly what was proven; if a runtime cannot run inside the sandbox, it documents the procedure and the lap's review drives it.
**Why:** Both lap-1 reviews: headless and Codex wakes were not exercised, and "keeps going while you're away" (decision 12) rests on the headless one.

## 27. After Go the lead never stalls on a permission prompt; a guard keeps the human's lines
**Decision:** Once Go is given, the feature's chat on Claude Code runs with `bypassPermissions` (Codex's posture already never asks inside its workspace-write sandbox); before Go it stays docs-only and asking. A guard hook that runs whatever the permission mode denies, with a reason the lead sees: merging into or pushing to the base branch, git operations on the main checkout or on other features' worktrees, and deleting the feature branch.
**Why:** In lap 1's drive the only prompts left were for `git` commands the lead ran itself; in a headless `claude -p` wake nobody can answer them, so they are denied and the loop stalls. Same posture as the orchestrator ("Whole cuts plan themselves"); the guard is what keeps "Merge stays the human's click" true when the lead can run any command. Chosen over a wider allowlist, which is never complete and stalls a headless round at every gap.
