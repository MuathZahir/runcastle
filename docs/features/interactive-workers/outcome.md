# Outcome — Interactive workers

A feature's lead hands pieces of work to workers it offers in its plan; the human sees each feature's workers in a labelled list with "needs you" on top, steps into any of them to iterate, and each worker hands back to the lead. Side chats become workers.

- Shipped: 2026-11-07

## What shipped

47 commits · 132 files

- 5 tickets landed: #1 Workers: the worker record, its lifecycle and the lead's tools; #2 Workers: limits, needs-you pings, failures, idle and wake, ready, cleanup and previews; #3 Workers: the human's setup, auto permission mode and the worker's runcastle tools inside the sandbox; #4 Workers: Codex workers; #5 Workers: wire the approved screens and retire side chats
- 0 waived
- 0 failed

## Review record

### Ticket 6 · review

- Reviewed commit: 7ee59c2145b75b158c06f008576286b44f922352
- Landed since: 0
- Outcome: done

- **Test gate fails: start_worker's description is 460 chars (limit 400), and the worker audience test hits "Method not found"** — fixed
- **Test gate fails: get_feature_context's header gained "workers" but the read-tool ceiling test wasn't updated** — fixed
- **Test gate fails: core SessionKind enum test doesn't know the new "worker" kind** — fixed
- **Test gate: pty-bun "kills the whole tree" failed, but the branch doesn't touch the terminal backend** — open
- **"Open preview" shows from a worker's first second, before any dev server runs, and opens an error page** — fixed
- **A "+" worker's header reads "Worker: New worker" while its row and card say "New worker"** — fixed
- **A "+" worker turns "needs you" (and pings) as soon as it says hello** — open
- **"Workers" now names two things: the Settings page for burn tickets and the new interactive workers** — open
- **Not verifiable on the drive: design-page comparison, Open preview on a running dev server, the no-Docker message** — open

## Notes record

- No human notes

## Per-ticket digests

### 1. Workers: the worker record, its lifecycle and the lead's tools

# Ticket 1 — the worker record, its lifecycle and the lead's tools

## What was done
- **Core contract.** `WorkerRow`, `WorkerStatus`, `WorkerKind` (plus `WorkerOutcome`, `WorkerStartedBy`, `WorkerEngine`) are in `packages/core/src/schemas.ts`. The new session kind `worker` sits beside `side`, which stays for old rows. The `workers` table is in `db-schema.ts`, and its migration is `packages/server/drizzle/0062_workers.sql`. drizzle-kit also tried to re-add `events_type_idx`, because 0061 had no snapshot. I took that line out by hand, and the 0062 snapshot is now correct. `PromptDisplay` gained a `{ handback: {...} }` variant. The web's `lib/workers.ts` now takes `WorkerStatus` from core, and its `WorkerKind` is core's minus `unassigned`.
- **The sandbox engine seam.** `workers/engine.ts` defines `SandboxEngine`: available / create / stop / remove / takeHandback / fetchBranch / process. `containerEngine()` is the docker/podman version built from the prototype's `worker.ts`, and `setSandboxEngineForTests()` puts a fake in its place. `worker.ts` no longer keeps JSON records. It works on a `WorkerSandbox` descriptor that the service builds from the row. A handback file is deleted as it is read, so one handback wakes the lead once.
- **The service** (`workers/service.ts`):
  - Lead and human moves: startWorker / startUnassignedWorker / messageWorker / askWorkerToHandBack / landWorker / sendBackWorker / dropWorker.
  - Lifecycle hooks: workerTurnEnded (a turn without a handback → needs-you; a handback → handed-back, recorded and delivered to the lead once with the handback display), workerPrompted (a human message → working), workerStopped.
  - Every mutation emits a `worker.*` event that carries `workerId` and `status`.
  - Landing merges through `featureLandingQueue` and `mergeTempBranch`. On a conflict the worker stays handed-back and the lead gets the conflict back.
  - `deliverToLead` can now carry a `display` for a line sent on its own.
- **The lead's tools.** start/message/land/send_back/drop_worker, audience `chat`, refused at call time by `requireLeadFeatureId`, which now has its own refusal message for `worker` sessions. `worker` is its own audience and gets none of the lead's tools. `model` must be an annotated model.
- **Reads and routes.** `get_feature_context` has a `workers` header. The new `trpc/routers/worker.ts` serves list / startUnassigned / handBack.
- **experimentalWorkers is removed** from config, the MCP server and the service. With no engine, a start fails with "…Start Docker or Podman, then run `runcastle doctor`…". Claude-Code-only is now a clean GateError.
- **Tests.** The new `test/workers.test.ts` (12 tests) runs on a fake engine, a fake agent host and a real git repo. It covers:
  - the full start → needs-you → working → handed-back → landed path, with statuses and events checked at each step and the lead woken exactly once;
  - a land that conflicts;
  - send back and drop;
  - no engine, and a model that isn't annotated;
  - the audience table, and refusals to non-lead sessions and to another feature's workers;
  - the `get_feature_context` header and the tRPC router.
  
  I also updated the tool list in `chat-contract.test.ts`.

## Surprises
- The tool functions had to be `async`. A synchronous throw from `requireLeadFeatureId` is not a rejection.
- Worker threads are listed in `thread.list` with role `side` (`threads/read.ts`) so they stay visible until the worker list draws them. The handback display shows as a plain `RuncastleNote` in `FeatureCardItems.tsx` until the real card is built.

## Left undone (other tickets)
- Not built: decision 16's failure wake for a crash or a dead container (only a failed sandbox setup marks the worker `failed`, and that error goes back to the start tool), queueing and the shared limit (14), pings, the preview pass-through, Codex workers, and the declare_ready guard (19). The side-chat kind's launch code is also still there.
- The drive machinery needed no change: this ticket adds no service, env var or seed. I did not run the drive scripts.

### 2. Workers: limits, needs-you pings, failures, idle and wake, ready, cleanup and previews

# Ticket 2: workers over their whole life

## What was done
- **The shared limit (decision 14).** The new `services/agent-slots.ts` is a machine-wide counting semaphore whose width is `burnConcurrency`. I did not reuse the burn-cache `getBurnSlotAllocator`, for three reasons: its slots are numbered cache checkouts, a full one makes a ticket run cold rather than wait, and its `held()` blocks clearing the cache. A worker holding one of those would have broken all three.
  - Ticket agents `occupy()` a slot for their run (`ticket-burner.ts` `executeTicketRun`) and never wait.
  - A worker's turn waits in FIFO order, through a new `AgentHostDeps.turnSlot` hook in `threads/host.ts runTurn`. The slot is released when the turn ends or the process stops.
  - `workerTurnSlot` (worker service) marks a waiting worker `queued`, then `working` once it gets a slot. `messageWorker` now sets the status before it prompts.
  - Settings shows "Agents working at once" with a unit naming both kinds of agent. The config key is unchanged.
- **Needs you (decision 6).**
  - Core has a new need kind, `worker` ("<label> needs you"). It is never held and counts while the lead works. It comes from the newest worker that is needs-you or failed.
  - The need watcher pings again whenever a newer worker enters the need, and the event carries `threadId`.
  - The push body is "<label> needs you." and its URL is `/p/<project>/f/<slug>/chat?thread=<workerId>`.
  - In the web: status-line maps the kind to `chat`.
- **Failure (decision 16).** A `crashed` stop marks the worker `failed`, with the error from the thread log. It wakes the lead once through `deliverToLead`, using a new `workerFailed` PromptDisplay. For now the web renders that as a plain note.
- **Idle and wake.** `AgentProcess.conversationOnDisk` lets a process answer the reload guard itself. `withWorkers` makes it ask the engine's new `conversationOnDisk`, which runs `ls` inside the sandbox.
- **Ready (decision 19).** `declareReady` refuses while workers are working, queued, needs-you or handed-back, and names each one.
- **Cleanup (decision 18).** `removeFeatureWorkers` runs on merge, archive and delete. It only emits an event for failures after a merge or archive, but throws on a delete. Delete also removes the rows. `dropWorker` is idempotent.
- **Preview (decision 15).**
  - The pass-through takes `/__runcastle/open/worker/<id>` (a `worker:` cookie) and forwards to `127.0.0.1:<port>`.
  - A worker request first calls `workerPreviews.wake`: the engine's new `wake` starts the container and dev server but not the agent, rechecks every 15s, and stops the sandbox again after the idle time if no agent runs.
  - The paths live in a Bun-free `routes/design-pass-paths.ts`, so the web typecheck stays clean.
  - `worker.list` returns `previewPath` and `passPort`.
  - The briefing and the `start_dev_server` text now give `http://localhost:<serverPort+2>/__runcastle/open/worker/<id>`. The localhost-only detection is unchanged.
- **Tests.**
  - New `test/workers-life.test.ts` (14 tests). It uses the real agent host with the fake ACP agent and the fake engine for queueing, idle/wake and the reload guard. It also covers the need and its pings, failure waking once, the ready refusal, merge/archive/delete cleanup, a double drop, the pass-through target and wake, preview idle stop, and `worker.list`.
  - Added cases in `need-push.test.ts` and core `feature-need.test.ts`.
  - The fakes moved to `test/support/fake-workers.ts`, which `workers.test.ts` now shares.
  - The web settings tests were updated for the new label.

## Surprises
- Importing `routes/design-pass.ts` from the worker service broke the web typecheck: that file imports Bun's server types, and the web reads the server's router types. That is why the paths moved to their own file.
- `RUNCASTLE_IDLE_STOP_MS` does not exist. The idle time is the host's `IDLE_STOP_MS` constant.

## Left undone
- A self-started agent turn (`selfTurn`) takes no slot.
- A sandbox setup failure is reported to the lead through the start tool's error, not as a separate wake.
- The web's Open preview button, the failed and handback cards, and a queued glyph are later tickets.
- Drive machinery: no new service, env var, seed or process, so nothing changed. I did not run the scripts.

### 3. Workers: the human's setup, auto permission mode and the worker's runcastle tools inside the sandbox

# Ticket 3: the human's setup, auto mode and runcastle's tools inside a worker's sandbox

## What was done
- **Setup copy (decision 8).** `workers/setup-copy.ts` `claudeSetup(home)` builds the list of what goes into the sandbox's home. It holds CLAUDE.md, rules/, skills/, agents/ and commands/. It holds the enabled plugins only: their install folders, plus `installed_plugins.json` and `known_marketplaces.json` cut down to those plugins, with the host home rewritten to `/home/agent`. From settings.json it keeps only model, effortLevel, alwaysThinkingEnabled, enabledPlugins, permissions and the project-MCP approval keys, and it forces `permissions.defaultMode: 'auto'`. From `.credentials.json` it keeps `mcpOAuth` only. It also carries `~/.claude.json`'s `mcpServers`. It never copies hooks, statusLine, env, history, sessions, projects or file-history.
  - The engine has a new `copySetup(sb, setup)`. The real one stages the files owner-only, clears the earlier copy, runs `docker cp -a` and merges `mcpServers` into the sandbox's own `~/.claude.json`.
  - `withWorkers` calls it before every agent process starts, so it runs at the start and at every wake.
- **Auto mode (decision 11).** The worker session opens with `mode: 'auto'`, and the prototype's bypass is gone. I checked claude-agent-acp 0.97: when auto mode is unavailable it quietly switches the session to `acceptEdits` and reports that mode. It does not refuse.
  - The thread host now tells the process which mode the session opened in and every `current_mode_update` after (`AgentProcess.onMode`). It also lets a process answer a permission ask itself (`AgentProcess.allowsItself`).
  - In `workers/permissions.ts`, any mode other than auto or plan counts as `fallback`. In fallback, the worker allows every tool itself except tools from the human's MCP servers, which ask the human. Its own `worker` server is allowed.
  - The mode is recorded as a `worker.permission_mode` event `{mode}`, emitted once per change. I used an event rather than a new column, to avoid a migration.
- **Tools from outside (decision 9).** I built the relay the ticket recommended:
  - `relayExecArgs` starts a second `docker exec -i` running `WORKER_RELAY_SCRIPT`, which listens on `/home/agent/.runcastle/tools.sock` inside the container.
  - `serveToolRelay` (`workers/tool-relay.ts`) answers over that exec's stdio.
  - The in-container MCP script now lists exactly hand_back, start_dev_server, read_feature, show_file and park_feature.
  - Runcastle's side is `workers/tools.ts`:
    - **read_feature** returns the lead's `featureContextWithGit` bundle plus `mainChatExcerpt`.
    - **show_file** copies the file out through the new `engine.copyOut`, then shows it with `showFetchedFile`. That function is a new export in `threads/shown.ts`; `showFile` shares its tail.
    - **park_feature** creates a draft through `createFeature({draft:true})`.
  - The container network is unchanged: still the bridge network with one published port.
- **Briefing:** now lists the five tools, says the dev server must accept outside connections (0.0.0.0), and says what to do when auto mode blocks an action.
- **Tests:** the new `test/workers-sandbox.test.ts` has 10 tests:
  - the setup copy against a fake home, both full and empty;
  - the setup being copied at the start and again at each wake;
  - auto mode versus fallback, through a real agent host and the fake ACP agent: in fallback a Bash ask is answered by the worker and an MCP ask reaches the human;
  - the tool list, with the worker audience getting no tools from runcastle's own MCP server;
  - a real round trip that runs the relay and MCP scripts as processes on a temp socket;
  - show_file posting into the worker's own chat, park_feature making a draft, and read_feature.
  
  The fake engine gained `setups`, `sandboxFiles` and `processes`, and it now opens its session in auto mode the way the real engine does.

## Surprises
- At first, importing `mcp/server` from the worker tools pulled the whole server (and `bun:sqlite`) into `apps/web`'s typecheck. So park_feature now goes straight to the features service, and `mcp/server.ts` hands read_feature's bundle to the tools as it loads (`provideWorkerFeatureRead`).
- I did not use ACP client-provided MCP: the host's ACP client cannot serve MCP itself, and the relay keeps the in-container script simple.
- The worker MCP script now reads optional `RUNCASTLE_WORKER_STATE` and `RUNCASTLE_WORKER_REPO` env vars. They exist only so the test can run the script outside a sandbox.

## Left undone
- Not run against a real Docker: the `docker cp -a` ownership and the auto mode under `CLAUDE_CODE_OAUTH_TOKEN` (an open question in the spec) are unverified.
- Not copied: plugins installed outside `~/.claude` (local marketplaces) and marketplace clones. MCP servers whose commands point at host paths will fail inside the sandbox.
- Codex workers' setup copy (decision 12) is not built.
- The drive machinery needed no change: no new service, env var, seed or process. I did not run the drive scripts.

### 4. Workers: Codex workers

# Ticket 4: Codex workers

## What was done
- **The Claude-only guard is gone.** `workerModel` in `workers/service.ts` now takes any annotated model. The worker row's `runtime` now reaches the sandbox: `WorkerSandbox`, `NewSandboxInput` and the fake engine all carry `runtime`.
- **The transport** (`workers/worker.ts`):
  - A new pure function, `workerLaunch(sb, brief, opts)`, builds the exec argv, the env, the processes to pkill and the session, for each runtime. `workerProcess` uses it.
  - For Codex, `codexAdapterExecArgs` (in `sandbox.ts`) runs `node /opt/runcastle/codex-acp.mjs` with `CODEX_HOME=/home/agent/.codex`, `CODEX_PATH=codex`, `INITIAL_AGENT_MODE=agent` and `NO_BROWSER=1`.
  - The session opens in `/home/agent/repo` in codex-acp's `agent` mode (auto-review), with no session MCP servers.
  - No Claude token is asked for: `token` is optional now.
- **The runtime dir.** `ensureRuntimeDir(runtime)` bundles each adapter when a worker on that runtime first needs it. The dir is named by both adapters' versions.
- **The setup copy** (new `workers/codex-setup.ts`, `codexSetup(codexHome, …)`):
  - **Copied:** AGENTS.md (or AGENTS.override.md) with the worker briefing added after it; the skills, prompts and rules folders; auth.json; and `.credentials.json` (the MCP logins).
  - **config.toml is written, not copied.** It keeps an allowlist of the human's top-level keys (reasoning effort, provider, personality, …) and their `[mcp_servers.*]` and `[model_providers.*]` tables. It drops their own `worker` and `runcastle` servers.
  - **Then the worker's own settings:** its model, `approval_policy="on-request"`, `approvals_reviewer="auto_review"`, `sandbox_mode="workspace-write"`, `mcp_oauth_credentials_store="file"`, the trusted clone, and `[mcp_servers.worker]` (runcastle's relayed tools, pre-approved).
  - **Never copied:** hooks.json, history, logs, rollouts, notify, projects, features.
  - `copyClaudeSetup` became `copyWorkerSetup`. It clears both runtimes' managed paths (never `.codex/sessions`) and merges `~/.claude.json` only for a Claude setup.
- **The fallback.** `permissionModeOf(modeId, runtime)` treats Codex's `agent` mode as auto and every other mode as the fallback. In the fallback, `workerAllowsItself` refuses codex-acp's MCP asks (`_meta.is_mcp_tool_approval`), so they go to the human.
- **Resume.** The reload guard's lookup (`conversationLookupScript`) looks for Codex rollouts under `/home/agent/.codex/sessions`.
- **Tests.** The new `test/workers-codex.test.ts` has 8 tests, covering:
  - a start with a Codex model: the exec args, no token, the Codex setup copied;
  - the setup copy against a fake Codex home, full and empty;
  - the config.toml contents;
  - auto-review versus the fallback, through a real host and the fake ACP;
  - a resume after an idle stop (`session/load` with the same id), and the "still on disk" guard.

  The fake engine now records `launches`. The fake ACP's `permission` can now carry request `_meta`.

## Surprises
- codex-acp sends its session mode's approval policy and reviewer with every turn, so config.toml's approval keys are overridden. The real switch is the session mode. When auto-review is unavailable there, the fallback is the session reporting another mode (`workspace-write`: on-request, with the human as reviewer). codex-acp gives no other signal that auto-review is unavailable.
- The test launch's `sessionMeta` carries a Claude model, so withWorkers now reads that model only for Claude workers.

## Left undone
- **Not run against real Docker:**
  - bundling codex-acp with `bun build --target=node`;
  - Codex's `workspace-write` sandbox (landlock/seccomp) working inside the container (burns pass `--dangerously-bypass-approvals-and-sandbox` instead);
  - auto-review being available with the human's Codex login.
- **Leftover host-side calls.** The host still runs the Codex `acpLaunch` for a worker row: it writes a host codex-home and sets `trustHooks`. So `_codex/hooks/list` runs against the host placeholder cwd. That fails quietly (it is caught and logged).
- **Not copied:** the human's `~/.agents/skills`, and MCP logins kept in the OS keyring. MCP servers whose commands point at host paths fail inside the sandbox, as they do for Claude workers.
- **Drive machinery:** no change needed (no new service, env var, seed or process). I did not run the drive scripts.

### 5. Workers: wire the approved screens and retire side chats

# Ticket 5: Workers: wire the approved screens and retire side chats

## What was done
- **Drill-in sidebar.** Opening a feature now swaps the sidebar to `FeatureSidebarPage`. The wiring lives in the new `components/workers/FeatureSidebar.tsx`, which takes its data from `worker.list` and the threads the page publishes.
  - The page shows the Lead card, the needs-you rows, the Working shelf (queued workers inside it) and a folded Done lane. Done holds the old side chats, labelled "Old side chat".
  - The back chevron goes up a level and leaves the chat in front alone. The page comes back down when the feature's row is clicked, or when the thread in front changes (palette, push tap, address). This is a derived "up from" state in `Sidebar.tsx`, not an effect. The design's slide animations are kept.
  - The open feature's row no longer nests a thread list.
- **Visible change to an approved component:** `FeatureSidebarPage` gained an optional `leadThreads` slot. A feature's scenario chats are listed inside the Lead card, the way the Orchestrator lists its chats, so the drive errand's chat stays reachable and closable. It only appears while scenario chats exist.
- **Worker chat.**
  - `ThreadColumn` gained `head` (the pinned AssignmentCard), `closed` (stands in for the composer) and `placeholder`.
  - The new `components/workers/WorkerChat.tsx` builds those props.
    - The column line reads "Sandbox · its own branch off feature/<slug>".
    - A handed-back worker ends on HandedBackLine.
    - A failed worker shows the design's WorkerClosedNote.
    - Landed and dropped workers get WorkerClosedNotes with new copy of mine: "This worker's work landed" / "This worker was dropped".
    - Old side chats show OldSideChatNote and have no composer.
  - The header part (`useWorkerHeader`) sits in Workspace's PageTopbar, not FeatureHeader: the design puts it in the topbar. While a worker is in front, the topbar shows WorkerStatusLine and WorkerHeaderActions in place of the feature's own status and actions.
    - Hand back calls `worker.handBack`.
    - **Deviation:** Open preview opens the pass-through address (`workerPreviewAddress` in `lib/design-address.ts`) in a new tab, not inside the Design panel. Embedding it there would need a new panel state.
- **"+" and New chat.**
  - The "+" now calls `worker.startUnassigned` and opens the new worker's chat. The palette entry and Ctrl+Shift+O do the same; the palette entry is renamed "New worker".
  - The topbar's own "New chat" button is gone.
  - On the phone, the chat bar's sheet lists the lead and every worker (threads now have role `worker`), and its "+" reads "New worker". That is how the phone reaches a feature's workers.
- **Lead's chat.** `RuncastleDisplay` now draws HandbackCard and WorkerFailedCard through a `WorkerLinksContext` that FeatureChat provides.
  - The outcome line is read from the worker's row, but only when the row's `handbackSummary` matches the card's. An earlier handback shows no outcome rather than a later one's.
  - **Visible change:** a handback records file paths only, so the card's file list leaves out the `+n −n` delta. `HandbackFile` makes the line counts optional.
- **Side chats retired (server).** Each of these now refuses with a GateError:
  - `thread.new` for a feature;
  - `feature.openSideSession`, which is deleted;
  - `launchSideSession`, `createSideThread`, `sideKickoff`, `renderSidePrompt` and `sideKickoffFor`, which are deleted;
  - branching a feature's chat (`host.branch`);
  - `thread.send` to an old side row;
  - `acpLaunchInput` for an old side row.

  The `side` kickoff map entry keeps its first sentence so old transcripts still drop their opening. `feature.sessions` lists only the main chat and a scenario chat. On the web, Branch is offered only where the page passes `onOpenThread`, and a closed thread takes no edits.
- **Live workers are not the lead.** The web's `activeSession` and the server's `liveSessionOf` now skip `worker` rows, as they already skipped `side` and `scenario`. This is one line each. Without it, a working worker read as "Agent working" on the feature.
- **Scenario.** `.runcastle/scenarios/workers/feature-with-workers.ts` seeds:
  - a lead chat;
  - nine worker rows (needs-you ×2, working ×2, queued, handed-back, landed, dropped, failed) with no containers;
  - the lead's handback and failure lines;
  - one old side chat.

  It then prints ENTRY_URL. It typechecks, and it does run in the sandbox: I added a case to `dogfood-scenario.test.ts` that runs it as the scenario runner does.
- **Tests.**
  - `chat-column.test.tsx` is rewritten for the drill-in. It covers the lanes, back leaving the chat in front, the dots, the address, "+", the assignment card, Open preview and Hand back, and the read-only old side chat.
  - The new `worker-cards.test.tsx` covers the handback and failed cards and their outcomes.
  - `feature-page.test.ts`, `thread-launch`, `thread-controls`, `feature-sessions`, `kickoff` and `launch-artifacts` are updated for the refusals.
  - `side-sessions.test.ts` now covers old rows. Its main-chat-quote tests call `mainChatContext` directly, because that code is still live and side chats were its entry point.
  - `bun run typecheck` passes. Every touched web and server test file passes.

## Surprises
- Ticket 1 listed worker threads with role `side`. I gave them their own role, `worker`, in core's ThreadEntry and in `threads/read.ts`.
- The design pages have no state for landed or dropped workers, so the copy for those notes is mine.
- No browser binary is available here, so I took no screenshots. Instead I checked that every design page and its modules compile and serve with HTTP 200 through the Vite dev server, which I then stopped.

## Left undone
- The phone's chat bar shows no worker status, Hand back or Open preview.
- The worker row menu has no Drop: no `worker.drop` route exists.
- The edit guard, the hooks' `role=side` label and the MCP `side` audience still exist for old rows that can no longer run.
- Drive machinery: this ticket adds no service, env var, boot seed or process, so nothing changed. I did not run the drive scripts.
