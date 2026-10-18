# Outcome — The feature lead runs rounds

The feature chat becomes the feature's lead. Once you approve its plan, it dispatches rounds of sandboxed workers, wakes when they return, checks the work and plans the next round, until it's ready for you to drive. Laps disappear from the UI, Merge stays your click, and an autonomy switch and a budget bound it.

- Shipped: 2026-10-18
- Laps run: 3

## What shipped

80 commits · 299 files

### Lap 1
- 12 tickets landed: #1 Rounds: Go, dispatch, ready and the record (server contract); #2 The lead wakes when a round returns — live or headless, Claude Code and Codex; #3 The lead's skill, its code permissions after Go, the orchestrator's new role, and start-lap retired; #4 Token telemetry for workers and the lead; review findings go to the lead; #5 Feature page: one status line, Go, the autonomy switch, Stop, and Send to agent; #6 The round trail replaces laps everywhere in the UI; #8 Burn wording still reaches the human: "until you burn" under the ticket list, "Burn" row on the build view, "burn-ready tickets" in Create menu; #9 The lead's new MCP tools are not pre-approved, so "Run until ready" stalls on a permission prompt at the first dispatch; #10 A chat that is live at Go never loads the lead skill, so the lead runs without its rules (review before ready, runaway guard, drive check); #11 After Stop (or any stopped/failed round) the status line says "Working · Round N" with a Stop button while nothing is running and the agent is idle; #12 Every round silently grows a "Verify the fixes that landed" review pass, doubling small rounds and mislabelling ordinary tickets as fixes; #13 The header (status line, phase, autonomy) does not refresh live after Go, Stop or a ready declaration; it needs a page reload
- 0 waived
- 0 failed

### Lap 2
- 8 tickets landed: #15 The agent keeps going while you're away: no permission prompts after Go, a guard on your lines, headless and Codex wakes proven; #16 One feature header, no autonomy switch, tokens recorded but never shown; #18 The headless wake starts a fresh conversation instead of resuming the agent's own: one timed-out SessionStart hook leaves the chat with no recorded conversation id; #19 Send to agent during a drive never reaches a closed agent: the headless wake is refused because the drive holds the branch, the UI says "Sent to the agent", and ending the drive doesn't retry; #20 Stop's guarantee is voided by runcastle's own wake: waiter-delivered messages (the Stop notice, round-end wakes) are counted as human replies and clear the stopped mark at once; #21 The status line says "Working · Round N" for good once a round succeeds and the agent's turn ends without a new declaration — nothing is running and nobody is working; #22 Settings still speak burns and laps (a "Burns" page, "runs laps" in the orchestrator setting), and the Verify field says runcastle never runs the commands it now runs at every round end; #23 Server-written strings still put "lap" in front of the human: the agent's kickoff line in the Agent tab, and the "Agentic review — lap N" ticket title
- 0 waived
- 0 failed

### Lap 3
- 2 tickets landed: #25 A headless wake never loses the message it carries: no resume of a vanished conversation, requeue when the process dies early; #27 A headless wake's check-in is swallowed on a locked database, then the ready-watchdog's own write crashes the whole server
- 0 waived
- 0 failed

## Review record

### Lap 1 · review

- Reviewed commit: 289758a1f7a15e4d48e4128be8fb083d692121e5
- Landed since: 16
- Outcome: done

### Lap 1 · verification

- Reviewed commit: 5e758e59d6523a800c633174e82b77699d94b2be
- Landed since: 10
- Outcome: done

### Lap 2 · review

- Reviewed commit: 1c6a298d5a3edf9066a9242bbadcfb6c106df3b1
- Landed since: 8
- Outcome: done

### Lap 2 · verification

- Reviewed commit: 49505f9092701cce927b5889c2b1ebf369c81087
- Landed since: 2
- Outcome: done

### Lap 3 · review

- Reviewed commit: 0fe94d3ab1badc2deebb89e7906bfab58395e454
- Landed since: 1
- Outcome: done

### Lap 3 · verification

- Reviewed commit: 0c619320e10b023af5d4949001cf4f772d009b91
- Landed since: 0
- Outcome: done

- **The test gate is red on one pty-teardown timing test the branch never touched; the sandbox clock stepped back mid-test** — open
- **With busy_timeout a long external lock now freezes the server instead of crashing it** — open

## Notes record

- I hate this so much... What is this mess. The UI looks so bad. There are so many header lines (the "Waiting for you" with all the buttons, then the "Agent live" with the end session, etc... It's so confusing. — carried → lap 2
- I don't want the "Run until ready" and "Ask before each round" selector. The agent can tell when the user wants to start or not. He can ask, if there's some small fixes to make after the round he can create it automatically. If there are design decisions, he would ask the user, etc... — carried → lap 2
- Why does it say 1.7M tokens?? This was only a one ticket run that ran for a couple seconds, the number is probably wrong or I'm misunderstanding it — carried → lap 2

## Per-ticket digests

### Lap 1

#### 1. Rounds: Go, dispatch, ready and the record (server contract)

# Ticket 1 — Rounds: Go, dispatch, ready and the record (server contract)

## What was done
- **Schema (migration `0046_polite_nightcrawler.sql`, the only one in this feature):** `projects.autonomy`; `features.autonomy`, `waiting_reason`, `last_human_message_at`, `last_dispatch_at`; new `ready_declarations` table; `tickets.tokens/token_breakdown`; `sessions.tokens/token_breakdown`; `test_notes.sent_at`. I also added **`runs.gates`** (a `ReviewGateRun` JSON column) to hold each round's verify result. In core: `Autonomy`, `DEFAULT_AUTONOMY`, `resolveAutonomy(project, feature)`, `ReadyDeclaration`, `RoundGates`, `RoundSummary`. Optional `tokens` was added to the `Ticket` and `SessionRow` wire types, `gates` to `Run` and `sentAt` to `TestNote`.
- **Services (`services/features.ts`):** `go`, `dispatchRound`, `stopRound`, `stopFeature`, `declareReady` (it returns `{declaration, warnings}`), `setAutonomy`, `listReadyDeclarations`. `setWaiting` and `markHumanMessage` live in the new `services/lead-status.ts` (it avoids an import cycle) and are re-exported from `features.ts`. `goWarnings` in `burn-warnings.ts` keeps only the missing-spec warning. `listRounds` and `roundGatesOf` are in `services/runs.ts`.
- **Delivery contract (`services/lead-delivery.ts`):** `deliverToLead(ctx, feature, {text, source})` and `composeRoundWake(ctx, featureId, runId)`. A live, non-headless chat gets the message as a bracketed paste through `writeToLiveTerminal`, plus `lead.message_delivered`. Any other case emits `lead.message_pending` carrying the text.
- **Run finalization (`workflows/runner.ts`):** auto-advance is removed. A branch-claiming run gets an `endRound` step after cleanup: it runs the gates (`StartRunOptions.roundGates` can be overridden in tests; the default runs `runReviewGates` keyed by runId against `headSha(feature.branch)`), writes `runs.gates`, emits `round.gates`, then wakes the lead. A cancelled run sends no wake, since Stop tells the lead itself. A `run.halted` event sends no wake either and calls `setWaiting('provider limit')`, or the halt headline if it is not a limit/quota/billing halt.
- **MCP:** chat-only tools `dispatch_round`, `stop_round`, `declare_ready`, `wait_for_you`. They have a call-time guard (`requireLeadFeatureId`) and refusals come back as tool errors. `get_feature_context` gains `autonomy`, `rounds`, `latestReady`, `driveActive`, `waitingReason`.
- **tRPC:** `feature.burn` is replaced by `feature.go`, and `burnWarnings` by `goWarnings`. Added `stop`, `setAutonomy`, `rounds`, `readyDeclarations` and `notes.send`. Project autonomy is the `autonomy` settings descriptor and emits `settings.updated`. The web caller is `Workspace.tsx` (not `BurnFeatureDialog.tsx`); it and `lib/live.ts` now call go/goWarnings.
- **`scripts/smoke.ts`** now sets the project model, calls `go`, then MCP `dispatch_round` and `declare_ready`, because `feature.burn(model)` is gone. This was not run.

## Surprises
- Go stamps `lastHumanMessageAt`. Without it, an Ask-mode feature could never dispatch round 1.
- `dispatchRound` accepts named **failed** tickets and resets them to pending, as burn's restart does. Done and cancelled tickets are refused.
- Existing tests asserted the old auto-advance or `feature.burn`. In burn-from-review, review-ticket, orphaned-burning, findings-router, burn-warnings, chat-contract (tool list) and read-tool-ceiling (context key order), I updated the expectations or switched them to the `burn()` service.
- A round's per-ticket landed/failed reads each ticket's *current* status. A ticket that failed in round 1 and landed in round 2 shows as landed in both.

## Left undone
- "No review since the last change" only sees ticket `completedAt`. The lead's own code landings (ticket 3) are not counted yet.
- The deferral of chat landings during a drive (decision 19) belongs to ticket 3. The web triage step's quick-fix still calls `go` from review and will be refused until ticket 5 removes it.
- CLAUDE.md's "24 tools" note is now 28. I did not edit it.
- Drive machinery: no new service, env var, seed or process, so `.runcastle/` needed no change.
- Verified: `bun run typecheck` passes with 0 errors. The full `bun run test` run had 3 failures, all expectation updates. After fixing them I re-ran only those 2 files (green), not the whole suite again.

#### 2. The lead wakes when a round returns — live or headless, Claude Code and Codex

# Ticket 2 — the lead wakes when a round returns

**What was done.** `deliverToLead` (ticket 1's signature, unchanged) now tags each message with `[runcastle]` and queues it in the orchestrator message store under `leadMessageKey(featureId)` (`lead:<id>`). It uses the feature key, not a session id, because one conversation spans many session rows and a message must outlive the row that was up when it arrived. What happens next depends on the lead's state:
- **A live terminal on Claude Code:** the lead is kicked through the asyncRewake waiter. `renderSettings` now adds the `wait-messages` hooks on SessionStart and Stop for non-headless `chat` sessions as well as for orchestrate sessions. The UserPromptSubmit route lets the waiter go while keeping the lines, so a message that arrives mid-turn waits for the turn to end. `lead.woke` is emitted when the waiter takes the lines.
- **A live terminal on Codex:** `codex queue` takes the message. A failed spawn puts the lines back in the queue instead of dropping them.
- **No terminal:** `lead.message_pending` is emitted. `startLeadWaker` (started at boot in `index.ts`) responds to that event, and to `session.pty_exited` or `session.spawn_failed`, by resuming the feature's most recent chat headless. It goes through `launchSession` with the new purpose `lead-wake` (`claude -p --resume`, `codex exec resume`). Messages that arrive during a headless run wait in the store, and the next resume after that run exits delivers them.
- **Kickoffs, Go and briefings typed into a live chat** are tagged too. For a lead with a terminal, `UserPromptSubmit` calls `markHumanMessage` only for prompts without the tag.

The orchestrator's delivery is unchanged: `kick` only gained an optional key that defaults to the session id. Unit tests are in `test/lead-delivery.test.ts`, with additions to `launch-artifacts` and `headless-run-launch`.

**What was proven live: nothing.** `scripts/prove-lead-wake.ts` (claude-code|codex, live|headless) exists and typechecks. The sandbox has claude 2.1.295 and codex 0.155.1, but neither is logged in (claude says "Not logged in"; codex gets a 401), so the script could not run. Unit tests cover queueing, the waiter route, choosing the channel, the headless relaunch and the human-prompt marking. Run `bun scripts/prove-lead-wake.ts claude-code` and `... codex` on an authenticated host before treating decision 12's live proof as done. Codex live delivery still assumes `codex queue` reaches a running interactive thread. If it doesn't, the requeue-on-failure path hands the lines to the headless resume once the session ends.

**Surprises.** The waiter has to be let go when a lead's turn starts. Otherwise asyncRewake wakes Claude mid-turn, which the orchestrator allows but the ticket forbids. Headless sessions get no waiter, because their process exits at turn end and would take the waiter's lines with it.

**Left undone.** Routing `run.finished` and round end to `deliverToLead` (the notifier's job, decided by another ticket) is untouched. Drive machinery is unaffected: no new service, env var or seed.

#### 4. Token telemetry for workers and the lead; review findings go to the lead

# Ticket 4 — token telemetry; review findings go to the lead

## What was done
- `packages/core/src/usage.ts`: `sumSessionUsage(text, runtime, window?)`. It counts each Claude Code message id once and sums Codex rollouts per turn (token_count events and `turn.completed`). It honours a timestamp window and returns input/cacheCreation/cacheRead/output/total. Tested on JSONL fixtures under `packages/core/test/fixtures/usage/`, including a duplicated message id and a subagent file. No cost is computed anywhere.
- `packages/server/src/services/usage.ts` holds the IO half: transcript reading (with the `<id>/subagents/agent-*.jsonl` side files), `addTicketTokens`, `refreshSessionTokens`, `refreshLeadTokens`, `leadUsageReader` and `featureTokensTotal`.
  - The burner calls `harvestTicketTokens` after each sandcastle `run` (resolver and main attempt). It sums each iteration's `sessionFilePath` and accumulates onto `tickets.tokens`. The breakdown JSON carries `sessionIds`. An unreadable transcript emits `ticket.tokens_unreadable` and leaves tokens null.
  - `RoundSummary.tokens` is the round's tickets plus the lead's usage inside the round's `[startedAt, endedAt]` window.
  - `FeatureFull.tokensTotal` covers all tickets plus all of the feature's sessions; the lead is refreshed lazily, with a 30s staleness guard.
  - `endRound` in `runner.ts` refreshes the lead's tokens.
  - Per-ticket tokens are on `Ticket.tokens`.
- Review findings: `reportFinding` no longer mints fix tickets.
  - A defect stays an open finding. A retried review re-reporting the same defect (same title and location) refreshes the existing finding instead of adding a second.
  - The burner no longer admits new tickets or revives a review's failed children when a review settles (`readmitMintedChildren` was removed). The verification-pass admission still works.
  - The review prompt (`packages/skills/burner/review-ticket.md`) and the `report_finding` tool description now say defects go to the lead.

## Surprises
- With every defect now starting open, `get_feature_context` stated each one twice (`openDefects` + `findings`) and broke the read-ceiling test. `findings` now skips defects already listed in `openDefects`/`carriedDefects`.
- Many tests used `reportFinding` to build a "defect with a fix ticket" fixture. That shape now comes from `packages/server/test/helpers/findings.ts` → `reportWithFixTicket`, which is the legacy data shape.

## Left undone
- The review digest headline still reads "`<Y>` fixed in-run" (lap vocabulary, and Y is now always 0). The prompt says so, but renaming the headline belongs with the lap-vocabulary removal, since web derivations parse it.
- `AUTO_FIX_CAP` survives only in `verify-fixes.md` text, and the `over-cap` openReason is no longer written. The cap and the UI's "over the auto-fix cap" label could be retired with the review-page rework.
- No drive machinery change was needed: no new service, env var, seed or process.

#### 5. Feature page: one status line, Go, the autonomy switch, Stop, and Send to agent

# Ticket 5 — Feature page: status line, Go, autonomy, Stop, Send to agent

**What was done**
- `lib/feature-ui/status-line.ts` (new, imported directly, not through the barrel): `featureStatus` derives Planning with you / Working · Round N / Waiting for you · <why> / Ready for you · Test drive ▸ <scenario> / Merged from the feature row, `feature.rounds`, `feature.readyDeclarations` and whether the agent's session is mid-turn. Deviation: "plan ready for Go" is shown as **Waiting for you · plan ready for Go**, as spec.md and decision 21 say, not under "Planning with you" as the ticket text read. Also `featureTokens`/`tokensText` (rounds' worker tokens + the feature's session tokens) and `leadActions` (relabels the plan's Burn to Go, drops burn actions past planning and the bar's own run cancel, and renames the Chat door to Agent).
- Header: the status line (`workspace/FeatureStatusLine.tsx`) goes into `NextStepBar`'s left column through a new `status` slot, replacing the resolver's sentence, counts and note. The bar's **actions** (Start, Test drive, Merge, resolve conflict…) are still rendered. Dropping them would have left those flows with no buttons, and the next-step resolvers belong to ticket 6. Beside the line: the token total (hidden when nothing has been counted), a SegmentedControl autonomy switch (feature override ?? project default via core `resolveAutonomy`, writes `feature.setAutonomy`), and Stop (danger-ghost, only for kind `working`, confirm dialog, calls `feature.stop`). What-to-test is a closed `Disclosure` under Ready. Drafts and read-only views keep the old bar.
- `BurnFeatureDialog` → `GoFeatureDialog` (+ `goSummary` replacing `burnSummary`/`burnLap` in summary.ts). It shows the plan, autonomy and model, has no refusal for zero tickets, and its copy depends on the autonomy mode.
- The notes section and the expanded rail are now headed "Notes for the agent". New `review/SendToAgent.tsx` sits under the composer. It is primary only in the expanded stage's aside and secondary on the page, where the bar holds the primary. It shows "N notes not sent yet" / "Sent 5m ago" / the all-good hint, adds a "Sent to the agent" mark on note rows, and shows the drive-hold line while a drive of this feature is up (`ReviewBody` passes `driveActive`).
- Project settings: "Default autonomy" select descriptor; `AUTONOMY_LABEL` in vocabulary.ts (placed far from the lap lines).
- Vocabulary: the Chat tab, session kind name, "Open agent" and the feature chat's aria label now say Agent. The stepper's unlock tips say Go / "the agent is ready for you".

**Surprises**
- Seven review test files mock tRPC without `notes.send`/`notes.list`, so I added those mocks.

**Left undone**
- Token total: ticket 4's `tokensTotal` did not exist yet, so the total is computed from rounds + sessions. Switch to `tokensTotal` if ticket 4 adds it.
- Not changed: `FeatureChat`'s fallback context line "Chat · lap N" and `chatContextLine`. Both carry lap wording that ticket 6 owns.
- Not changed: the notification titles "Burn complete — review is ready" / "Burn failed" in `lib/notifications.ts`. They are not buttons, but they are now inaccurate.
- The "Lap N" fact in the header meta line belongs to ticket 6.
- Visual check: none was done. I could not run the app or take screenshots in this sandbox, so light/dark screenshots are still owed. I checked against DESIGN.md by reading only: no pills, facts as text, one primary.
- Drive machinery: no new service, env var, seed or process, so `.runcastle/` was not touched.

#### 6. The round trail replaces laps everywhere in the UI

# Ticket 6 — The round trail replaces laps everywhere in the UI

**What was done.**
- **New derivation.** `apps/web/src/lib/feature-ui/rounds.ts` has `roundTrail(rounds, tickets, declarations, codeLandings, runs)`. It returns the trail entries (round / agent-fix / ready, ordered by the round each follows) plus `notDispatched` (pending tickets that no round has held). It also has `codeLandings(events)`, which reads the `lead.code_landed` events defensively, plus `groupByRound`, `roundOfSeq`, `latestRoundTickets`, `roundNumberOf` and `roundAccount` (this replaces `lapAccount`, scoped to the latest round).
- **Tickets module.** Helpers that have nothing to do with laps moved to `feature-ui/tickets.ts`: `noun`, `pendingTickets`, `ticketCount`, `ticketCountText`, `ticketModelChip` and a lap-free `burnLabel`.
- **Deleted.** `laps.ts`, `timeline.ts`, `lapTrail` and `ReviewTrail`, `TriageStep`, `CarriedFindings`, `LapStory`, `lapExplainer`, and the `LapSections` primitive (replaced by `RoundSections`).
- **Trail UI.** `components/review/RoundTrail.tsx` is the new trail. Each round shows its facts as one MetaLine: workers, tokens, duration, running/stopped, landed, failed, gates. The verdict is `runs.summary`. Workers sit in a Disclosure, with per-worker tokens and a "Recording" button on review workers so they can still be staged in the player. Agent-fix entries show their commits. A ready entry shows "Test drive ▸ scenario" with the what-to-test paragraph collapsed. There are no dots-on-a-rail.
- **Data.** `lib/round-trail.ts` (`useRoundTrail`) reads `feature.rounds` and `feature.readyDeclarations`. Review and shipped pages both use it. `live.ts` now invalidates both queries on push.
- **Where rounds now show.**
  - Ticket ledger (Tickets and Pinned bodies): grouped by round, plus "Not yet dispatched".
  - Run picker: "Round N · k lanes".
  - Run lanes: no grouping any more, since a run is one round.
  - Work list: flat. Carried defects now sit in the settled half with Reopen and Dismiss, because the carried band is gone.
  - Evidence stage and status rows: lap labels removed ("Reviewed earlier", Test drive "Taken").
  - The Workspace Lap chip and the start-lap and triage handlers are removed. No web code sends `purpose: 'start-lap'` any more.
- **Next-step bar.** Iterate and its compounds are gone. On review with open work, Chat is now the primary action.

**Surprises.**
- Removing the `iterate`/`endSessionAndIterate`/`stopDriveAndIterate` action kinds meant deleting three entries from `NextStepBar.tsx`'s `ACTION_ICON` map. That component is ticket 5's, but nothing else in it was touched.
- The ticket count is no longer scoped to the current lap; it counts all work tickets. In `mergeSummary`, the unburned fix tickets are now one line instead of one line per lap.

**Left undone.**
- Two pieces of lap copy remain, deliberately, because both sit in surfaces ticket 5 owns:
  - `burnSummary` in `feature-ui/summary.ts` (the Go dialog) still says "carried from earlier laps" and "lap N — stamped by this click".
  - The orchestrator setting description in `lib/settings.ts` still says "runs laps".
- The inspector's activity feed still draws `lap.started` dividers from historical server events.
- The `next-step` modules are all still imported by `Workspace.tsx`, so nothing is orphaned yet. `ctx.laterLaps` is now unused by the review resolver.
- The `Timeline` primitive is now unused; I did not delete it.
- No screenshots: the sandbox has no running app. I checked styling by reading DESIGN.md, STYLE.md and the design-system READMEs, and verified the markup through tier-1 and tier-2 tests.
- No drive infrastructure changed, so the drive scripts needed no edit.

**Verify.** `bun run typecheck` reports 0 errors. `env -u GIT_ASKPASS bun run test` reports 330 files passed, 4687 tests passed, 0 failed.

#### 10. A chat that is live at Go never loads the lead skill, so the lead runs without its rules (review before ready, runaway guard, drive check)

## What was done
- Go's wake to the feature chat now names the lead skill. `go()` (`packages/server/src/services/features.ts`) used to deliver a fixed "Go given — dispatch round 1…" line. It now sends `goWakeText(runtime)`, a new pure helper in `services/lead-prompt.ts`: "Go given — the human approved the plan. You are now this feature's lead: invoke /runcastle:lead first, then dispatch round 1…".
- The skill is spelled for the runtime of the feature's active chat session (`/runcastle:lead` on Claude Code, `$lead` on Codex). With no chat up it falls back to `DEFAULT_RUNTIME`.
- New tests in `packages/server/test/lead-delivery.test.ts` ("Go, to a chat that planned live") call `go()` on a planning feature with a live Claude Code chat and a Codex chat, and check the queued wake line.
- Gates on the committed work both passed. `bun run typecheck` had 0 errors. `env -u GIT_ASKPASS bun run test` reported 335 files passed and 2 skipped, 4715 tests passed and 48 skipped, 0 failed. That is more than the prompt's stated baseline, which looks stale.

## Repro step
- I could not re-run it here. The sandbox has no runcastle-demo, no running server and no real Claude Code chat, so I could not check a real transcript for a `Skill(runcastle:lead)` call after "Go given".
- What I checked instead: the tests show that the exact text a live chat receives at Go now tells it to invoke `/runcastle:lead`, through the same waiter path the reviewer saw deliver "Go given".
- The `chat` session kind already allows the `lead` entry skill (`entrySkillsFor('chat')`), so the invocation is not denied.
- A real drive still needs to confirm the chat actually invokes the skill.

## Surprises
- None in the code. The old text already carried the `[runcastle]` tag by hand; `tagRuncastlePrompt` adds it once, so behaviour is the same.

## Left undone
- If no chat is up, the headless resume for a Codex-only project gets the Claude Code spelling in the Go text. That resume's own lead system prompt names `$lead` correctly, so I left it.
- Drive machinery: no new service, env var, seed or process, so it is unchanged.

#### 12. Every round silently grows a "Verify the fixes that landed" review pass, doubling small rounds and mislabelling ordinary tickets as fixes

## What was done
- `verificationDue()` in `packages/server/src/workflows/ticket-burner.ts` no longer treats "no review in this run" as a cutoff of −∞. A verification pass ("Verify the fixes that landed") is now due only when implementation work landed AFTER a completed review in the same run. A lead-dispatched round with no review ticket gets no extra worker, and its ordinary tickets are never called "fixes".
- The case where the lead's round has a review followed by fix tickets blocked on it still gets the pass, as before (the existing "second review ticket" test still covers it).
- Tests: the unit test in `ticket-burner-units.test.ts` now says that a review-less round is not due. In `review-ticket.test.ts`, the integration test that asserted the old mint now runs the repro (one trivial ticket through the real scheduler) and asserts that only that ticket exists and that no `ticket.verification_minted` event fires.

## Repro step
I couldn't run the literal repro (runcastle-demo, Go, the agent dispatching) in this sandbox, because there is no app or agent here. Instead I ran its server-side equivalent as the integration test above: a one-ticket round now ends with that ticket only, so the trail would read "Round 1 · 1 worker". Full gates: typecheck 0 errors; the test suite passed (335 files passed, 2 skipped, 0 failed).

## Surprises
- The old test called the review-less mint a deliberate catch for a human who overrode the G3 gate. Go has replaced that path, so I dropped the behaviour rather than keeping it behind a flag.

## Left undone
- The verification mint's own wording ("fixes landed after the review") and the run panel's "Verifying N fixes" copy are unchanged. They are only reachable after a review now.
- I didn't touch the drive machinery; it needs no change.

#### 14. Verify the fixes that landed

Drive verification pass — all six landed fixes hold; one test gate red on a timing test the branch never touched

I drove `feature/the-feature-lead-runs-rounds` at 5e758e5 in runcastle-demo. To exercise the round loop for real, I created a fresh one-ticket feature, "Verify probe: rounds", and kept its chat live through Go. The recording is in `walkthrough.webm` and the screenshots are 01–23 in this folder.

## Fixes

- **#8 Burn wording (held).** Under the ticket list on "Realtime team collaboration": "Edit and Cancel are available on pending and failed tickets until a round dispatches them." On "UX audit" the facts row reads "Round · Failed 5m 21s". The Create menu's New chat says "a conversation that plans the work and runs it in rounds". Go shows an arrow, not a flame. More burn and lap wording survives elsewhere: the Agent tab empty state ("the next burn's tickets"), "1 burning" and the "Burning" status, the run Stop dialog, and the tickets-step warning "Every lap is supposed to end with a review ticket". I filed that as a low observation.
- **#9 Lead tools pre-approved (held).** After Go the lead called `dispatch_round` and later `declare_ready` with no permission prompt; I dispatched a second round the same way. The only prompts were for PowerShell `git` commands the lead ran itself, not runcastle tools.
- **#10 Lead skill at Go (held).** The planning chat was live at Go. Right after the "Go given" Stop-hook feedback, its terminal shows `Skill(runcastle:lead) — Successfully loaded skill`, then the round 1 dispatch. The lead then followed the skill and flagged the missing review before declaring ready.
- **#11 Idle after a stopped or failed round (held).** "UX audit" (failed run, nothing running) reads "Waiting for you · round 1 failed" with no Stop. On the probe feature, Stop during round 2 led to "Waiting for you · stopped" with Stop gone, and it stayed that way after a reload.
- **#12 No silent verification pass (held).** Round 1 ran exactly ticket #1. Its timeline has no verification mint, and the trail reads "Round 1 · 1 worker · 179k tokens".
- **#13 Header refreshes live (held).** None of these needed a reload:
  - After Go the header read "Working · Round 1" and the pipeline showed Build within 3s.
  - After `declare_ready` it read "Ready for you · Test drive ▸ README ends with 'Verify probe A'" with the phase on Review.
  - After Stop → Stop, the autonomy switch flipped to "Ask before each round" within about 5s. The line moved to "Waiting for you · stopped" about 14s later, once the lead's turn on the stop message ended.

## Gates (server run on 5e758e5)

- `bun run typecheck` passed.
- `env -u GIT_ASKPASS bun run test` failed on 1 of 4771 tests. The failure is `pty-teardown.test.ts › returns within the deadline even when killTree never settles`: expected ≥4500ms, got 3487ms, so the teardown returned early, not late.
  - The branch changes nothing under `packages/server/src/pty/` and doesn't touch that test.
  - Ticket 11's digest records the same failure (4171) and the file passing 7/7 when run alone.
  - So this is sandbox timing, not this branch. It still breaks the "fully green" baseline, and I filed it as a medium observation for the human.

## Not exercised

Headless wakes, Codex, and the Ask-mode refusal without a human reply. All wakes I saw were live, on Claude Code.

REVIEW-MODE: drive
REVIEW-VERDICT: verified
REVIEW-REASON: all six fixes held on the live drive; the one red test is a pty-teardown timing assertion in code this branch does not touch

### Lap 2

#### 15. The agent keeps going while you're away: no permission prompts after Go, a guard on your lines, headless and Codex wakes proven

# Ticket 15 — the agent keeps going while you're away

**Reproduction (before any fix, at c33e1437).** Neither CLI is logged in inside this sandbox (`claude -p` → "Not logged in"; `codex exec` → 401), so no real model turn could run. I reproduced at the mechanism level on a scratch data dir with a post-Go feature:
- **Claude Code, headless:** the lead wake launched `claude -p --resume … --permission-mode acceptEdits`, and the pre-tool hook answered `{}` (no opinion) to every git command, `git push origin main` and `git branch -D feature/<slug>` included. So in `-p` any shell command outside the allow list (`git merge`, `git push`, `bun run test`, …) became a prompt nobody could answer, and Claude Code denied it. That is the stall. Nothing guarded the human's lines either.
- **Codex:** `approval_policy = "never"`, `sandbox_mode = "workspace-write"`. There was no prompt and no guard, and the same `{}` came back from the hook.
- `scripts/prove-lead-wake.ts claude-code --only headless`, run for real, showed the plumbing works up to the model turn. `lead.woken_headless` fired, the resumed CLI reported in through SessionStart, and a message sent mid-run resumed the **same** conversation id once the run ended. Then the CLI exited 1 (not logged in). With Codex the resume was refused at launch (`lead.wake_failed`: not logged in).

**What was done.**
- New `launcher/lead-guard.ts` (`evaluateLeadGuard`) is a light shell splitter that reads bash and PowerShell. It denies, with a reason, three acts: writing the base branch (a push refspec naming it, `--all`/`--mirror`, fetch into it, `branch -f`, `update-ref`, `checkout`/`switch` to it); git whose directory (cwd after `cd`/`Set-Location`, or `-C`/`--git-dir`/`--work-tree`) is the main checkout or another worktree under the project's worktrees dir; and deleting the feature branch. Everything it cannot read is allowed. It is table-tested in `test/lead-guard.test.ts`.
- `routes/hooks.ts` pre-tool: the guard runs for every feature chat in every phase. A post-Go Claude Code chat gets `permissionDecision: "allow"` (shape checked against Claude Code's docs), which covers chats launched before Go. Codex keeps answering `{}` (it never asks), but its guard denies still apply.
- `launcher.ts`: post-Go Claude Code feature chats, interactive and headless, launch with `bypassPermissions`. Planning chats are unchanged.
- The proof script's headless wake now has to act: run `git tag` unprompted, get refused on `git branch -D`, and call `declare_ready` (phase → review). The live open must then resume the headless conversation id. It also now fails fast on `lead.wake_failed` instead of hanging.

**Proven live:** nothing on a real model turn. That needs logged-in CLIs. The review should run `bun scripts/prove-lead-wake.ts claude-code` and `… codex` on the host; each covers the headless and live paths. Proven here: the guard and allow answers at the route, the launch flags, and the headless resume and hold plumbing up to the CLI.

**Surprises / left undone.**
- On Linux/macOS a Codex lead in `workspace-write` probably cannot commit at all: a linked worktree's gitdir lives in the main repo's `.git`, outside the writable roots. Windows already runs it with `danger-full-access`. I left Codex's posture as the ticket said; the codex proof's `git tag` step will show whether this bites.
- The SessionEnd hook marks a headless row ended before its process exits, so a message arriving in that gap starts the next resume while the old process is still exiting. I saw it once and it was harmless.
- Interactive `bypassPermissions` shows Claude Code's one-time acceptance dialog if the human never accepted it (the orchestrator has the same exposure).
- No drive machinery change was needed: no new service, env var, seed or process.

#### 16. One feature header, no autonomy switch, tokens recorded but never shown

# Ticket 16 — One feature header, no autonomy switch, tokens recorded but never shown

## What was done
- **Server.** Removed autonomy everywhere: `projects.autonomy`, `features.autonomy`, the `Autonomy` schema and `resolveAutonomy`, the project settings descriptor, trpc `feature.setAutonomy`, the context field, and the Ask-mode refusal. Added `features.stopped_at`. Migration `0047_clear_betty_brant.sql` is one migration: it drops both columns and adds `stopped_at`. drizzle-kit's rename-or-drop question needs a TTY, so I generated the migration in two non-interactive steps and merged them into one file, one snapshot and one journal entry; `db:generate` then reports no changes. Stop now sets `stoppedAt` and `waitingReason: 'stopped'` and tells the lead. `dispatchRound` refuses with "Stopped by the human — wait for their reply" until `lastHumanMessageAt > stoppedAt`, and `markHumanMessage` clears the mark. `get_feature_context` gains `stopped: boolean`.
- **Tokens.** Removed from every read: `RoundSummary.tokens`, `FeatureFull.tokensTotal`, `Ticket.tokens` and `SessionRow.tokens` on the wire, `leadUsageReader` and `featureTokensTotal`. Recording is unchanged: the DB columns, breakdowns, burner harvest and round-end refresh. `getFeatureFull` still calls `refreshLeadTokens(lazy)`, so lead-session tokens keep being recorded on read as before.
- **Lead skill.** Ask mode is replaced by §4 "When to ask": carry on through what the plan settled, ask with `wait_for_you` before what it did not, and wait after Stop.
- **Web.**
  - The header is now the title, the meta line, and the status line's action row. `featureStatus` now returns `primary` (go / testDriveStart / testDriveStop / stop); this is unit-tested in `status-line.test.ts`.
  - `leadActions(ns, status)` builds that primary, keeps Merge & ship as the one inline secondary, and sends the rest to "⋯" via `OVERFLOW_KINDS`. Stop is a new `stopAgent` action kind with its own `StopAgentDialog`.
  - Removed:
    - PipelineStepper, LiveSessionBar and `pipelineSteps`;
    - the autonomy switch and the Project-settings "Default autonomy";
    - token figures and `fmtTokens`;
    - the StatusStrip fact list in RunBody and ReviewBody.
  - The walkthrough warning now shows in the header only when the primary is Start test drive. The Notes section and composer show only while driving or after a ready declaration (`notesOpen`).
  - Reworded the listed burn/lap copy, plus lane and ticket "Burning" labels, the run headline (Ran/Running), the run header's Stop round dialog, notifications, a few empty states and the merge warning.
- **Reproduction.** I first wrote `apps/web/test/feature-page-header.test.ts` against the old components. It failed on the review-phase header: the stepper rendered, and so did the autonomy switch, "1.7M tokens" and the Agent button. The test now asserts the target header.

## Surprises
- The Agentic review button lived only on the StatusStrip. With the strip gone, it remains only in the "nothing verified" and denied-drive notices.
- The run header hides the headline parts the old Status tier used to say. I kept that filter, since the lanes say them now.
- I did not run the app, take screenshots or drive the light/dark critique: this sandbox has no services. All checks are tier-1 and tier-2 tests.

## Left undone
- Some text in ticket 15's files is now stale, and I left it to avoid conflicts. `launcher/artifacts.ts:465` (the lead system-prompt rule) still says `"Ask before each round" mode`. `lead-delivery.ts:27` and `lead-prompt.ts:4` have stale "Ask-mode" comments.
- `grep -rniE "burn|lap" apps/web/src` still finds copy outside this ticket's list:
  - the Settings "Burns" page and AFK-burn wizard;
  - the next-step resolver titles (hidden behind the status line on started features);
  - the sidebar "review & burn tickets" label;
  - `BURN_EXPLAINER`'s name.
- `phaseSummary` (lib) is now used only by its test. The shipped page still shows its StatusStrip, kept as a history record.
- Drive machinery: no new service, env var, seed or process, so nothing to update. The migration is applied by the existing boot migrate.

#### 18. The headless wake starts a fresh conversation instead of resuming the agent's own: one timed-out SessionStart hook leaves the chat with no recorded conversation id

# Ticket 18 — the headless wake resumes the agent's own conversation

**What was done.** Fixed the chain at three points, plus the banner the reviewer saw:
- `hook-client.ts`: `session-start` is now retried (3 attempts × 5s, 0.5s pause) via a new exported `postHook`; every other hook keeps one 3s attempt, since it blocks a turn or a tool. The SessionStart hook timeout in `renderSettings` went from 10s to 20s to fit the retries. Codex's hooks.json declares no timeout, so its defaults already cover it.
- `routes/hooks.ts`: a new `checkInFromTurn` takes `session_id` / `transcript_path` from `user-prompt` and `stop` too. If a row never checked in, the first turn hook marks it live, records the id, emits `session.started` once and kicks queued lead messages. It also refreshes an id left stale by a missed `/clear` start. Ended rows stay ended.
- The wake no longer claims a resume that did not happen. `LaunchSessionResult` now carries `resumed`. `leadWakeKickoff(message, resumed)` says "started this conversation headless from the feature docs" when nothing could be resumed. `lead.woken_headless` carries `data.resumed`, and its message says the same thing. The headless brief section is worded neutrally. The chat kickoff header is now built after the resume decision in `launchSession`.
- Web `sessionNotReady` now clears on `session.started`, so a late check-in removes the false "Not ready" banner.

**Repro re-run.** I could not re-run the reviewer's drive repro: this sandbox has no runnable app, Claude Code login or drive DB. I covered each link at its seam instead, with known-good tests:
- a timed-out session-start is retried;
- a session whose start hook never arrived gets its cc id from the first turn hook;
- a wake with no recorded conversation says it started fresh;
- a wake with a recorded one resumes it (`-p --resume`).

The live chain (start hook timeout → End session → round end → `--resume`) still needs a drive to confirm.

**Surprises.** None in the engine. `markSessionEnded` leaves `ccSessionId` undefined rather than null on a row that never checked in.

**Left undone.** I did not touch the drive machinery: no new service, env var, seed or process. Codex: I assumed its turn-hook payloads carry `session_id` the way Claude Code's do (its hook protocol is Claude-shaped). That was not verified live.

Gates: `bun run typecheck` clean; `env -u GIT_ASKPASS bun run test` green (338 files, 4739 passed).

#### 21. The status line says "Working · Round N" for good once a round succeeds and the agent's turn ends without a new declaration — nothing is running and nobody is working

## Ticket 21: an idle agent after a succeeded round reads "Waiting for you", not "Working"

**What was done.** In `apps/web/src/lib/feature-ui/status-line.ts`, `statusOf()` used to fall back to "Working · Round N" whenever the last round had succeeded and no ready declaration was newer than it. Only failed and cancelled rounds got the "agent idle → Waiting for you" branch. Now any round that has returned, with the agent's turn over (`agentWorking` false), reads "Waiting for you · round N done". Failed rounds still read "round N failed" and cancelled ones "stopped". There is still no primary button in this state, as decision 24 says. "Working · Round N" now shows only in three cases: a round is running, the agent is mid-turn, or Go was just given and round 1 has not been dispatched yet (no rounds at all).

**Tests.** `apps/web/test/status-line.test.ts` gained a case for building and review features with a succeeded round and an idle agent. The "round dispatched after the declaration" case now checks both sides: an idle agent waits, a working one reads Working.

**Repro re-run.** The sandbox has no app or live agent, so I could not re-run the repro in the UI. Instead I ran its two states through `featureStatus` in tests:
- "Lead probe": building, round 2 succeeded, session `awaitingInput` → `agentWorking` false. It now reads "Waiting for you · round 2 done".
- "Entry tags": review, one succeeded round, no declaration. It now reads "Waiting for you · round 1 done".

Typecheck passed with 0 errors. The full suite is green: 337 files passed, 2 skipped.

**Surprises.** None. `agentWorking` comes from `Workspace.tsx` as `!!liveSession && !liveSession.awaitingInput`.

**Left undone.**
- On "Entry tags", Start test drive stays in "⋯". Decision 24 makes it the primary only once the lead has declared ready, so I left it there.
- With no rounds and an idle agent, the line still reads Working, because the wake after Go may not have reached the agent yet.

Drive machinery: no change needed (web-only derivation).

#### 23. Server-written strings still put "lap" in front of the human: the agent's kickoff line in the Agent tab, and the "Agentic review — lap N" ticket title

## What was done
- `chatKickoffHeader` (launcher.ts) no longer says "lap N". It now reads "Feature state: <phase>; rounds run: <runs>; tickets: …", taking the round count from the feature's runs, as the ticket suggested.
- The Agentic review ticket is now titled plain "Agentic review". Its goal and acceptance criterion say "the feature's landed work" instead of "this lap". The `review.agentic-minted` event message drops "for lap N". The `lap` stays in that event's data, which is machine-only.
- The `note.added` event messages are now "note captured" and "review agent captured a note". In the outcome doc, a carried note now reads "carried forward".
- Beyond the cited lines: the SessionStart hook context (routes/hooks.ts) also gave the agent "lap: N", which it would repeat in the same way. That is removed too, along with its old ADR-0010 comment.
- Tests: the self-plan launch, chat-contract and hooks-route tests now assert that "lap" is absent and that the round count is present. burn-robustness pins the minted ticket's title. The outcome test was updated.

## Repro re-run
There is no app or browser in this sandbox, so I could not open the Agent tab live. I re-ran the repro at its seams instead:
- I read the kickoff line `chatKickoffHeader` builds for a review feature with lap 3 (chat-contract.test) and the full launched self-plan command (self-plan-launch.test). Neither contains "lap" now; they read "rounds run: N".
- I triggered `agenticReview` (burn-robustness.test). The minted ticket's title is "Agentic review".
- typecheck is clean. The full suite passes: 340 files, 4743 passed, 48 skipped.

## Left undone
- The outcome doc (outcome.ts `composeOutcomeDoc`) still writes "Laps run: N" and "### Lap N" sections. Decision 16's "shipped history reads as rounds" calls for rewriting it, which is bigger than this ticket.
- apps/web/test/chat-notices.test.ts still uses "Agentic review — lap 1" as a fixture title. It is only test data, so I left it.
- No drive machinery changed.

#### 24. Verify the fixes that landed

Drive verification pass — #17's six fixes all held in the running app; the tour turned up one new defect in the wake path and three observations

I toured the branch in a drive against runcastle-demo. The tour covered Settings, the Entry tags header, a new feature taken from planning through Go and round 1, Stop with the agent closed and then open, a test drive with Send to agent, and Agentic review. The recording runs the whole way: `walkthrough.webm`.

## The fixes

- **#18 (headless wake resumes the agent's own conversation): held.** The new chat recorded its conversation id at check-in. With the agent closed, the wake resumed that conversation headless instead of starting fresh: `session.resumed` named the same id (73f5d01d…), and `lead.woken_headless` carried `resumed: true`. The agent acted on the wake itself (`wait_for_you`), and reopening the Agent tab resumed the same conversation again. The round that should have triggered the wake hung (see below), so I triggered it with Stop instead; that goes through the same wake code. I did not force a slow SessionStart reply live; the retry and the turn-hook check-in are covered by the fix's own tests.
- **#19 (Send to agent during a drive): held, as scoped.** The repro was Entry tags with its agent closed, a test drive, a note, then Send to agent. The wake was no longer refused: a talk worktree was added for the drive and parked, `lead.woken_headless` fired, and there was no `lead.wake_failed`. Stopping the drive put the checkout back on main and released the worktree. **The note still never reached an agent**, though, for a different reason: see the defect below.
- **#20 (Stop survives runcastle's own wakes): held.**
  - Unit level: `isRuncastlePrompt` returns true for the reviewer's wrapped Stop text, and false for typed text.
  - Live: with the agent open and idle, Stop gave `lead.message_queued` (waiter) then `lead.woke` (waiter), with no `lead.human_message`. `stopped_at` stayed set and `waiting_reason` read "stopped".
  - Headless: the Stop notice's wake also left the mark in place.
  - Entry tags read "Waiting for you · stopped" afterwards.
- **#21 (status line after a finished round): held.** Entry tags reads "Waiting for you · round 1 done", not "Working".
- **#22 (Settings wording): held.** The tab is "Workers". General, Models, Workers and This project contain no burn or lap words. Verify now says runcastle runs the commands itself at the end of every round and hands the results to the agent. The orchestrator text says "gives them Go, drives them".
- **#23 (lap in server-written text): held.**
  - The agent's kickoff line reads "Feature state: planning; rounds run: 0; …".
  - The SessionStart context has no lap.
  - A minted Agentic review ticket is titled plain "Agentic review".

## New on the tour

- **Defect (medium): a headless wake can lose the message.** It "resumes" a conversation whose transcript no longer exists. On Entry tags, the 95-day-old conversation id is gone from `~/.claude/projects`. `claude -p --resume` exits 1, yet the wake was already logged as `lead.woken_headless {resumed:true}` and the lines were taken. There is no `wake_failed`, no requeue, and the drive's stop finds nothing to retry. The panel says "Sent to the agent", but the note is lost. The Stop notice was lost the same way.
- **Observation: Go never reached the live agent.** `lead.message_queued` (waiter) was logged, but `lead.woke` never came, and the line was gone from the store. The likely cause is the waiter route's `emit` failing on "database is locked" after it took the lines. The drive DB has no `busy_timeout`, and transient locks appeared several times. My own read-only DB polling may have added contention. I relayed Go by typing in the chat.
- **Observation: a round hung and could not be cancelled.** Verify probe's round 1 never got past `run.started`. Stop logs `round.stopped` but leaves the run row "running", so the header stays "Working · Round 1" with Stop showing. Possibly environmental; another run (the agentic review) cancelled cleanly.
- **Observation: Agentic review moves a review-phase feature back to building.** It goes through the old `burn()` path, emits no phase event, and its event text reads "burning tickets — lap 1". This path predates these fixes.

## Gates

The server's gate run on `49505f9`:
- `bun run typecheck` passed.
- `bun run test` passed: 338 files, 2 skipped.

That is in line with the green baseline; nothing failed.

REVIEW-MODE: drive
REVIEW-VERDICT: verified
REVIEW-REASON: All six landed fixes held in the drive; the new findings are outside their scope

### Lap 3

#### 25. A headless wake never loses the message it carries: no resume of a vanished conversation, requeue when the process dies early

# Ticket 25 — a headless wake never loses the message it carries

**What was done.**
- Committed the reproduction first, failing (abfa477e, `headless-run-launch.test.ts`, "starts fresh when the conversation's transcript is gone…"). An earlier chat's `transcriptPath` points at a missing file, a drive note is pending and no agent is open. Before the fix the wake ran `claude -p --resume cc-expired`, and when the process died the note was gone.
- `launchSession` now checks a chat's prior conversation with `resumeGoneReason` (launcher/sessions.ts) before passing `--resume`. The conversation counts as gone if its recorded transcript is missing, or (Claude Code only) if it was recorded in a different worktree. Paths are compared resolved, and case-folded on Windows. A gone conversation starts fresh from the docs and emits `session.resume_gone`. A row with no recorded transcript path is resumed anyway (it can't be checked), the same way `transcriptBytes` treats it. A new `fresh` launch input skips resuming.
- `wakeLeadHeadless` now holds the lines against the session it launched instead of handing them over:
  - `session.started` releases them, as does a clean exit 0.
  - An exit with a non-zero or unknown code before check-in puts them back first in the queue and emits `lead.wake_failed` with `{sessionId, exitCode, failures}`. So does a spawn failure inside the launch.
  - The first failure is retried immediately, fresh from the docs. After that, the feature's own exits trigger nothing; only a real trigger retries (a new message, or a drive stopping). That stops a tight relaunch loop.
- UI: a new `notes.delivery` query returns `{waitingSince, lastFailure}`.
  - A sent note reads "Waiting for the agent" until an agent takes the message.
  - The Send to agent line, its toast (using a new `waiting` field on `notes.send`) and a warning line show the queued state and any failed wake.
  - A message queued for a live lead's turn end counts as received.

**Surprises.**
- `lap-kickoff.test.ts`'s prior chat used the fake worktree path `'w'`. The new other-worktree rule read it as unresumable, so the fixture now uses the feature's real worktree.
- Five web test files mock trpc by hand and needed `notes.delivery` added.

**Repro re-run.**
- In this sandbox, `claude -p --resume <unknown id>` exits 1 with "No conversation found", which is the review's failure.
- I could not run the full app repro (Windows host, drive, Send to agent) here. The repro test drives the same path through the real `launchSession` and `handlePtyExit`: no `--resume`, then an early exit, then `lead.wake_failed`, then a second fresh launch carrying the note.
- No drive machinery changed: no new service, env var or seed.

**Left undone.**
- The `notes.sent` event text still says "sent to the agent" (it describes the act of sending).
- Delivery state lives in memory, like the queue it describes.
- The review's other open observations (a Go wake dropped on a locked database, a hung round Stop could not end, Agentic review moving review back to building, Codex not exercised) are untouched, per decision 28.

#### 27. A headless wake's check-in is swallowed on a locked database, then the ready-watchdog's own write crashes the whole server

# Ticket 27 — a locked database no longer swallows a check-in or crashes the server

**What was done.** The fix makes three changes, all in commit 0c619320:
- (a) `db/client.ts` sets `PRAGMA busy_timeout = 5000` (`BUSY_TIMEOUT_MS`). A write that meets another connection's lock now waits for it instead of failing at once with SQLITE_BUSY.
- (b) `armSessionReadyWatchdog` (launcher/sessions.ts) wraps its timer body in try/catch, moved into `warnIfNotReady`. If the `session.not_ready` emit fails, the error is logged and the server keeps running.
- (c) The hooks route's catch-all no longer swallows errors silently. It logs every failed hook. For a failed `session-start` it also records `session.checkin_failed` on the timeline, best effort, with the reason. As before, the session's first turn hook (`checkInFromTurn`) checks it in, and that releases the wake's held messages.

Tests: `test/session-ready-watchdog.test.ts` covers the warning, and a failed write that is logged instead of thrown out of the timer. A new case in `hooks-route.test.ts` covers a failed SessionStart write: the hook still answers `{}`, the `session.checkin_failed` event appears, and a later Stop checks the session in with a single `session.started`.

**The repro step, re-run as far as the sandbox allows.** The full repro needs things the sandbox doesn't have: a drive, the runcastle-demo project, a real `claude` CLI and a browser. So I did not run feature.stop against a drive server. I ran its pieces instead:
- Using bun:sqlite, a second process took a lock on a database opened through `createDb` (`BEGIN IMMEDIATE` held for 800ms). The server connection's write waited about 555ms and then succeeded, where before it would have thrown "database is locked". `PRAGMA busy_timeout` reads back 5000.
- In the watchdog test, the emit throws "database is locked" inside the timer, and advancing the timers no longer throws.
- In the hooks test, the SessionStart failure is now visible on the timeline.

The review's live drive repro should still be run once by a human.

**Gates.** `bun run typecheck` passed with 0 errors. `env -u GIT_ASKPASS bun run test` passed: 339 files, 4761 tests, 0 failed. The baseline in the prompt was stale (118 files); this run had more tests and none failed.

**Surprises.** A clean headless exit already counts held messages as delivered, and a non-zero exit puts them back on the queue. So once the crash is gone, a silently failed check-in duplicates a message at worst rather than losing it. The real loss came from the crash wiping the in-memory held wakes.

**Left undone.**
- The other bare timers and fire-and-forget paths in the server were not audited for uncaught throws.
- No process-level `uncaughtException` guard was added.
- Held wakes still live only in memory, so a server restart still drops them.

Drive machinery: no change needed. There is no new service, env var, seed or process.

#### 28. Verify the fixes that landed

Drive verification pass — #27 held: a locked database no longer swallows a check-in without a trace or crashes the server

All three parts of ticket 27's fix held on a real drive of Entry tags in runcastle-demo. I closed the agent and held a second connection's write lock (`BEGIN IMMEDIATE`) on the drive's runcastle.db, then pressed Stop through `feature.stop`, the call the button makes. I ran three lock patterns. In none of them did the server exit; the same server process (PID 46688) answered before, during and after.

- **(a) The server waits out a busy database.** Run A held the lock in repeated 3-second bursts across the whole wake. Every write waited instead of failing. The agent was started fresh from the docs (`session.resume_gone`, `lead.woken_headless`), checked in normally (`session.started`), set "Waiting for you · stopped: review round proposed", and exited with code 0.
- **(c) A failed check-in is now visible.** Run B held the lock for 9 seconds starting at `session.launched`, so the SessionStart write itself failed. The timeline now shows `session.checkin_failed`: "the agent started but runcastle could not record it (database is locked) — its first turn will check it in". `session.started` followed, and the agent acted on the Stop notice.
- **(b) The ready-watchdog no longer crashes the server.** Run C held the lock for 40 seconds from launch. That covered the SessionStart hook, its best-effort `checkin_failed` write and the 25-second watchdog, while the session was still 'launching' with its terminal alive. That is the exact write that crashed the server in lap 3. The server survived. When the lock lifted, the session was checked in by its first turn ("checked in by its first turn — its start hook never arrived"), the agent set its status and exited cleanly. As designed, nothing records the watchdog's or the check-in's failure when the lock outlasts both writes; they are only logged to the dev pane, which I could not read from here.

One step of the repro did not apply as written. No Entry tags conversation could be resumed in the drive's worktree, so I did not need to move a .jsonl aside: run A started fresh and runs B and C resumed run A's conversation. No transcripts were moved, so there was nothing to restore.

**Gates.** `bun run typecheck` passed. `env -u GIT_ASKPASS bun run test` FAILED on one test out of 4761, `pty-teardown.test.ts:138`. That test asserts a 5000ms timeout took at least 4500ms by `Date.now()`, and it read 3406ms although the timer fired. So the sandbox's wall clock stepped back about 1.6s mid-test. The branch changes nothing under `pty/` or in that test, and ticket 27's own gate run of the same commit was fully green. I reported it as an observation: the gate needs a re-run, and nothing in the landed fixes explains it.

**Also seen** (observation): because bun:sqlite's busy wait is synchronous, a lock held longer than 5s now freezes the server for up to 5s per write instead of crashing it. In run C the drive server didn't answer HTTP for about 20s, then recovered by itself.

Nothing else was plainly broken on the tour. The Agent tab showed the woken agent's replies. It remarked on being woken three times by the same Stop notice; those were my three Stop presses, not a bug.

Evidence: walkthrough.webm (one continuous recording), plus 01-entry-tags-before.png, 02-after-stop-runA.png, 04-after-runC.png and 05-agent-tab.png. The drive is stopped, and both the runcastle and runcastle-demo checkouts are back on main and clean.

REVIEW-MODE: drive
REVIEW-VERDICT: verified
REVIEW-REASON: all three parts of #27 held on the drive; the one red test is a pty-teardown timing test outside the diff, failed by a clock step in the gate sandbox
