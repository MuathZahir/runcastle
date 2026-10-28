# Outcome — Whole cuts plan themselves

Features start planning with nobody on the page, so a cut made by the project session comes back as previews; plus the rest of the scope deferred from Features plan themselves.

- Shipped: 2026-10-17
- Laps run: 2

## What shipped

40 commits · 68 files

### Lap 1
- 7 tickets landed: #1 The orchestrator mode: setting, ownership and the orchestrating launch; #2 Headless runs on a feature: relay a message, plan a lap; #3 Orchestrator tools: read, plan, burn, drive, note, merge, brief; #4 Tell the orchestrator what happened on its features; #5 The Orchestrator setting and the Orchestrated marker in the web app; #6 Skill text: the orchestrator's judgement, and the changed-by-the-orchestrator mark; #8 The orchestrator's own merge_feature result is repeated as a [runcastle] line in its terminal
- 0 waived
- 0 failed

### Lap 2
- 8 tickets landed: #10 Deliver orchestrator notifications through each CLI's own channel, never typed into its terminal; #11 Mark an orchestrated feature with a second ring on its sidebar glyph; #12 The working agreement: the orchestrator asks how to run each cut before it starts; #14 Claude Code: two events ending 19 ms apart reach the orchestrator as two separate wakes, not one message; #15 add_to_brief refuses drafts, so a handed-over or waiting draft can never take the human's later intent or a changed working agreement; #16 Working agreement: offered two shapes instead of three on the first cut, and was never asked on the second cut; #17 A waiting orchestrated draft's sidebar title is still clipped to "See…" (34 of 169 px), because the "Waits on …" meta never shrinks; #18 Codex: two events ending 35 ms apart go as two `codex queue` messages and two orchestrator turns, not one message
- 0 waived
- 0 failed

## Review record

### Lap 1 · review

- Reviewed commit: 8ed28bfd12ff66fb129d2cdba3506f7790eb443f
- Landed since: 9
- Outcome: done

### Lap 1 · verification

- Reviewed commit: 491a4587da117b58b030b96a9d3be33a77d2d779
- Landed since: 8
- Outcome: done

### Lap 2 · review

- Reviewed commit: 11aa86e128639d1ec35b9d3b1e19baad5084c994
- Landed since: 5
- Outcome: done

### Lap 2 · verification

- Reviewed commit: 5e5c8d7c217eb2977237351df01e54fa760e395e
- Landed since: 0
- Outcome: done

- **Sidebar burn counts now clip beside a long title ("1/1" shows as "1…", "0/10" as "0/…")** — open
- **Codex on Windows: a batched notification keeps only its first line, so the orchestrator silently misses events** — open
- **add_to_brief on a draft with no parked brief makes Start's brief.md only the orchestrator's section** — open

## Notes record

- This is sent as a normal message.. Will this work if I'm outside of the tab or working on a different project in runcastle, etc..? — carried → lap 2
- I feel like this is kind of annoying. I left the agent expecting to come back to a fully working snake game with all the requirements, but it just finished the core and asked me to test. I feel like we might have to change the prompt at the beginning so it asks the user how they want to structure work. Maybe completely autonomous or with some checkpoints, etc.. — carried → lap 2
- The orchestrated tag doesn't look perfect, it's taking too much horizontal space. If we can somehow represent this in a different way (maybe change the icons showing the state to have a double ring or something else) — carried → lap 2
- The extra ring showing that this feature is orchestrated is not obvious enough and doesn't look good. I want it to stand out more somehow — open
- Also, I would like the orchestrator setting to not be in the settings page. I want it to be visible somewhere on the screen. Maybe the sidebar or the project session page. It should standout a lot and feel like a "powerup" or something — open

## Per-ticket digests

### Lap 1

#### 1. The orchestrator mode: setting, ownership and the orchestrating launch

# Ticket 1 — the orchestrator mode: setting, ownership and the orchestrating launch

**What was done**
- One migration (`packages/server/drizzle/0045_nappy_adam_destine.sql`) adds `features.orchestrated` (not null, default false), `sessions.headless` (not null, default false) and `projects.orchestrator` (nullable boolean). `SessionPurpose` gained `orchestrate` and `relay`. `Feature.orchestrated` is `z.boolean().default(false)`, `SessionRow.headless` is optional, and `Project.orchestrator` is optional. All three are mapped in `services/repo.ts`. The test fixture `seedFeature` accepts `orchestrated`.
- Setting: a project-only `orchestrator` descriptor (boolean, default false). Project override values are now `string | boolean | null`, and a boolean is written as a boolean rather than `String(value)`. That matters because drizzle's boolean mode would store the string "false" as 1. `orchestratorOn(ctx, projectId)` in `services/settings.ts` is the single reader.
- Launch: `launchProjectSession` reads the setting. When it is on and the launch is not triage, the session gets purpose `orchestrate`, runs with `bypassPermissions`, and its brief carries `orchestrate: true` plus the `catchUp` lines. On Codex, `bypassPermissions` maps to approvals `never` and `danger-full-access` on every platform. `renderProjectPrompt` inserts an `## Orchestrating` section (constant `ORCHESTRATING` in runtimes/skills.ts) just before `## Your task`. A test checks that removing that section gives the ordinary prompt byte for byte.
- Sockets: `services/orchestrator-notify.ts` exports `orchestratorCatchUp`, which returns [], and `startOrchestratorNotifier`, a no-op called at boot in index.ts. `mcp/orchestrator-run-tools.ts` exports `registerOrchestratorRunTools`, which registers nothing yet. Both registration functions are called at the end of `buildMcpServer` with `(server, wants, resolveCtxSession)`. `HeaderCarrier` is now exported from server.ts. TOOL_AUDIENCES already lists all 11 orchestrator tools for `['project']`.
- Gate: `mcp/orchestrator-tools.ts` exports `requireOrchestratorSession`, which returns the projectId, `requireOrchestratedFeature`, `orchestratorTool`, `toolTakeOverFeature` and the `take_over_feature` registration. The actor stamp lives in `services/events.ts` (`runAsActor`, an AsyncLocalStorage). `orchestratorTool` wraps it. It merges `actor: 'orchestrator'` into object or empty data and leaves array or scalar data alone.
- Ownership: `markOrchestrated(ctx, featureId, 'created' | 'taken over')` in `services/repo.ts` emits `feature.orchestrated`. `toolCreateFeature` calls it after creating when `session.purpose === 'orchestrate'`, for all three shapes. The `get_project_context` index lines end with ` · orchestrated` for owned features.

**Deviations / surprises**
- "Session is live" is enforced as "not ended": a `launching` row is accepted, so a Codex session whose start hook never fired can still act. Tighten to `status === 'live'` if wanted.
- The feature gate refuses with a GateError for an unknown slug too (not NotFoundError).

**Left undone**
- Drive machinery: nothing to change. There is no new service, env var or seed, and the migration is additive. I did not run the drive scripts.
- Web settings toggle, Orchestrated marker, `headless` writes, the notifier and the catch-up are other tickets.
- Full checks: `bun run typecheck` passes, and `bun run test` gives 321 files passed, 0 failed.

#### 2. Headless runs on a feature: relay a message, plan a lap

# Ticket 2: headless runs on a feature (relay, and a lap that plans itself)

**What was done**
- `createSessionRow` takes `headless` and writes it, and every headless launch passes it: self-plan, relay, and headless start-lap. FeatureFull's sessions already carried the column through `rowToSession`.
- `launchSession` has two new inputs, `message` and `headless`. `isHeadless(input)` covers the three purposes. `assertHeadlessRunnable` gives three refusals, each as a GateError: a relay without a message, a headless start-lap away from review, and either kind while another session is live. A headless start-lap does not end a live chat; it is refused instead.
- Relay and headless start-lap resume the latest chat conversation through the ordinary chat path. Self-plan still never resumes.
  - Claude headless now keeps `--resume`, giving `-p --resume <id> … <kickoff>`.
  - Codex headless resume is `exec resume --dangerously-bypass-hook-trust <id> <kickoff>`. I checked the order against `codex exec resume --help` on codex-cli 0.155.1 (`[OPTIONS] [SESSION_ID] [PROMPT]`, and the flag is accepted there).
- Kickoffs:
  - `relayKickoffFor(runtime, message)` is in runtimes/skills.ts.
  - `headlessLapKickoff(lap, runtime, carried, message)` is in launcher/sessions.ts. It reuses `lapAgenda` and has no interview.
- Injected prompt: `renderRevisitPrompt` gains a `## No human is present` section (`headlessRunRule`) and a headless task line, keyed on `session.headless`. A relay always renders the revisit prompt.
- Exit: `handlePtyExit` emits `session.run_ended {sessionId, purpose, complete, exitCode}`. self-plan keeps `session.self_plan_ended`.
- MCP: `toolSendToFeature` and `toolStartFeatureLap` live in mcp/orchestrator-run-tools.ts, gated by `requireOrchestratedFeature`. `ok` and `noSession` are now exported from orchestrator-tools.ts. Each tool takes an optional `LaunchSessionOptions` so tests can use `spawn:false`.
- Web:
  - `isHeadlessRun` (true when `headless` is set, or for a self-plan row) and `unfinishedRuns(events)` are in lib/feature-ui/session.ts.
  - New `next-step/headless.ts` (`resolveHeadlessRun`) runs before every state's resolver. It shows the working bar with Stop for each purpose, in its own words. After a relay or lap whose `run_ended` said `complete:false`, it shows a stopped-short bar (planning and review only).
  - The self-plan working bar moved there unchanged. Its stopped-short bar stays in planning.ts.
  - The action kind `stopSelfPlan` was renamed to `stopSelfPlan`.
  - FeatureChat and the Workspace Chat door refuse for any headless run.

**Deviations and surprises**
- **Lap completeness:** a lap counts as complete when the feature has pending tickets at exit. The ticket suggested `ticketsReadyLap === lap`, but that is always true at review: a lap planned at review never calls `complete_phase`, and lap N already stamped `ticketsReadyLap`.
- **Stopped-short bar source:** the web cannot see exit codes, so the stopped-short bar reads `session.run_ended` events, passed as `NextStepContext.unfinishedRuns` from Workspace.
- **Changed tests:** two argv tests in launch-artifacts.test.ts pinned "headless never resumes". I updated them to the new contract and added tests for the resume form.

**Left undone**
- No `EVENT_LABELS` or activity wording for `session.run_ended` in apps/web/src/lib/activity.ts.
- The tRPC `launchSession` route does not accept `message` or `headless`, so the browser cannot start these runs. Only the MCP tools can.
- Drive machinery: no new service, env var, seed or process, so nothing to change. I did not run the drive scripts.
- Checks: `bun run typecheck` is clean. `bun run test`: 324 files passed, 2 skipped, 0 failed.

#### 3. Orchestrator tools: read, plan, burn, drive, note, merge, brief

# Ticket 3 — orchestrator tools: read, plan, burn, drive, note, merge, brief

**What was done**
- I added eight acting tools to `packages/server/src/mcp/orchestrator-tools.ts`: `start_feature`, `plan_feature`, `stop_feature_run`, `burn_feature`, `drive`, `record_test_note`, `merge_feature` and `add_to_brief`. Each one is an exported `tool*` const wrapped in `orchestratorTool`, so every event it emits carries `actor: 'orchestrator'`. Each is gated by `requireOrchestratedFeature`. `drive` without a slug uses `requireOrchestratorSession`. One small `acting(name, config, tool)` helper registers all of them. It needs one `as never` cast, with a comment, because the SDK's callback type is conditional on the input shape.
- `toolPlanFeature` takes an optional 4th argument, `LaunchSessionOptions`, so tests can pass `{ spawn: false }`. This is the same seam `launchSession` already has.
- `drive` returns the drive's `TestDriveResult` unchanged. The one-drive-at-a-time refusal comes back as `ok: false` with `deniedReason`, exactly as the button receives it. It is not thrown.
- The merge body moved into `services/merge.ts` as `mergeFeatureFlow(ctx, featureId)`. The tRPC `feature.merge` route now calls it, and the router's merge tests still pass. The tool returns `{ ok, conflict, base, files }`.
- `add_to_brief` appends `## Added by the orchestrator, YYYY-MM-DD` and the text to `brief.md` in the talk worktree. It then commits with `git.commitDocs` and the message `runcastle: add to <slug> brief`, runs `landChatCommits` (which lands the commit when a burn holds the branch), and emits `brief.added`. It refuses a draft (through `requireNotDraft`) and a feature that has no worktree.
- Feature reads from the project session: the four read tools now list `'project'` as an audience. When `buildMcpServer` builds for the `project` audience, they are registered with a required `slug`. That slug is resolved by the new exported `projectFeatureReader`, which accepts any feature in the caller's project and does not check ownership or the mode. Every other audience gets the same schema as before, and a test checks this through `tools/list`. I updated `mcp-tools.test.ts`, which had asserted that the project session gets no `get_feature_context`.

**Surprises**
- No code writes `sessions.headless` yet. The self-plan launch passes `headless` to the adapter, but not to the session row. So `stop_feature_run` treats a row as stoppable if `headless` is set **or** its purpose is `self-plan`. Whichever ticket starts writing the column (relay or headless lap) can keep this check as it is.

**Left undone**
- `requireFeatureId`'s refusal text still tells a project session to "tell the human to open its terminal". It is no longer reached for the reads.
- No drive machinery changed: no new service, env var or seed.
- Checks: `bun run typecheck` is clean. `bun run test`: 323 files passed, 2 skipped, 0 failed.

#### 4. Tell the orchestrator what happened on its features

**What was done**
- Filled `services/orchestrator-notify.ts`. A pure `orchestratorLineFor(event, state)` covers each event kind, and the module's header comment has a table mapping event types to end/act. `startOrchestratorNotifier` subscribes to the live bus. For each signal it finds the project's live `project` session with purpose `orchestrate`, reads the event row, builds the state (feature, session from `data.sessionId`, ticket) and types the line through `writeToLiveTerminal`. Everything sits in a try/catch and nothing is retried. `orchestratorCatchUp` lists end events on owned features since the most recent ended `orchestrate` session's `endedAt`, oldest first, without the prefix. It returns nothing when there never was such a session, and caps at 50 lines followed by "…and N more — read get_project_context".
- End events: `session.self_plan_ended` (data.complete), `session.run_ended` (written as data.complete; ticket 2 must emit that shape), `run.finished`, `ticket.done`/`ticket.failed` only for review-kind tickets (passKind tells review from verification), `feature.shipped`, `merge.conflict`, `testdrive.dev_failed`. Act events: `session.launched` (start-lap purpose reads as "started the next lap"; a headless session reads as "had it plan itself"), `session.pty_exited` for sessions with a terminal, `burn.started`/`burn.restarted`, and `testdrive.started`/`.stopped` (the review agent's drives are skipped). The stop line comes from project `settings.updated` with key `orchestrator` and value false or null.
- Two small production edits outside the notifier: `writeToLiveTerminal` in launcher.ts is now exported, and `getEventRow(ctx, id)` was added to services/events.ts.
- Tests: `packages/server/test/orchestrator-notify.test.ts` has 67 tests: table tests, wiring with a faked `ptyRegistry().get`, catch-up over seeded events, and the rendered prompt section. Full typecheck passes and the full suite passes (323 files).

**Surprises**
- No "merge started" event exists, so a human merge reaches the orchestrator only as `feature.shipped` or `merge.conflict`. Those are end events and are always forwarded. A human's terminal session ending is keyed on `session.pty_exited`, not `session.ended`, because `session.ended` fires from several paths and would duplicate.
- The spec says events caused by the orchestrator's own call are not repeated, but the ticket says end events are always forwarded. I followed the ticket, so a `merge_feature` call still gets its shipped/conflict line.

**Left undone**
- Drive machinery: no new service, env var or seed, so nothing changed and nothing was run.
- `session.run_ended`'s payload must carry `complete: boolean` when ticket 2 lands, or the line will always read "stopped before it finished".

#### 5. The Orchestrator setting and the Orchestrated marker in the web app

# Ticket 5 — the Orchestrator setting and the Orchestrated marker (web)

**What was done**
- Added a `Tag` primitive to `apps/web/src/ui/status.tsx`: an `accent-subtle` ground with a 12px medium `accent-text` word. Beside it is `OrchestratedTag`, which renders nothing unless `orchestrated` is true. Both are re-exported from `ui.tsx` and listed in the STYLE.md status catalogue. There was no tag or badge primitive before; every status was a `StatusLabel`.
- Marker: `FeatureRow` in `Sidebar.tsx` puts the tag after a truncating title only when `f.orchestrated` is true. A feature it does not own keeps the plain string label. `FeatureHeader` puts the tag inside the h1 after the title.
- Setting: `lib/settings.ts` has a new `ControlKind` called `'switch'` and an optional `tag` on the field meta and on the row. The `orchestrator` meta entry has the label "Orchestrator", the tag "experimental" and the exact description from the ticket. It sits in the project page's existing "Project chat" group, because the orchestrator is the project session; there is no new group. `SettingRow` draws the `Switch` primitive for a `switch` control. A flip writes `{ projectId, key: 'orchestrator', value: <boolean> }` at once through `settings.update`. The tag sits in the label's aside, next to the "Saved" mark, so the control's accessible name stays "Orchestrator".
- Tests: a marker case in each of `sidebar-row.test.ts` and `feature-header.test.ts` (tier 1). There is a new describe block in `settings-project.test.tsx` (tier 2). It checks the description and the tag, and that the switch shows the current value both off and on. It also checks that turning it on and off writes a boolean with the project id.
- `bun run typecheck` has 0 errors. `bun run test` passed: 323 files and 4617 tests, with 0 failed. (The baseline in the prompt gives smaller counts. This tree has more tests than that.)

**Surprises**
- `settings.update` already accepted a boolean, but `SettingRow`'s `write` only typed `string | number | null`, so I widened it.

**Left undone**
- An env-locked or read-only switch would still show as a locked text field reading "true" or "false". That can't happen for `orchestrator`, which has no env var.
- The switch does not forward `aria-describedby`, because the `Switch` primitive takes no such prop. The description is in the row but is not linked to the control.
- Drive machinery: this is web-only, with no new service, env var or seed, so I made no edits and ran nothing.

#### 9. Verify the fixes that landed

Drive verification pass — pass #7's one landed fix held, and the tour found nothing broken.

The one fix that landed, #8, was a duplicate "[runcastle] … merged to main" line typed into the orchestrator's terminal after its own merge_feature call. It holds: the orchestrator's own merges are no longer echoed, and merges done by the human on its features still are.

**How I checked it, live in runcastle-demo, on Claude Code (recorded in walkthrough.webm)**
- I turned on "Orchestrator (experimental)" in the project's settings. The switch shows the "experimental" tag and the warning text.
- I opened a new project chat. It opened as the orchestrator with bypass permissions on.
- I told it this was a test and asked it to create "Merge echo probe" and call merge_feature on it once. The merge returned `{"ok":true,"base":"main","files":[]}`.
  - The feature shipped and shows the Orchestrated marker in the Shipped section.
  - The drive database shows `feature.shipped` and `feature.status` both stamped `actor: "orchestrator"`.
  - In the 20 seconds after the merge, no `[runcastle]` line reached the terminal. That is the original repro, and it no longer reproduces.
- Control, to check the fix did not silence merges in general: the orchestrator created "Human merge probe".
  - Its page showed the Orchestrated marker in the heading, and the human buttons were still live: Plan it yourself, Start session, and More actions → Merge & ship.
  - I merged it as the human. The event was unstamped, and the orchestrator's terminal got `[runcastle] human-merge-probe merged to main: shipped. Drafts waiting on it may start now. Read it with get_feature_context({ slug: "human-merge-probe" })`.
  - So merges by other actors are still forwarded, as the spec wants.
- I turned the switch off. The live orchestrator answered the stop line. I then ended the session, and stopped the recorder and the drive. The checkout is back on main and clean.

**Reading the diff (491a458)**
The change is narrow. `orchestratorLineFor` now also returns null for `feature.shipped` and `merge.conflict` when the event's data says `actor: 'orchestrator'`. Every other end event is still forwarded even when stamped. `mergeFeatureFlow` emits both of those events through `emit()` while the tool's `runAsActor` scope is active, so the stamp is always there. The `merge.conflict` path was not driven live. It is covered by the unit test and uses the same stamp path.

**Gates.** The server ran both checks on 491a458 and both passed: `bun run typecheck`, and `env -u GIT_ASKPASS bun run test`. There are no failures to subtract from the baseline.

**Nothing plainly broken on the tour.** Two things I left alone on purpose:
- The catch-up briefing still lists the orchestrator's own merges. Ticket 8 kept this deliberately: after a relaunch, the orchestrator no longer has the tool's result.
- Codex as orchestrator was not driven in this pass.

REVIEW-MODE: drive
REVIEW-VERDICT: verified
REVIEW-REASON: fix #8 driven live — own merge_feature no longer echoed, human merge still forwarded; gates green

### Lap 2

#### 10. Deliver orchestrator notifications through each CLI's own channel, never typed into its terminal

# Ticket 10 — orchestrator notifications through each CLI's own channel

**What was done.** First commit: a test that reproduced the lap 1 failure on the old path (two notifier lines inside 350 ms → `text1, text2, \r, \r`, one joined submission). Then `notifyOrchestrator` stopped typing. It now appends each line to an in-memory pending list (`services/orchestrator-messages.ts`) keyed by the live orchestrate session, and kicks an `OrchestratorDelivery` picked from one table, `DELIVERY_BY_RUNTIME` in `services/orchestrator-delivery.ts`. Flipping a runtime to `typingDelivery` is a one-line change there. Every delivery takes all pending lines at once, so lines that arrive together go out as one message, one line each. The stop line goes through the same path. `orchestratorLineFor` and `orchestratorCatchUp` are untouched.
- **Claude Code.** `renderSettings` takes a 4th argument, `purpose`. For `orchestrate` only, it appends `{ type: 'command', command: 'bun run "<hook-client>" wait-messages', timeout: 86400, async: true, asyncRewake: true }` to every SessionStart entry and to Stop. A test pins every other kind × purpose as byte-identical. The hook client's `waitMessages` long-polls the new `GET /api/hooks/orchestrator-messages?sessionId&waiter` (25 s hold). It exits 2 with the lines on stderr. It exits 0 on `superseded` or `ended`. It re-polls on `empty`, and backs off 3 s on errors or unknown answers. A new waiter answers the older one `superseded`. `markSessionEnded` answers the waiter `ended` and drops the pending lines.
- **Codex.** `codexQueueCommand` builds `codex queue --thread <ccSessionId> --message <lines>`: resolved with `resolveSpawnTarget('codex', …)`, env = `process.env` + `CODEX_HOME=codexHomeDir(id)`, spawned with no shell. One spawn at a time per session; lines that arrive while one runs go in the next. Failures are logged and the lines dropped. A session with no recorded conversation id yet keeps its lines until the next kick.
- **Fallback.** `writeToLiveTerminal` now queues per session. The next text starts only after the previous `\r` plus another 350 ms gap, because text written straight behind the `\r` could reach the TUI in the same burst. `typingDelivery` sends a batch as one **bracketed paste** (`\x1b[200~…\x1b[201~`), lines joined by `\n`. I chose that over ` • ` because both TUIs (Claude Code/Ink and Codex/crossterm) turn bracketed-paste mode on, so newlines inside stay newlines. This is unverified live. The chat briefing (`briefLiveChat`) still passes its tests (`chat-door.test.ts`).

**Surprises.** The docs (via ctx7, `/pjbrito/claude-code-docs` hooks.md) give the field names as `async` and `asyncRewake` ("runs in the background and wakes Claude on exit code 2. Implies async"; stderr is shown, or stdout if stderr is empty). They also say "an asyncRewake hook that exits with code 2 wakes Claude immediately even when the session is idle", which answers the spec's open question on paper. The ticket said async hooks have no timeout, but the docs say they get **the same 10-minute default as sync hooks**. So the waiter carries a one-day timeout. Without it, an orchestrator idle past 10 minutes would have nothing listening until its next turn ends. Session purpose `triage` is not a stored `SessionPurpose` value.

**Live proof: not shown.** `claude` 2.1.295 and `codex-cli` 0.155.1 are both installed in the sandbox, but `claude -p` answers "Not logged in", and Codex has no `auth.json`. Neither channel was driven live, idle or busy. The host review drive must prove both. If one fails there, flip it to `typingDelivery` in `DELIVERY_BY_RUNTIME`.

**Left undone.** On Windows, a `.cmd`-shimmed `codex` goes through `cmd.exe /c`, and cmd's quoting of a multi-line `--message` is untested. A native `codex.exe` avoids that path. Pending lines live in memory only, so a server restart loses them; the catch-up briefing covers that case. The drive machinery needed no change: no new service, env var, seed or process.

**Verified.** `bun run typecheck` passed with 0 errors. `env -u GIT_ASKPASS bun run test`: 327 files passed, 2 skipped, 0 failed (4691 tests passed, 48 skipped).

#### 12. The working agreement: the orchestrator asks how to run each cut before it starts

# Ticket 12 — the working agreement

**Stand on the report.** Before this change, the `## Orchestrating` section of `packages/skills/packs/runcastle/skills/project/SKILL.md` let the orchestrator stop for a test drive purely on its own judgement:
- "The human talks to you once, answers the questions you put, and tests when you call them in. … when a lap is worth a drive, when the human must see it, … each is your judgement"
- "**Drive when the human's eyes are needed**, not after every lap"
Nothing in the section asked the human how involved they wanted to be. The only question rule was decision 12's ("Ask the human only when the decision changes what they get…").

**What was done.** I added a `### The working agreement — before anything is created` subsection right after the opening paragraphs, before "Guard your context". It says to ask one question with a recommendation offering three shapes (autonomous, checkpoints they name, a check-in after each feature), and that "you decide" means autonomous. It says to write the agreement into every feature's brief (the `brief` passed to `create_feature`, and `add_to_brief` for features created earlier or when the agreement changes) and to read it back from the briefs after a relaunch. It also says to work within the agreement: in autonomous mode, never stop for a test drive, rely on each lap's review ticket (read it, never create one) and on integration subagents, and call the human only on the decision-12 line. With checkpoints, stop exactly at the named points. With check-ins, present each feature before merging it. The human can change the agreement at any time. I reworded the opening paragraph and the Drive bullet to put "within the agreement" in place of the free judgement. The heading `## Orchestrating` is unchanged.

**Tests.** I added a test to `packages/server/test/orchestrator-skill.test.ts` that pins the three shapes, "you decide", the briefs and the read-back, never creating review tickets, the checkpoint rule, and that the subsection comes before "Grill, create". Typecheck and the full suite are green: 326 files passed, 2 skipped.

**Surprises.** None. The suite's counts are much larger than the baseline the prompt quoted (118 files), but nothing failed.

**Left undone.** §1's grill text outside the Orchestrating section was not touched. The drive machinery was not affected because this is a content-only change.

#### 16. Working agreement: offered two shapes instead of three on the first cut, and was never asked on the second cut

# ticket(16) — working agreement asked on every cut, with all three shapes

**What was done.** The fix is in the project skill's "The working agreement — before anything is created" section (`packages/skills/packs/runcastle/skills/project/SKILL.md`). I added two rules. First, **always offer all three shapes**, even for a cut of one feature: recommend one, but never drop a shape because it looks unlikely. Second, **every new request is a new cut**, even in a session that has already run one, so it gets the question before anything is created. An earlier answer carries over only if the human says it stands, and never on the orchestrator's own reading. The rule gives decision 18's reason: how involved the human wants to be changes from cut to cut. `packages/server/test/orchestrator-skill.test.ts` now pins the new wording. Commit db18ddda.

**Repro.** I could not re-run the repro step live. This sandbox has no runcastle server, no runcastle-demo project and no interactive Claude Code orchestrator to drive. Instead I read the new text against both halves of the repro:
- The question offering only two shapes on a one-feature cut is now forbidden by name.
- Cut 2 being created with "Working agreement: autonomous" carried over from cut 1, with no question asked, is now covered: the text says not to carry an answer over on its own reading.

Whether the model follows the text has to be judged at the next test drive.

**Gates.** `bun run typecheck` is clean. `env -u GIT_ASKPASS bun run test` passed: 327 files, 4693 tests, 0 failed. Those counts are higher than the baseline the prompt quotes (118 files), but everything is green.

**Surprises.** None in the code. The orchestrating briefing on the server does not restate the agreement, so the skill text is the only place this lives.

**Left undone.** Ticket 13's review found that `add_to_brief` refuses drafts, so a handed-over or waiting draft cannot take the agreement into its brief. That is a separate finding and I did not touch it. The drive machinery is unaffected because this change is skill text only.
