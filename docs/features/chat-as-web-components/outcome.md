# Outcome — Chat as web components

The feature chat stops being a terminal: messages, a text input and tool activity rendered as real web components in the chat column.

- Shipped: 2026-10-28

## What shipped

135 commits · 214 files

- 28 tickets landed: #1 Threads: the agent host over ACP, Claude through its adapter, the thread log and the thread API; #2 Codex: threads over codex-acp, CLI version checks, and the usage mappers; #3 Chat column: the designed thread components on every chat surface; #4 Every conversation launches as a thread; everything runcastle says is a prompt; #5 Thread controls: model, effort and fast mode, edit/rewind/branch, usage, files, titles, suggestions, export; #7 Subagents and background commands reach the thread; #8 MCP servers' forms and links dock in the composer; #9 Thread menu (rename, export), fast mode in the picker, and a real Compact; #10 Cleanup: project thread.new event, build scaffolding, retired headless and wake code in the web; #11 A chat's opening and the human's first message go to the agent as one prompt; #12 Model and effort controls: one searchable, grouped list; effort on its own; settable before the thread starts; #13 Project page: New chat always opens a new thread; threads named by what they are about; #15 Models, effort and runtime do what the composer shows; #16 Thread state never sticks: self-started turns, coming back to a thread, lost conversations, shell-made changes; #17 What the human reads: thread names, list states, the runcastle line, tool rows, file paths, @ and / search; #19 Web: a thread never leaks to another feature; header fits at 900px and stays current; image threads open at the bottom; #21 Names, side-thread openings and terminal-era history; #22 Approval turns fold as one turn; Codex threads read and report like Claude ones; #24 Names that make sense, rename that shows, branches named as branches, and a model pick that means a pick; #25 Fold and first paint: cost across restarts, no empty-thread flash, clean terminal-era history, one answer to a denial with a reason; #26 Codex: usage limits in the meter, readable command rows, no empty review rows; #28 A model counts as picked only when the human picks it; unpicked threads follow Settings; #29 A thread's link always opens that thread, on the feature page and the project page; #31 The agent's process: a restart keeps the preparation chat's conversation, and a crash reads like a person wrote it; #32 What the thread shows: folded runcastle briefings, kept line breaks, honest ages, a fast cold load; #33 One status rule: a lead that replied waits on the human in the header and the sidebar alike; #34 Honest undo, clean crash lines, the effort shown is the effort run, and deny-with-reason; #36 A replied lead turns amber at once; honest effort; the 1M model keeps its name
- 1 waived: #20 Host: runcastle-started threads, restarts and self-plan Stop run on the model and say what happened
- 0 failed

## Review record

### Ticket 6 · review

- Reviewed commit: cf96afc447835fe88dfcbbf3ad384e7c304e725d
- Landed since: 23
- Outcome: done

### Ticket 14 · review

- Reviewed commit: c058f7b09b8e4295e8b1df2c91fad427391a474a
- Landed since: 16
- Outcome: done

### Ticket 18 · review

- Reviewed commit: 7eca83c640b022a5956594acbf6454d2e51edfa5
- Landed since: 13
- Outcome: done

### Ticket 23 · review

- Reviewed commit: 26db76b38a5295e30e5eb2697de0647be1fadf94
- Landed since: 10
- Outcome: done

### Ticket 27 · review

- Reviewed commit: 140225375d8d833227fb5e2ce672ae46c330a3be
- Landed since: 7
- Outcome: done

### Ticket 30 · review

- Reviewed commit: a87b38c0e099515e6f0decb3242b81e881235cac
- Landed since: 3
- Outcome: done

### Ticket 35 · review

- Reviewed commit: d2be1ca1fb0784345f4a35192e8a4999e3ce894c
- Landed since: 1
- Outcome: done

### Ticket 37 · review

- Reviewed commit: e67fc1befc8ffd649af9b63ff9f59fa2a8157237
- Landed since: 0
- Outcome: done

- **Each model pick draws its own divider, so trying models leaves a stack of "Now on …" lines with no message between** — open
- **After "Rewind and send" on the first message, the thread keeps the cut message as its name** — open
- **In the drive, a snapshot feature whose branch is held by the real data dir's worktree cannot start its chat** — open

## Notes record

- No human notes

## Per-ticket digests

### 1. Threads: the agent host over ACP, Claude through its adapter, the thread log and the thread API

# Ticket 1 — agent host over ACP, Claude adapter, thread log, thread API

## What was done
- Pinned `@agentclientprotocol/sdk@2.0.2` and `@agentclientprotocol/claude-agent-acp@0.97.0` exactly in packages/server, using bun. bun.lock is updated.
- **Thread log** (`threads/log.ts`): one JSONL file per thread at `sessionDir(id)/thread.jsonl`.
  - Indices are cached per thread and recovered from the file on first use.
  - `agent_text` and `thought` chunks of the same message are held for 100 ms and joined. Any other event flushes the held chunk first, so arrival order is kept. Held chunks are not visible to reads until they are written.
  - Malformed lines are skipped on read.
  - Every write publishes `{kind:'thread', threadId}`. `/api/stream` dedupes these per thread.
- **ACP mapping** (`threads/acp-map.ts`, pure):
  - Session updates map to thread events.
  - Diffs are line-by-line (longest common subsequence, 3 lines of context), and per-turn `FileChange`s are built from them.
  - The model event comes from the config options.
  - AskUserQuestion questions are read from claude-agent-acp's `question_<n>` / `question_<n>_custom` form, and answered back in that form.
- **Host** (`threads/host.ts`):
  - It is a process-wide singleton behind `agentHost(ctx)`. `createAgentHost({ctx, transport, launch, idleMs})` and `setAgentHostForTests` exist for tests.
  - It covers start, `session/new` or `session/load`, steering via `_session/steering` with `idleBehavior: promptRequired`, queueing, cancel, asks, unattended decline, crash, idle stop and `stopAll`.
  - `stopAll` is wired into the shutdown `killAllTrees` callback in `index.ts`.
  - `setConfig`, `fork` and `usage` still throw NotImplementedError (ticket 5).
- **Launch** (`threads/launch.ts`): builds the `acpLaunch` input for `chat` and `side` rows from the feature. Other kinds throw NotImplementedError naming ticket 4, because they need their own briefs.
- **Claude `acpLaunch`**: runs the adapter's `dist/index.js` with `process.execPath`.
  - I checked by hand that Bun runs it: `--version` and an `initialize` handshake both work. Node was not needed.
  - The flags go through `_meta.claudeCode.options.extraArgs`; `strict-mcp-config: null` is a bare flag.
- **Router**: `list`, `view`, `events`, `send`, `stop` and `answer` are filled in (`threads/read.ts`). Terminal-era rows are listed once per `ccSessionId` and their events are synthesized from the transcript. `GET /api/threads/:id/images/:file` is served by `routes/threads.ts`.
- Images are saved by the host's `prompt()`, not the router, because the host writes the prompt event that carries the URL.
- Tests: thread-log, thread-acp-map, agent-host, thread-router, and an acpLaunch block in launch-artifacts. The reusable fake agent is in `test/support/fake-acp-agent.ts`.
- Full `bun run typecheck` and `bun run test` pass (373 files, 0 failures).

## Surprises and contract changes
- **claude-agent-acp ignores `_meta.claudeCode.options.permissionMode`.** It always uses its own resolved mode. I added an optional `sessionMode` to `AcpLaunchSpec`, and the host calls `session/set_mode` after new or load when the mode differs. `permissionMode` is still in the options as the ticket asked, but it has no effect.
- The adapter already appends `replay-user-messages` to `extraArgs`. Our flags merge with it.
- Not verified against a real `claude` (none in the sandbox): whether `--append-system-prompt-file` conflicts with the system-prompt preset the SDK sends. That is the spec's open question.
- SDK 2.x has removed `ClientSideConnection`. The host uses `client().onRequest/onNotification().connect(...)` from `@agentclientprotocol/sdk/unstable`, which is the entrypoint the adapter itself uses.
- Errors thrown by the agent arrive as "Internal error" with the real text in `data.details`; the host unwraps it.
- **Subagents** stay ordinary tool calls. `clientCapabilities.subagents` is not negotiated, and the host emits no `subagent` events.
- Runcastle prompts queued mid-turn are logged when they are sent, not when they are queued, so they don't split the running turn. Human prompts are logged at once.

## Left undone
- After a server restart, a log cut off mid-turn still folds as `working` in `thread.view`. `thread.list` reports such threads as idle because no host process is running, but nothing appends a `process stopped` event at boot. That reconciliation is still needed.
- The web treats an unknown live-signal kind with `resyncAll`, so every thread signal currently refetches everything. The web ticket should handle `kind: 'thread'`.
- `thread.new` and launching any kind through the host are tickets 4/5.
- Drive machinery: no new service, required env var, seed or process was added, so no `.runcastle/` edits were needed. I did not run the drive scripts.

### 3. Chat column: the designed thread components on every chat surface

# Ticket 3: the chat column renders through the thread components

## What was done
- **The column and its hook.** `lib/use-thread.ts` and `components/chat/ThreadColumn.tsx` wire the approved thread components to the `thread` API. The column is laid out the same way as `preview/chat.tsx`'s ChatColumn.
- **How a thread is read.** `thread.view` gives the first paint. `thread.events` is then read once in full and folded with core's `foldThread`. After that, each read asks only for events after the cursor.
  - The events query is keyed by `{threadId, after}` and never goes stale by itself.
  - The empty read after each new cursor is pre-seeded, so moving the cursor does not cost a fetch.
  - A `{kind:'thread'}` signal in `lib/live.ts` invalidates only `thread.events`/`thread.view` for that id and `thread.list`.
- **Sending.** A sent message shows at once, and the server's prompt event replaces it (matched by `promptId`, or by the same text). Drafts are kept per thread in localStorage, and ↑ brings back the last message.
- **Never-started chats.** A feature chat, a new project chat and a preparation chat with no thread yet show an empty thread. The first Send calls `feature.launchSession` / `project.talkToProject({fresh:true})` / `project.talkToPrep`, then sends to the id it returns. The column keeps one React key through that start, so the message stays on screen.
- **Thread switcher.** `ThreadSwitcher`, fed by `thread.list`, replaces the switchers on the feature page and the project page, in the same positions. It has New thread (`thread.new`, then selected), the other-thread waiting dot, and "Close the scenario chat" for an open errand. End session is gone.
- **Removed:** ChatView and its at-rest screen, SessionSwitcher, FeatureSessionSwitcher, SideSessions, SessionNotices (and `awaitingCheckIn` / `sessionNotReady` / `CHECK_IN_GRACE_MS`), use-auto-resume, EndSessionButton, `chatContextLine`, the project talk's `autoResume` and `resume`, the headless toast, and the "No terminal to watch" copy. That copy is now "Planning by itself — open the thread to watch".
- **Crops.** In DrivePanel, a crop sent to the chat goes to `lib/composer-inbox.ts` under `mainChatInbox(featureId)`. The feature column brings the main chat to the front, and the composer takes the image and focuses. The server's `design.sendCrop` is left in place.
- **PreparationWorkspace** is now the prep thread plus an aside ("To establish" / "Established"). `PrepCallToAction` and `PreparationSkeleton` are gone.
- **Other changes:** STYLE.md is updated, and `test/fake-trpc.tsx` is a new helper that runs the app's real tRPC hooks over a fake link.

## Visible changes caused by wiring (none restyle a component)
- `PlanStrip`'s `onStopTask` is now optional, because no procedure can stop a background command yet, so the Stop on a background command is hidden.
- `ThreadSwitcher` takes `children` (menu rows after New thread).
- The notice deck floats in a layer that ends `bottom-44` above the composer, so it doesn't cover it.
- The meta line under the composer reads "Feature worktree · <branch>", "Lands on <branch>" on the project page, or "Prepared 3d ago" / "N to establish" in preparation.

## Surprises
- In happy-dom, opening the Radix switcher menu over and over (a `waitFor`) before `thread.list` had answered looped until the worker ran out of memory. The tests now wait for the thread first. I could not reproduce it outside that polling.
- `preview/*.tsx` is in no tsconfig. I type-checked it ad hoc: `chat.tsx` and `feature-page.tsx` are clean. `palette.tsx` and `sidebar-data.ts` already had type errors, which I didn't touch.
- Screenshots were not possible: the sandbox has no browser. The look is unchanged by construction (same components, preview composition), but nobody has looked at it in a real page yet.

## Left undone
- **Project page entry points.** The project page's resting list and NewChatCard stay. New chat opens an empty thread only when no chat is open; ProjectShell's New door still calls `talk.start`. ConversationList still labels its button "Resume", though it now just opens the thread.
- **Chat door.** The Chat door (`openChat`) still launches when nothing is live; ticket 4 decides what that launch does now.
- **Stub fallbacks.** While `thread.list` errors, the main chat falls back to `featureChat(full.sessions)`. A failing `thread.new` toasts its error.
- **Drive machinery** needs no change: no new service, env var, seed or process. `.runcastle/drive-setup.ts` and `drive-stop.ts` exist; I did not run them.

Verify: `bun run typecheck` exit 0; `env -u GIT_ASKPASS bun run test`: 368 files passed (2 skipped), 5018 tests passed, 0 failed.

### 5. Thread controls: model, effort and fast mode, edit/rewind/branch, usage, files, titles, suggestions, export

# Ticket 5 — thread controls

## What was done
- **AgentHost.setConfig**: sets the model, effort and fast mode through ACP `session/set_config_option`, model first. Option ids: Claude `model` / `effort` / `fast`; Codex `model` / `reasoning_effort` / `fast-mode`. Fast mode can be a boolean or an on/off select. A `model` event is logged with effort and fast. `acp-map`'s `modelEvent` now also carries effort and fast. If no session is open, the choice is logged straight away and applied when the next session opens. `prompt()` calls setConfig before a message whose model, effort or fast differs from the folded thread's.
- **AgentHost.models** (a new method on the interface) answers from the session's options. If those are gone, it uses the last options seen for the thread or its runtime, then runcastle's roster for the runtime. It never starts a process.
- **fork / edit / branch**: both adapters fork at a message the same way, through `session/fork` with `_meta.jetbrains.air.fork = {version:1, messageId}`. claude-agent-acp's `fork-session.ts` uses Claude's API message id. codex-acp's `SessionFork.ts` uses the turn item id. Both are the `messageId` on agent chunks, which ticket 1 already logs as `agent_text.messageId`. I did not extend any event.
  - **Edit** (`into: 'same'`) stops a running process and writes a pending fork to `<sessionDir>/fork.json`. The next start opens `session/fork` at the last agent message before the edited prompt, or `session/new` when the first prompt is edited. It logs `rewound`, and the router then sends the new text.
  - **Branch** (`into: 'new'`) creates a `side` row (or a `project` row for project chats) on the same worktree and model. It copies the live log prefix through that turn, re-indexed from 0 and minus `process` events, using a new `seedThreadLog`. It writes a pending fork that is only used on the branch's first message, and emits `session.branched`.
  - **Fallback**: if the agent's message ids were made up by the host's mapper (the adapter sent none), the agent gets a `[runcastle]` note ahead of the next prompt saying the message was replaced. A branch in that case gets the conversation as Markdown.
- **undoFiles (Claude only)**: claude-agent-acp only dry-runs `rewindFiles` and gives a client no way to do a real rewind. So `side-channels.ts` does it through the Agent SDK. It finds the prompt's user-message uuid with `getSessionMessages`, then runs `query({resume, enableFileCheckpointing}).rewindFiles(uuid)`. Claude's `acpLaunch` now passes `enableFileCheckpointing: true` and `promptSuggestions: true`. Codex ignores `undoFiles`.
- **usage**: neither adapter exposes usage limits to a client. Claude only renders `/usage` as Markdown, and Codex only reads its limits for `/status`. So the host reads them itself, but only while the thread's process runs: Claude through the SDK's `usage_EXPERIMENTAL…()`, Codex by spawning `codex app-server` for `account/rateLimits/read`. The plan comes from the `_auth/status_update` pushes it now captures. Both go through ticket 2's mappers. The last report per runtime is cached; an idle thread or a failed read returns that, or `{limits: []}`.
- **Router**:
  - `files`: `git ls-files` per worktree, cached for 30s, fuzzy subsequence match, shortest path first.
  - `rename`: sets `sessions.title` and logs a `title` event.
  - Generated titles: one is stored on the row only when the row has no title, so a rename wins.
  - `export`: `threadMarkdown` — You / Runcastle / Agent sections, one "Worked for …: read 2 files, ran 1 command" line per turn, images as links.

## Surprises
- The real side channels (Claude SDK usage and rewind, `codex app-server` rate limits) are not tested against real CLIs. Tests inject `readUsage` and `rewindFiles`. Things to check in a drive:
  - whether `rewindFiles` works on a resumed SDK query;
  - whether `codex app-server` needs an `initialized` notification before `account/rateLimits/read`.
- An edit stops a running process and restarts it on the fork, which costs a few seconds. Forking on the live connection would avoid that.

## Left undone
- `thread.new` is still `todo('1')`; ticket 4 or a follow-up should fill it.
- The drive machinery needed no change: no new service, env var, seed or process. I checked this by reading the diff only; I did not run anything.
- Verification: `bun run typecheck` is clean and `bun run test` passed (376 files, 0 failed).

### 7. Subagents and background commands reach the thread

# Ticket 7: subagents and background commands reach the thread

## What was done
- **Subagents on both runtimes.** The host now declares `clientCapabilities.subagents: {}`. In return, both adapters run each subagent as a child ACP session.
  - **claude-agent-acp** announces a subagent with the RFD's `subagent_update` (`state` running, then idle with a stopReason).
  - **codex-acp** announces one with the earlier AIR draft: `subagent_spawned` and `subagent_state_update`.
  - The ACP SDK's client zod-validates every `session/update` (its built-in session-update router) and throws on the draft form before any handler runs. So the host rewrites those two messages to `subagent_update` on the adapter's stdio stream (`rfdSubagentMessage` in `acp-map.ts`).
  - The mapper (`createUpdateMapper(update, from?)`) turns announcements into `subagent` events. A child session's tool calls become `tool` events with `parentId`. A grandchild's calls nest under the top-level subagent. Everything else from a child session is dropped: its words, model/config, plan and usage.
  - A child's file diffs still count towards the turn's changes card.
- **Background commands, Claude only.** The Claude session `_meta` now sets `claudeCode.emitRawSDKMessages: [{type:'system', subtype:'background_tasks_changed'}]`.
  - The adapter then forwards the Agent SDK's live background-task set as `_claude/sdkMessage`.
  - `backgroundTasks()` turns it into a `tasks` event with the full list. It leaves out subagents (`local_agent`), monitors and ambient tasks.
  - A finished command leaves `view.tasks` at the next change.
- `perTaskStopAffordance: false` is set in Claude's options. Declaring subagents would otherwise switch it on, and Stop would no longer end background subagents.
- **No Stop on either runtime, so there is no `thread.stopTask`.** Both adapters do implement `_session/async_task/stop`, but they only track tasks for a client that declares JetBrains AIR's `asyncTasks` extension (`_meta.jetbrains.air`).
  - Declaring AIR makes the adapter treat runcastle as an AIR client. That reshapes AskUserQuestion elicitations, diffs, rawInput/rawOutput and tool-call `_meta`, which would also collide with the parallel elicitation ticket.
  - So `ThreadColumn` passes no `onStopTask`. A tier-2 test checks that the strip lists the command with no Stop.
- **Codex has no background-command list at all.** codex-acp only reports background terminals to an AIR `asyncTasks` client. That is the same gate.

## Re-ran the repro
The finding was that `acp-map.ts`'s default branch dropped subagent sessions, so `subagent` and `tasks` events were never written. I re-ran it: `subagent_update` now has its own case. New host tests show `subagent` events, `tool` events with `parentId`, and `tasks` events written to the log and folded into subagent segments and `view.tasks`. Full suite: 371 files passed, 0 failed. Typecheck: 0 errors.

## Surprises
- The fake ACP agent now connects over a message-stream pair, not straight to the AgentApp, so the host's wire rewrite is tested. All existing host and thread tests still pass.
- On `session/load`, `t.sessionId` is now set before the replay, so a child session's replayed config can't overwrite the thread's model options.

## Left undone
- A real Stop would need runcastle to become an AIR client, or the adapters to un-gate async tasks.
- Drive machinery: no new service, env var, seed or process, so nothing to change.

### 8. MCP servers' forms and links dock in the composer

# Ticket 8 — MCP servers' forms and links dock in the composer

**What was done.** Core's `Ask` gained `form` (`server?`, `message`, `fields`) and `link` (`server?`, `message`, `url`). `AskAnswer` gained `{kind:'form', values}`, `{kind:'link', done:true}` and `{kind:'decline'}`. `FormField` covers string (email/uri/date formats), number (`integer` flag), boolean and enum (single choice), each with a title, description, required flag and default. `foldThread` needed no change, because it already handles asks generically. A new `packages/server/src/threads/elicitation.ts` maps an ACP form schema to fields, or to "unsupported" for arrays, nested objects or unknown modes. It also maps a URL request to a link, filters the submitted values and builds the resolved lines.

In `host.ts`, `onElicitation` checks for an unattended thread first, then AskUserQuestion, then form or link. An unsupported schema is declined with "… runcastle cannot show this form: its field "x" is not a plain value". `answer()` accepts decline for forms and links and logs per-field lines ("Team: Engineering"), "Done" or "Declined".

On the web, `FormDock` and `LinkDock` in `AskDock.tsx` reuse `DOCK`, `DockFooter`, `Choice` (for enum options), `Field`/`TextField`/`Checkbox`, `Kbd` and `LINK`. Both have Submit or Done plus Decline, and Esc declines. The form checks required fields and numbers before it sends. `ThreadColumn` and the preview (`mcp-form`, `mcp-link` moments) show them.

**Deviations, all small, outside onElicitation/answer.**
- In `initialize`, the client now advertises `elicitation: { url: {} }`. Without it, claude-agent-acp declines every URL elicitation itself, and the link dock could never appear.
- I added an `elicitation/complete` notification handler (`onElicitationComplete`) so a link the agent reports finished (an MCP OAuth sign-in done in the browser) closes its dock instead of lingering.
- The fake ACP agent gained `elicit` and `completeElicitation`.

**Surprises.**
- `acp.CreateElicitationRequest` has an open `mode: string` member, which defeats narrowing on `mode`, so the mapper casts to `ElicitationFormMode`/`ElicitationUrlMode`.
- Neither adapter forwards the MCP server's name, so `server` is never filled today and the dock says "An MCP server asks". Only the preview data sets it.
- With URL elicitation advertised, claude-agent-acp also starts MCP OAuth at session start for servers that need it. Those sign-ins now arrive as link docks.

**Repro re-run.** The review finding was that `onElicitation` silently declines every non-AskUserQuestion elicitation. I re-ran it through the new host tests: a form elicitation now docks as a form ask and returns accept with the values, and a URL elicitation docks as a link. A decline only happens on Decline, on an unattended thread, or on an unsupported schema, and each logs a line.

**Verify.** `bun run typecheck` passed with 0 errors. `env -u GIT_ASKPASS bun run test` reported 371 files passed, 5035 tests, 0 failed. `apps/web/preview` is outside every tsconfig; checking it with a temporary config showed `chat.tsx` and `chat-data.ts` clean. The only errors were already there, in `palette.tsx` and `sidebar-data.ts`, which this ticket does not touch.

**Drive machinery.** Unchanged and needs no change: no new service, env var, seed or process.

**Left undone.**
- Codex-acp routes some MCP elicitations through its permission fallback, so on Codex they arrive as approvals. That path is untouched.
- Multi-select array fields are declined as unsupported, as the ticket allowed.
- The preview's other type errors (`palette.tsx`, `sidebar-data.ts`) are left alone.

### 9. Thread menu (rename, export), fast mode in the picker, and a real Compact

# Ticket 9: thread menu (rename, export), fast mode in the picker, and a real Compact

## What was done
- **Compact.** Added `thread.compact({threadId})` to the router and `AgentHost.compact`. It sends `/compact` as a runcastle prompt logged with a new optional `hidden: true` flag on core's `prompt` event. `foldThread` shows no message for a hidden prompt, but its turn still folds. Both adapters take `/compact` as a prompt: claude-agent-acp passes it to Claude Code as the slash command, and codex-acp runs its own `compact` command (`thread/compact/start`). Compact is refused with a GateError while a turn runs, an ask is open or prompts are queued. On a stopped thread it starts the agent. A resumed main chat's opening header is held back from the command and rides on the next real message.
- **Compaction divider.** Both adapters only send `compaction_update` to a client that declares `clientCapabilities.session.compaction`, and runcastle declared nothing before this, so the "Conversation compacted" divider could never appear. The host now declares `session: { compaction: {} }`.
- **Fast mode (contract change).** `ModelChoice` gained an optional `fast?: boolean`. `thread.models` sets it on the model the session runs on when the session offers a `fast` / `fast-mode` option. Only that one model is marked, because ACP options describe only the current model. `useThread` tracks `fast` and sends it through `setModel` and `send`, and it re-reads `thread.models` after a successful `setModel`. `ModelPicker` takes optional `fast` / `onFast` props and shows a "Fast mode" `menuitemcheckbox` row only when `onFast` is given.
- **Thread menu.** `ThreadSwitcher` takes optional `onRename` / `onExport` props and shows "Rename…" and "Export as Markdown" rows after New thread. Rename opens a small `Dialog` with a `TextField`: Enter saves, Escape cancels. `useThreadMenu(threadId)` in `use-thread.ts` returns those props: rename calls `thread.rename` and invalidates `thread.list`; export downloads `<title>.md` from `thread.export`. It returns `{}` for a thread that has not begun. Both `Workspace` (feature page) and `ProjectWorkspace` (project page) spread it onto the switcher.
- **Moved code.** `rename` / `exportMarkdown` moved out of `useThread` (nothing called them). `send(command)` lost its command parameter. `STYLE.md` got one line on the switcher's menu.

## Surprises
- The missing `session.compaction` capability, described above.
- The project-page tests mock `trpc` wholesale, so their mocks had to gain `thread.rename`.

## Checks
- I re-ran the reviewer's repro (grep): `send('/compact')` is gone, `useThreadMenu` is called on both pages, and the picker has its Fast mode row.
- `bun run typecheck` is clean. The full `bun run test` (RUNCASTLE_* unset) gave 371 files passed, 2 skipped, 0 failed.
- No drive machinery was needed: no new service, env var, seed or process.

## Left undone
- When the human picks a different model while no session is open, its fast availability is unknown until the session reports options, so the row stays hidden until then.
- A compaction started on a stopped thread shows no "starting…" hint, because the prompt is hidden.

### 12. Model and effort controls: one searchable, grouped list; effort on its own; settable before the thread starts

# Ticket 12 — model and effort controls

**What was done.**
- **One catalog per runtime (server).** Every time a session reports its config options, `host.noteOptions` merges the adapter's model list into `~/.runcastle/model-catalog/<runtime>.json` (`threads/model-catalog.ts`, `modelCatalogPath` in core paths).
- **What `thread.models` answers.** It now returns `ThreadModels { runtime, models, current }`:
  - The list comes from that file, else the roster mapped to adapter-style labels (`claude-opus-4-8` → "Opus 4.8", dated ids and duplicates folded into one entry).
  - The operator's roster notes become the one-line descriptions.
  - It also takes `{ featureId }` or `{ projectId, kind: 'project'|'prepare' }` for a chat nobody has started, so it can answer with the model runcastle would start it on.
- **Default resolved.** Claude's "Default (recommended)" (option value `default`, whose description names the model) is dropped from the list and becomes `defaultId`. `currentConfig` reports it as the real model, so dividers never say "Default". `configRequests` treats picking the model Default already stands for as no change.
- **What the catalog learns per model.** Effort levels (only the levels runcastle's `Effort` enum has) and fast mode, from whichever sessions ran on that model. A model no session has run on has `efforts` unknown, and its effort control is hidden.
- **Web.** `ModelControls` in ComposerParts holds three controls:
  - **Model picker:** a Combobox (cmdk) with search, arrows/Enter/Esc. Grouped by family (Fable, Opus, Sonnet, Haiku; Codex by GPT generation, "GPT-5"), newest first, with older versions behind an "Older models" row (new `ComboboxAction` primitive). The current model is checked, each row has its one-line note, and the chip shows the name only.
  - **Effort:** a Select offering only the model's levels.
  - **Fast mode:** a flame toggle shown only where the model has it.
- **Before start.** `useThread`/`ThreadColumn` take `startsAs`, which FeatureChat, ProjectChat and PreparationWorkspace pass. A choice made before the first message is kept in the web and rides the first `thread.send`.
- **Dividers.** They name the effort when it changed along with the model. An effort-only change still shows no divider, as the existing core test pins.

**Screenshots.** Taken with a headless Chromium fetched into /tmp; nothing was added to the repo.
- **Preview page** (`/preview/chat.html`, new "Codex thread" moment with long realistic lists for both runtimes): a 320px raised panel opening upward from the chip, with a search row, quiet family headings, two-line rows (name plus tertiary note), a check on the current model, "Older models" with a count, and the effort chip ("Effort Medium ▾") and flame beside the model chip.
- **Real feature page:** a throwaway page built with `.runcastle/preview` helpers, never committed. The never-started feature chat shows the controls on the default model, for both Claude and Codex.
- **Against t3code:** same shape (provider glyph chip, searchable grouped popover, separate effort control). Ours adds descriptions and the older-models fold. t3code shows provider logos per row and keyboard hints, which we don't.

**Surprises.**
- The shared `FLOATING_ITEM` matched cmdk's `data-disabled="false"`, so every Combobox row in the app (the branch pickers too) rendered at 50% opacity. I fixed it in `ui/floating.ts`; Radix-disabled rows still dim, which I checked in the browser.
- The feature column's stand-in thread row hard-codes `claude-code`, so `ThreadColumn` now prefers the runtime the models answer reports.
- Codex's `xhigh`/`minimal` efforts are outside core's `Effort` enum and are not offered.

**Left undone.**
- `threadMarkdown` export still writes "Now on X" without the effort.
- Old logs that already say "Default (recommended)" are not rewritten.
- Codex's recommended model (`_meta` recommendedValue) is not read, so an unstarted Codex thread falls back to the first catalog entry when its roster model isn't in the catalog.
- **Drive machinery:** no new service, env var, seed or process. The catalog file is created on demand, so `.runcastle/` was not touched.

### 13. Project page: New chat always opens a new thread; threads named by what they are about

# Ticket 13 — New chat always opens a new thread; threads named by what they are about

## What was done
- **Server naming (`packages/server/src/threads/read.ts`).** `thread.list` now names each thread in this order: the human's rename (the row title), then the runtime's generated title, then the first human message (cleaned and shortened through `deriveTitle`), then "New chat". It never uses the kind label or "Untitled". A generated title only counts if it arrived **after** a human prompt. The adapter titles a session from its first prompt, which is runcastle's kickoff, and that is where "Runcastle project session" came from. The server test is in `thread-router.test.ts`.
- **Project page.** New chat (`NewChatCard`), ProjectShell's New door and the sidebar Create menu (both through `newChatRequest`), and the switcher's New thread all call one `newChat` in `ProjectWorkspace`. It runs `thread.new`, which is the path the switcher already used, and brings the new empty thread to the front. Its first message starts it through `thread.send`.
- **Removed.** The open notice and "End it and start new" are gone, along with the lazy `NEW_CHAT` / `talk.begin` path. `use-project-talk` no longer has `start`, `replace`, `begin` or `conversations`. Triage now opens its own new thread: `talk.triage(onOpened)` brings it to the front. `ProjectChat` now always takes a real `threadId`.
- **Chat list.** The resting list (`ConversationList`) now reads `thread.list` (`ThreadEntry[]`) rather than `project.conversations`, newest activity first. It shows each thread's state the same way the switcher does, through the new shared `chat/thread/ThreadState.tsx` (`ThreadStateMark`, `threadStateWords`). The meaningless blue "live" dot is gone.
- **Feature page.** The switcher's placeholder rows (for threads the list does not hold yet) were named "Feature chat" and "New thread". Both are now "New chat" (`NEW_CHAT_NAME` in `lib/chat-sessions.ts`). A test in `chat-column.test.tsx` covers starting a side thread while the main chat is working, with both listed with their names and states.
- **Tests.** I rewrote the tests for the removed notice flow and deleted `project-new-chat.test.tsx`, which only tested the notice. The tier-2 tests in `project-drive-workspace.test.tsx` cover, with a chat running: New chat, the New door and the switcher's New thread each opening an empty new thread; and the page list matching the switcher on names and states.

## Surprises
- `thread.new` creates the row in the `launching` state. `project.projectSession` (the newest launching or live row) therefore treats an empty new thread as "the running chat", for the page's default front and for the rail's "Starting chat…" wording. This was already true of the switcher's New thread. I did not change it.

## Left undone
- **No screenshot.** The sandbox has no browser (no chromium, playwright or agent-browser).
- **Rail status.** The sidebar's Orchestrator card still reads only the newest running session's `awaitingInput`. A waiting chat that is older than the newest running one does not turn the rail amber. Deriving this from `thread.list` states would fix it.
- **`project.conversations`** is no longer read by the web. It is still served, and `lib/live.ts` still invalidates it.
- **Drive machinery.** No new service, environment variable, seed or process was added, so no edit was needed.

Verify: `bun run typecheck` passes with 0 errors. `env -u GIT_ASKPASS bun run test` passes: 370 files, 5055 tests passed, 30 skipped, 0 failed.

### 15. Models, effort and runtime do what the composer shows

# Ticket 15 — Models, effort and runtime do what the composer shows

## What was done
- **Defects 1 and 2 (one root cause).** The picker sends catalog ids. Before any session has run, those are runcastle's roster ids (`claude-haiku-4-5`). claude-agent-acp's model option uses its own aliases (`opus`, `sonnet`, `haiku`, `default`). `configRequests` only asked for exact option values, so roster ids were silently dropped, both before start (the pending config) and mid-thread. It now maps an id to the option entry whose adapter label matches (`modelValue` in `threads/controls.ts`, using `rosterLabel`/`labelKey` from `model-catalog.ts`). When the host logs a choice made while the agent is idle, it now uses the catalog's id and label (`catalogEntry`), so it never logs a raw id.
- **Defect 4.** A choice made before a thread has run is now only pending config: `setConfig` logs nothing until the fold has a model, so no "Now on" divider appears before the first message. `host.models()` reports the pending model as `current`.
  - The catalog now records the effort each model *starts* on (`ModelChoice.defaultEffort`, read from the options a session opened with).
  - Every model now offers effort levels. A model no session has run on takes what a session said about another model in its family (family via `modelFamily`, moved from the web into core). Failing that, it takes the runtime's known levels (Claude: low/medium/high/max; Codex: low/medium/high). I used this fallback, not the Agent SDK's ModelInfo. Fast mode is inherited from the family the same way.
  - On the web, `effortShown` picks the effort to show: the level held, else the model's start level, else Medium. A never-started thread's first message now always sends the shown model, effort and fast (`use-thread` send, `begun = !!folded.model`). So what is shown is what the agent applies.
  - The chip shows only an id the list offers; otherwise it falls back to the server's `current`. A successful `setModel` drops the local model choice, so the chip names the label after the list's ids switch to aliases.
- **Defect 3.** All surfaces already use the same ThreadColumn and ModelControls. The project and preparation chats were missing the controls because their model had no learnt efforts or fast mode; the family fill fixes that. Tier-2 tests in `apps/web/test/chat-surface-controls.test.tsx` cover both chats.

## Surprises
- **Defect 5 did not reproduce on the server.** With `config.model` or the project's own model set to `gpt-5.6-terra`:
  - `thread.new` (project and side) and the preparation launch create Codex rows.
  - `thread.models` answers `runtime: 'codex'` with GPT models.
  - The ACP launch gets a `CODEX_HOME`.

  The new launch test in `thread-launch.test.ts` passed **before** any change, so it guards against regressions but did not fail first. My guess at the reviewer's setup is an explicit `stepModels.project` in their dev config, which beats the global default by design. I could not reach their evidence to confirm.
- The real claude-agent-acp reports effort `default` (not a runcastle level) unless the user's settings pin one. In that case no start effort is learnt and the UI shows Medium, which the first message then applies.

## Left undone
- `modelEntryFor` (core) still falls back to Claude for any id that is not in the roster. A Codex id outside the curated, discovered and operator lists would start Claude. I left it alone because it is outside this ticket's seams.
- Drive machinery: no new service, env var, seed or process, so nothing to update. I did not run any drive scripts.

### 16. Thread state never sticks: self-started turns, coming back to a thread, lost conversations, shell-made changes

# Ticket 16 — thread state that sticks

## What was done
- **Turns the agent starts by itself (host).** When the agent sends output and no turn is running, the host now opens a turn (`turn_started` with `source: 'agent'`). For Claude, the turn ends on Claude Code's own end-of-turn signal: its session going `idle`. That arrives as the SDK message `system/session_state_changed`, forwarded over `_claude/sdkMessage`. To get it, the Claude launch's `emitRawSDKMessages` now also lists `session_state_changed`. The adapter already sets `CLAUDE_CODE_EMIT_SESSION_STATE_EVENTS=1`. Codex has no such signal, so a self-started turn there ends after 30 s of quiet (`SELF_TURN_QUIET_MS`, which tests can set through `selfTurnQuietMs`). A runcastle prompt sent during a self-started turn waits for it to end. Stop or Esc ends the turn as cancelled.
- **Fold (core).** A thread is `working` only inside a turn that a `turn_started` opened. Words logged after a turn's end now settle. Repeated `compacted` events with no prompt between them draw one divider. A `usage` event with no cost keeps the last cost. There is a new `notice` event and item, a quiet line drawn with the existing `Divider` and exported as italic Markdown.
- **Lost conversation.** When `session/load` fails because the conversation is gone (ACP code -32002, or "not found" in the message), the host calls `session/new` and records the new id. It sends the kind's briefing with the prompt that started the process, as one prompt, and logs the notice "Started a new conversation — the earlier one could not be found". The briefing comes from a new `ThreadLifecycle.briefing` hook, which calls `kickoffFor`.
- **Stop.** `host.stop` now closes an open turn with `turn_ended` reason `cancelled`, so the thread shows "Stopped by you". On a self-planning run stopped by the human (reason `archived`), it also writes a preface to the pending-fork file. The lead's next prompt then starts by saying planning was stopped by the human. The bar already goes back to normal: `endSession` ends the row and the lifecycle clears the purpose.
- **Shell-made changes.** In the new `threads/worktree-changes.ts`, each turn snapshots the worktree's dirty files (`git status --porcelain -z -uall`) before its prompt is sent. At the turn's end it diffs every file whose content changed, including untracked files and commits made during the turn. Those diffs are merged with the edit tools' diffs, and the git diff wins for a path both report. Paths are now relative to the worktree, edit-tool paths included, so one existing assertion changed from `/wt/src/a.ts` to `src/a.ts`. The snapshot is skipped when there is no worktree.
- **Terminal-era readback (`read.ts`).** A thread's transcript is now also found through any row of the same conversation (same `ccSessionId`), for both listing and events, on every kind. History rebuilt from a transcript whose last prompt got no answer ends in `process: stopped`, so it folds idle.
- **Web (`use-thread.ts`).** Each thread's log is kept in the query cache under its own key (`['runcastle.thread.log', id]`). Opening a thread whose log is already held invalidates the read after its cursor, so it always fetches. Found cause: on reopen, the hook reused the stale first read and then reset the cursor read to "empty" with `setData`, wiping out any pending invalidation.

## Surprises
- `chat-door.test.ts` assumed a turn finished within the same tick. A turn now waits a few milliseconds for its worktree snapshot, so the queued briefing is logged later. The test now reads the log after the wait.
- The host itself never logged `compacted`. The duplicate dividers can only come from the adapter, so the dedupe lives in the fold.

## Left undone
- Seeding a terminal-era thread's log with its transcript when it is first continued. Today, sending in such a thread starts a fresh log and the transcript turns drop out of view. That may be what the review saw on the preparation chat, but it is outside this ticket's "no log" scope.
- No real Codex adapter signal for the end of a self-started turn was found. The quiet timer is the fallback.
- Drive machinery: no new service, env var, seed or process, so `.runcastle/` is unchanged. I checked this by reading the diff, not by running anything.

### 17. What the human reads: thread names, list states, the runcastle line, tool rows, file paths, @ and / search

# Ticket 17 — what the human reads

## What was done
- **Thread names** (`packages/server/src/threads/naming.ts`, new): `threadName` is the human's rename, else the runtime's generated title only when the first non-hidden prompt was the human's (`runtimeMayName`), else the human's first message via `deriveTitle`, else an errand name ("Planning by itself" for `purpose: 'self-plan'`, "Scenario: writing scenarios" / "Scenario: setting scenarios up", "Fix: the test drive", "Working by itself" for a chat only runcastle has prompted), else "New chat". The host stores a generated title on the row only when `runtimeMayName` allows it. A row title that repeats a disallowed generated title (stored by the old host) is ignored, so existing "Runcastle project skill session" rows are renamed with no migration.
- **Paths**: `withRelativePaths` / `relativeToWorktree` in `acp-map.ts` are applied when `read.ts` reads a log. Tool rows, approvals and changes-card paths come out worktree-relative, for old logs too. They handle either separator and either drive-letter case.
- **Tool rows** (`Work.tsx` `callText`): when the ACP title already starts with a verb (Read/Write/Edit/Fetch/Search/Run), that verb replaces the kind's, so there is never a second one. MCP tools read as "runcastle: get feature context". CamelCase internal tools read as words ("Used tool search"). Titles that are already sentences (Load skill…, Create task…) show as they are.
- **Changes card**: the file name stays whole, and the folders before it truncate from the left.
- **Small fixes**: the runcastle line drops a leading `[runcastle]` tag (display only). The strip's `now` prop was removed; the strip now ticks itself every second. A thread scrolls back to its foot when an image loads.
- **Orchestrator card**: it now reads `thread.list({projectId})` instead of `project.projectSession`. It shows "Waiting for you" if any thread waits, "Working" with a spinner if any works, and idle otherwise. The `talk` prop was removed from `Sidebar`. `OrchestratorCard` now takes `state: ThreadState` instead of `waiting`.
- **Switcher states** were already in place from ticket 13. I only added a test for them.
- **`@` and `/` search**: a fuzzy ranker in core (`packages/core/src/fuzzy.ts`): prefix > word start > substring > scattered (best placement found by DP), then shorter first. A match on the file name ranks above the same match elsewhere in the path. `thread.files` now lists `--cached --others --exclude-standard` with a 10s cache, which the host clears at each turn end (`forgetWorktreeFiles`). `fuzzyFiles` was removed from `controls.ts`.
- **URL**: `?thread=<id>` is written with `replaceState`, never `pushState` (`useThreadInUrl` in `use-history-sync.ts`), on both the feature and project pages, and read back on mount.

## Surprises
- The column's effects run before `useHistorySync` moves the address to a new page, so `useThreadInUrl` defers its write by one tick.
- Tests in the same file share `window.location`, so `chat-column` and `project-drive-workspace` now reset the URL in `afterEach`.

## Left undone
- An unknown or deleted thread id in the URL is not checked against the list; it opens as a "New chat" stand-in.
- A scenario chat's name does not include the actual scenario name, because the row doesn't store it.
- `view.title` from the core fold still follows any generated title; the web doesn't use it.
- No screenshots: no browser was used.
- The drive machinery needed no change: no new service, environment variable or seed. Nothing was run.

### 19. Web: a thread never leaks to another feature; header fits at 900px and stays current; image threads open at the bottom

# Ticket 19 — digest

## What was done
- **Thread leak.** Added `useAddressedThread(absent, belongs)` to `apps/web/src/lib/use-history-sync.ts`. The feature column (`use-feature-chat-column.ts`) and the project page (`ProjectWorkspace.tsx`) now take a `?thread=` id from the address only after their own `thread.list` contains it. Each page's main or fallback thread and its drive's scenario chat also count as its own. Until the list loads the page shows its own default. A foreign id is dropped, and `useThreadInUrl` then writes the page's own front over it. Navigating already drops the query string, because `useHistorySync` pushes a bare path. The leak came from the new page's `useState(threadInUrl)` reading the old address before that push. The list check fixes it at that point, so the sidebar, backlog create and pasted links are all covered.
- **Header status.** Added `mainChatWorking(mainState, liveSession)` in `feature-ui/status-line.ts`. The header's `agentWorking` now comes from the main chat's own thread-list state (the column exposes `mainState`), which every `thread` live signal refreshes. It falls back to the session row's `awaitingInput` only while the list doesn't have the thread yet. I did not prove why the row bit stayed stale after a lead wake. One candidate: the web's `activeSession` picks the first active non-side row, while the server's `liveSessionOf` prefers a `live` row.
- **Header at 900px.** The switcher's wrapper is capped at `max-w-[clamp(6rem,16vw,18rem)]` and its title already truncates. In `FeatureStatusLine` the label truncates instead of being `shrink-0`, and the "why" part gives way first (`shrink-[100]`). There is no browser in the sandbox, so I took no screenshot. The test pins the classes, and the sizes at 900, 1100 and 1400px were worked out by hand.
- **Image threads.** `ChatThread` now uses a ResizeObserver on the content column plus the existing `load` listener to keep a thread at its foot while it is stuck there. Only a scroll *up* by the reader unsticks it. The likely cause of the bug was that a scroll event fired by the thread growing was read as "off the foot" before the image's `load` could follow it down. A cached image may also finish loading before the listener exists.

## Surprises
- With `bun run test`: 375 test files passed, 2 skipped; 5136 tests passed, 30 skipped; 0 failed. These counts are far above the baseline in the prompt.
- happy-dom does not fire `scroll` when `scrollTop` is set from code, so the thread records the position it scrolled to itself (`toFoot`).

## Left undone
- Attachments store no image dimensions, so heights are not reserved before load. The observer makes that unnecessary.
- The project page's switcher, which sits in the crumbs, was not width-checked.
- No drive-machinery change was needed: no new service, env var, seed or process.

### 21. Names, side-thread openings and terminal-era history

# Ticket 21 — names, side-thread openings, terminal-era history

## What was done
- **Naming.** Core has a new thread event, `{ type: 'briefed' }`. It means runcastle's words reached the conversation without showing as a message: the host logs it when the lifecycle's opening (a resumed main chat's state header, or the briefing after a lost conversation) rides with a prompt. The terminal-era seeding logs it too. `runtimeMayName` (threads/naming.ts) now lets the runtime's generated title in only when every visible prompt in the log is the human's and nothing was `briefed`. Otherwise the thread is named by the human's first message. Old rows that stored a generated title are still ignored, as ticket 17 did it.
- **Held openings.** `kickoffFor(ctx, row, { held: true })` and `sayToThread` with `holdOpening` now end the opening with "The human's message follows." (`HELD_OPENING_END` / `heldOpening` in launcher.ts). In its held form the side opening drops "Wait for the human's ask." (`sideKickoffFor(held)`). Openings sent alone are unchanged: side via `openSideSession`, scenario, drive-fix and self-plan.
- **Terminal-era history.** `seedFromTranscript` (threads/read.ts) runs at the start of `host.prompt` and `host.compact`. When a thread has no log, it writes the transcript's turns into the log with exactly the indices `threadEvents` gave them, then logs `briefed`. A client already holding the synthesized events reads on after its cursor, so the order is right live. A reload reads the whole log.
- **Web.** No web change was needed. The ordering bug in `use-thread` came from the new log restarting at index 0 under the held synthesized indices, so the client skipped the new prompt. Seeding fixes it at the source.
- **Tests:** thread-router.test.ts and thread-launch.test.ts.

## Surprises
- Held openings were already logged as visible runcastle prompts, so ticket 17's rule already covered them. The titles that leaked came from unlogged openings (the lifecycle's opening, startOver) and from terminal-era resumes. That is why an event was needed rather than a change to the wording rule.

## Left undone
- Seeded terminal-era agent messages have ids like `<row>-t<n>`. `lastAgentMessageId` (controls.ts) does not count them as made up, so editing or branching at a seeded message would try to fork at a made-up id.
- The briefing after a lost conversation (`startOver`) still rides after the human's words, and for a side thread it says "Wait for the human's ask." I left it alone.
- I did not read an ai-title out of terminal-era transcripts. A resumed chat keeps its cached row title, or else is named by its first message.
- Drive machinery: no new service, env var, seed or process, so `.runcastle/` is untouched.

### 22. Approval turns fold as one turn; Codex threads read and report like Claude ones

# Ticket 22 — digest

## What was done
- **Approvals fold as one turn** (`packages/core/src/thread.ts`). Before, `ask_resolved` called `splitTurn`, which cleared the turn's call map. That gave three bugs: the approved call stayed "Running…" in an already-settled fold, its later untitled update became a new blank "Used" row, and each approval started a new "Worked for" fold. Now an answer stays inside its turn. The fold pushes a marker segment that hides nothing but stops earlier words from counting as the answer. The answered lines go after the turn's single work item and before the answer. An approval `ask` adds its call as the turn's row when no `tool_call` came first, matched by `toolCallId`. An update's empty title never blanks an existing one. A denied approval marks its row failed, and every other call settles at turn end as before. The fold tests are built from claude-agent-acp's permission flow (`tool_call`, then a permission request on the same `toolCallId`, then title-less updates). The review's real log could not be reached from the sandbox.
- **Codex row text** (`Work.tsx` `callText`, `acp-map.ts` `toolPatch`):
  - `mcp.<server>.<tool>` titles now read like `mcp__` ones.
  - codex-acp's "Editing files" / "Edit files" title is replaced on the server with "Edit <paths>", taken from the diff content or the approval's `locations`. With no paths, the row reads "Edited files": a title that opens with an -ing verb now uses that verb in the call's tense.
  - "Guardian Review", "Image generation" and the subagent rows show as plain sentences.
  - Added verbs: List, View, Open, Find, Compact. "Web search: q" reads "Searched the web q".
- **Codex live work.** codex-acp (2.3.0) sends command output only in `tool_call_update._meta.terminal_output_delta` as `{data, terminal_id}`. That key applies to any non-AIR client that doesn't declare `_meta.terminal_output`, which includes us. MCP progress goes in `_meta.mcp_output_delta`. It never puts command output in `content`. The host dropped all of it. Reasoning already arrived as `agent_thought_chunk` (from `item/reasoning/summaryTextDelta`, `textDelta` and `summaryPartAdded`, with messageId set to the item id) and was already mapped. The tool event now carries `outputAppend`, which the fold appends to the call's output. The log coalesces these chunks per call, like text chunks.
- **Codex usage.** codex-acp exposes no rate limits to a client. It caches `account/rateLimits/updated` internally and only renders `/status` as markdown. So the side channel stays. Its bug: it spawned `codex` with a plain `spawn`, which cannot run npm's `codex.cmd` shim on Windows (codex-acp uses cross-spawn for exactly this). It now starts through `spawnTargetFor` and ignores the app server's own notifications and requests while waiting. It is tested against a fake app server (`test/support/fake-codex-app-server.mjs`). The initialize-then-read handshake was already correct.

## Surprises
- The Windows spawn cause is inferred from code, not seen running: the sandbox is Linux and the review digest was unreachable. If the meter is still empty on Windows, check `authStatus` and what `account/rateLimits/read` returns for that login.
- The full suite had one failure, a timing test in `kill-registry.test.ts` ("opens when an unkillable process runs out its deadline"). That file is untouched and passes 30/30 on its own. Everything else is green, and typecheck is clean.

## Left undone
- A steered message (or a hidden command) still calls `splitTurn`, which clears the call map. An update to a call from before the steer can still create a blank row, and that call's row can stay "Running". The ticket kept this out of scope.
- A running command's output only shows when its row is opened. The row itself shows no output tail.
- Drive machinery: the ticket adds no service, env var, seed or process, so `.runcastle/` needed no edit (nothing was run).

### 24. Names that make sense, rename that shows, branches named as branches, and a model pick that means a pick

# Ticket 24: thread names, rename, branch names, which model a thread restarts on

## What was done
- **Core** (`packages/core/src/thread.ts`): three new markers on thread events.
  - The `title` event takes an optional `renamed`.
  - The `model` event takes an optional `picked`.
  - A new `branched { from }` event names a branch. The fold ignores it.
  - A new pure helper, `lastPickedModel(events)`.
- **Rename** (`thread.rename`): it now logs `{ type: 'title', renamed: true }`.
  - `threadName` lets the last rename win over every other name.
  - In a branch, only renames logged after its `branched` event count, so a branch never takes its parent's rename.
  - The web already refreshes `thread.list` after a rename, and the header reads its name from that list, so no web change was needed.
- **Naming** (`threads/naming.ts`):
  - A feature's main chat with no human message is named after the feature's title. This holds for a chat that never started, one opened with Start, and a self-planning run once it is over.
  - "Planning by itself" shows only while the row's purpose is `self-plan`. `lifecycle.ts` clears that purpose when the run finishes or is stopped.
  - `MAIN_CHAT_NAME` ("Feature chat") is gone. `thread.list` gets the feature title through a new `threadAbout(ctx, featureId)`.
- **Branch**: `host.branch` logs `branched { from: <parent's current name> }`. The branch shows "Branch of <parent>" until the human writes in it; then its own first message after the branch point names it.
- **Model provenance** (`threads/host.ts`):
  - `setConfig` marks the model events it logs as `picked`, whether the agent is running or not.
  - A start logs its model as `picked` when a pick was waiting for that start.
  - `intendedConfig` restarts on `lastPickedModel` if there is one, else on `row.model`. The fold's last model is no longer used.
  - `modelEvent` now returns the narrowed model variant.
- **Launcher**: a new `refreshThreadModel` points a reused row at the model runcastle resolves now, unless the human picked one in that thread, and only within the same runtime. It runs wherever a launch reuses an existing row: the feature chat, a side thread reopen, prepare, drive-fix, a project reopen, and the docked scenario chat. The setter is `setSessionModel` in `sessions.ts`.
- **Tests** (all in `packages/server/test/`):
  - `thread-router.test.ts`: rename wins, main chat named after the feature, self-plan names while running and after.
  - `thread-controls.test.ts`: branch naming, restart on the row's model when the logged model was not picked, picked markers.
  - `launch-model.test.ts`: a reopen refreshes the model without a pick and keeps it with one.
  - `self-plan-launch.test.ts`: now expects the feature title where it expected "Feature chat".
- **Verification**: typecheck is clean, and `env -u GIT_ASKPASS bun run test` passes in full (375 files, 5165 passed, 30 skipped).

## Surprises
- Renames made before this change carry no `renamed` marker. On a thread runcastle opened, they still lose to the first message, exactly as before. Renaming such a thread again fixes it.
- Renaming a terminal-era thread that has no log yet creates a log containing only the title event. After that, the list and view read that log instead of the transcript. This is an existing problem I did not fix.

## Left undone
- `thread.models` still reports the fold's last model, picked or not, as `current`. Only restarts were changed.
- The web's stand-ins for a main chat that has no row yet still say "New chat".
- No drive machinery changed: no new service, env var, seed or process.

### 25. Fold and first paint: cost across restarts, no empty-thread flash, clean terminal-era history, one answer to a denial with a reason

# Ticket 25 — fold and first paint

**What was done**
- Cost across restarts (`packages/core/src/thread.ts`): `foldThread` now keeps a carried total. After a `process` event other than `running`, the next usage report's cost is checked: if it is lower than the last process's last cost, that cost is added to the carry. The meter shows carry + current. Covered by a fold test.
- First paint (`lib/use-thread.ts`, `ThreadColumn.tsx`, `thread/ChatThread.tsx`): `useThread` exposes `loading` while a started thread has neither a log nor a `thread.view` snapshot and its first events read is still pending. `ChatThread` takes a new optional `loading` prop. While it is set and there are no items, it shows a neutral "Loading the thread…" status line instead of the "New thread" welcome. Covered by tier-2 tests: a held read shows no welcome, and a really empty thread still shows it.
- Terminal-era readback (`packages/server/src/threads/read.ts`): `transcriptEvents` passes human turns through a new `typedText`. A slash command reads as its plain text (`/model sonnet`, `/clear`), and `<local-command-stdout|stderr|caveat>` entries are dropped. The fix is in read.ts only; `conversationTranscript` and the transcript viewer are unchanged.
- Denial with a reason (`host.ts` `answer()`): **mechanism is the steer.** Neither adapter can attach a message to a reject. claude-agent-acp's `permissions/effects.js` denies with a fixed "User refused permission to run tool" and reads no `_meta` on the response. codex-acp's command/file approvals have no message field; its `_meta` handling is only for MCP elicitations. So the reason is sent through `_session/steering` into the turn the approval holds open, before the denial is answered, as a hidden prompt. The `ask_resolved` line becomes `{ what: 'Denied —', answer: <reason>, denied: true }`. If the agent does not steer, or there is no turn, the reason is queued as the next prompt, still hidden, so it shows only on the denial line. Covered by host tests for both paths.

**Surprises**
- The old deny test asserted the two-turn behaviour; I replaced it.
- The denial line now shows the reason instead of the call's title. The call's row in the work block still names it and is marked failed.

**Left undone**
- The `loading` state ends when a read fails (`isPending` turns false). A thread whose reads all fail then shows the welcome. No error state was added.
- The drive machinery needed no change: no new service, env var, seed or process.

### 26. Codex: usage limits in the meter, readable command rows, no empty review rows

# Ticket 26: Codex usage limits, command rows and review rows

**What was done**
- `AgentHost.usage` (`packages/server/src/threads/host.ts`) now reads the runtime's limits whether or not the thread's agent is running. It never starts that agent. One read per runtime is cached for 60s (`USAGE_FRESH_MS`). If a read fails, it returns the last report, or `{ limits: [] }` if there is none. The fix covers Claude and Codex, since the method doesn't care which runtime it is.
- In `usage.ts`, Codex windows are now labelled by their exact length: 300 min is "Current 5-hour window", 10080 is "This week", and anything else is "Current N-day/hour/minute window". So 43200 minutes now reads "Current 30-day window". Before, any window of 7 days or more was called "This week". Claude's labels were already fixed per key and are unchanged.
- On the web side, `use-thread` exposes `refreshUsage`. `ContextMeter` takes an `onOpen` and calls it when its popover opens. The usage query also refetches when the thread goes from working to not working. React Query keeps the last answer on screen while it reloads.
- `Work.tsx`:
  - `innerCommand` strips the shell launcher (pwsh/powershell with -Command/-c, `cmd /c`, `bash|zsh|sh -c/-lc`) from execute rows and unquotes the script.
  - A "Guardian Review" that approved its action is hidden. A tools step left with no rows shows nothing.
  - A review still running reads "Checking with Codex's reviewer". One that stopped its action reads "Stopped by Codex's reviewer", and its verdict text still opens beneath it.
  - All of this is done when the row is displayed, not in `acp-map.ts`, so threads logged earlier read the same way.

**Surprises**
- In codex-acp 2.3.0, a guardian item is a `think` call titled "Guardian Review". Its content is text like "Status: …\nAction: …\nRisk: …\nRationale: …". The title is only sent on the start report.
- codex-acp already strips bash prefixes itself, but not pwsh or cmd ones.
- I tried `readCodexRateLimits()` for real against `/usr/local/bin/codex` in the sandbox. It hung until my 60s timeout, most likely because the sandbox codex is not signed in or has no network. So there is no real-account result from here.

**Left undone**
- The approval card shows a command's raw title, launcher included. I didn't apply `innerCommand` there.
- The subagent fold's "N calls" count still includes hidden reviews.
- I made no changes to the drive machinery; this ticket doesn't need any.

### 28. A model counts as picked only when the human picks it; unpicked threads follow Settings

# Ticket 28 — a model counts as picked only when the human picks it

## What was done
- **Server (host.ts):** at every start, `connect` now runs `followSettings(row)`. If the log has no human pick, the row is pointed at the model runcastle resolves for its kind right now (`resolvedThreadModel` in `threads/launch.ts`, the same `resolveModelEntry` step/project/config chain the launchers use). That model is written to `row.model` and used for both the ACP launch and the session config. A resolution on another runtime leaves the row alone. Because this applies to every start, a prep chat reopened by `thread.send` follows Settings too. I removed the launcher-only `refreshThreadModel` and its launcher-level tests in `launch-model.test.ts`, since the host tests now cover it.
- **Picked events:** the model logged as a process comes up is never marked picked. A pick that was waiting in `pendingConfig` is logged picked *before* the `process running` event. `lastPickedModel` (core) ignores a picked event that sits directly after `process running`, which is the shape round-13 logs have.
- **`thread.models`:** `current` is the live model while the agent runs. Otherwise it is the pending choice, then the human's pick, then what Settings resolve now. A thread that isn't running also returns the `effort`/`fast` the human chose (new optional fields on `ThreadModels`).
- **Web (use-thread.ts):** a send carries model/effort/fast only from `chosen`, i.e. what the human set in the picker. A thread that isn't running shows the server's `current`/`effort` rather than its last run's logged model. `thread.models` is refetched when the process state changes.
- Tests: host tests on the announcing fake agent (stale round-13 prep thread reopened by send; a Settings change moves an unpicked thread while a pick survives), core `lastPickedModel` tests, tier-2 tests (untouched send carries nothing; stopped thread's chip/effort follow the server).

## Surprises
- Finding 11 (effort shows Medium, then High): the catalog only learns a model's default effort from a session that *opened* on it. Before this fix the launch named the stale row model, so the intended model was always switched to after opening and its default effort was never learned. Now the launch names the right model, so that should resolve itself, but I couldn't check it against the real adapter.
- A human pick of effort alone, made before the first start, is logged as a picked model event, so it also pins that thread's model.

## Left undone
- `session.launching` events from a reopen still stamp the row's recorded model, which can be stale until the next start.
- No drive machinery change was needed: no new service, env var, seed or process.

### 29. A thread's link always opens that thread, on the feature page and the project page

# Ticket 29 — a thread's link always opens that thread

**What was done.** `useAddressedThread` (apps/web/src/lib/use-history-sync.ts) now returns `{ front, pick, pending }`. A `?thread=` id waits as `pending` until the page's `thread.list` answers. While it waits, the column shows a neutral `ThreadOpening` (exported from `ThreadColumn.tsx`; it has no composer, so nothing can be sent) and `useThreadInUrl(undefined)` writes nothing, so the id stays in the address. Once the list answers, the id is honoured if it belongs to the page; otherwise it is dropped as before. Both the feature column (`use-feature-chat-column.ts`, new `pending` field, rendered by `FeatureChat`) and `ProjectWorkspace` use this. On the project page, neither the resting list nor the running chat shows while an id is pending.

**Root cause.** Before its landing effect runs, `ProjectShell` renders the *stored* page, for example feature B or a feature when the address names the project chat. That page read the address's thread, judged it foreign, dropped it, and wrote its own main thread into the address. By the time the landing opened the page the address names, the id was gone. The fix is a new `AddressSettled` context. `ProjectShell` provides it as `landed`, and until it is true a page neither reads nor writes the address's thread. `useHistorySync` also keeps `location.search` when it replace-normalizes a load to the same page (new pure `samePage` in `routes.ts`). A push, i.e. in-app navigation, still drops it.

**Header (finding 3).** `FeatureStatusInput` gained `agentStateKnown`. When the thread list holds the main chat, its state alone decides Working, and a lead wake's 60s grace no longer holds the header on "Working" after the turn has ended.

**Tests.** Tier-2 tests in `chat-column.test.tsx` (late list, cross-feature paste through `AddressSettled`, foreign id dropped, in-app navigation drops `?thread=`, header vs thread state), `project-drive-workspace.test.tsx` (project chat link with a late list, foreign id dropped late), `history-sync.test.tsx` and `status-line.test.ts`. Typecheck and the full suite are green: 375 test files passed, 2 skipped.

**Surprises.** The cross-feature "paste" is a full reload in a browser, so it is the same race as a cold load. No in-app paste path exists.

**Left undone.**
- The sidebar still reads `liveSession.awaitingInput` ("Waiting on you"), while an idle main thread makes the header say "Talking with you". The two now agree on Working versus not, but not on wording for an idle thread. Aligning the sidebar to thread state is a separate change.
- While an id is pending, the header switcher still names the main chat.
- The root cause was found by reading the code, not by driving the app. A ProjectShell-level test of the landing race was not written; the `AddressSettled` mechanism is tested at the column.
- No drive machinery changed, and none was needed.

### 31. The agent's process: a restart keeps the preparation chat's conversation, and a crash reads like a person wrote it

# Ticket 31 — reload after a restart, and crash text

## What was done
- `packages/server/src/threads/host.ts`:
  - **Narrower "gone" check.** `conversationGone` became `saysConversationGone`. It no longer matches a bare `/not found/`, which also caught errors like "Claude native binary not found". It now matches only ACP -32002, "no conversation/session/thread/rollout" and "conversation/rollout not found".
  - **Disk check before starting over.** When the adapter says gone, the host now checks the new `conversationOnDisk` dependency. If Claude still has a transcript for that id, the start fails with "this conversation would not reopen… nothing replaced it" and `ccSessionId` is left as it was. The real adapter error goes to the server console.
  - **Same-id guard.** `startOver` refuses a `session/new` that comes back with the old id.
- `side-channels.ts`: new `claudeTranscriptOnDisk(id)`. It looks for `<id>.jsonl` in any `projects/*` dir under `CLAUDE_CONFIG_DIR` or `~/.claude`, since that is where `--resume` finds it. Codex keeps trusting its adapter's error.
- **Crash text.** The thread now shows "The agent stopped unexpectedly. Your next message restarts it." If stderr has a human-readable line (for example an auth error), it is included as "The agent stopped unexpectedly: <line>. Your next message restarts it." Debug-shaped lines are filtered out: `[tag]` lines, stack frames, JSON, and lines with several `key=value` fields. The full stderr is appended to `<sessionDir>/agent-stderr.log`.
- **Tests** in `test/agent-host.test.ts`:
  - a restart reloads by the same id and cwd;
  - a non-gone load error does not start a new conversation;
  - "gone" with the transcript still on disk does not start a new conversation;
  - a new conversation under the old id is refused;
  - debug-only stderr shows the short line and is written to the log file.
- The fake agent gained a `loadError` option.

## Surprises: the cause of the failed load
- **What I found.** claude-agent-acp 0.97.0 (`createSession`, dist/acp-agent.js ~9070) turns any Claude CLI exit before its `initialize` reply on a resume ("Query closed before response received") into -32002 "Resource not found". Runcastle believed it, so a CLI that failed to start for any other reason looked like a missing conversation and got replaced.
- **What I ran.** I reproduced against the real adapter with the sandbox's `claude` 2.1.295. That CLI has no credentials here, but it still writes a transcript.
- **What I ruled out.** A reload worked from the same cwd, from a *different* cwd (the CLI finds transcripts by id across all project dirs, so the cwd/case theory does not hold for this CLI version), with the old CLI left orphaned, and with runcastle's real flags.
- **What matched the review.** Loading a missing id gave -32002 with exactly the eight-line `[session/create] … phase=prepare-query` stderr from finding 7.
- **Not reproduced:** why the human's CLI exited at that resume, and the reported "transcript overwritten under the same id". The adapter's `session/new` always picks a random id, so the reviewer may have looked at the new conversation's file. The new same-id guard covers the claim either way.

## Left undone
- Codex conversations are not checked on disk, because their rollouts sit in a per-session synthetic `CODEX_HOME`.
- The failed-start text ("The agent could not start: <adapter error>") is not filtered the way crash text now is.
- No drive machinery changed: no new service, env var, seed or process.

### 32. What the thread shows: folded runcastle briefings, kept line breaks, honest ages, a fast cold load

# Ticket 32: what the thread shows

**What was done**
- Runcastle lines (`RuncastleLine` in `ChatThread.tsx`) now show only the first sentence of their first line, cut at a word if it runs past about 140 characters. The rest sits behind a quiet "Show more"/"Show less" text toggle. Short lines don't change, and the line's own look stays as approved.
- `Markdown` has a new opt-in `breaks` prop, using the new `remark-breaks` dependency. The agent's message (`AgentMessage`) and its narration in `Work.tsx` turn it on, so a single newline becomes a `<br>`. Documents still default to off, because their prose is hard-wrapped.
- `threadStateWords` returns '' for a missing or zero time, so old threads no longer show "20754d". The header thread list no longer shows the kind label ("Feature chat · …"), only the state words, and the project chat list leaves its meta empty when there's no age.
- Cold load: `setup.doctor` was **already** sent as its own request (`UNBATCHED_PATHS` in `apps/web/src/trpc.ts`, which `trpc-links.test.ts` covers). The ticket's diagnosis was out of date. What actually held the first paint was `useProjectNav`: it doesn't decide the landing (and so doesn't mount the project or its thread) until the doctor answers. The doctor's last verdict is now stored in localStorage (`runcastle.setupComplete.v1`). If the host was set up last time, the landing happens as soon as the project list arrives. If the fresh doctor then finds setup gone, a user who hasn't moved is sent to the wizard. A host with no stored verdict waits for the doctor, as before. Tests are in `project-nav.test.tsx`.

**Surprises**
- The splitLink fix already existed (ticket 3 of an earlier feature). The review's ~2s is the landing gate, not batching.
- `chat-column.test.tsx` asserted the old "Thread · 3m" subtitle. I updated it.

**Left undone**
- No browser was available, so there is no screenshot of a folded side-thread opening.
- `ConversationTranscript` (terminal-era threads) still renders without `breaks`.
- Drive machinery: no new service, env var or seed, so I didn't change anything under `.runcastle/`.

Verified: `bun run typecheck` is clean, and `bun run test` gives 375 files passed, 2 skipped, 0 failed.

### 33. One status rule: a lead that replied waits on the human in the header and the sidebar alike

# Ticket 33 — one status rule for a lead that replied

## What was done
- Core: `awaitsHuman(events, running)` in `packages/core/src/thread.ts` is the one rule. It is true when the agent's turn ended after the last prompt (a human message or a runcastle wake) and nothing has been sent since, whether or not the process is still up. It is also true for an open ask, but only while the process runs. A cancelled turn, a turn cut off by a stopped process, and a hidden command's turn (`/compact`) do not count as replies. Rewound events are skipped (`liveEvents`).
- Server: `leadAwaitsHuman(ctx, featureId)` in `threads/read.ts` applies the rule to the feature's main chat: the newest `chat` row that has a log. `feature.list` and `feature.get` both carry it as `leadAwaitsHuman`.
- Web, sidebar: `needsMe` now gives the `input` kind ("Waiting on you", amber dot) from `f.leadAwaitsHuman` instead of `liveSession.awaitingInput`.
- Web, header: `featureStatus` takes `leadAwaitsHuman` (from `full.leadAwaitsHuman` in `Workspace.tsx`) and reads "Waiting for you", with no reason after it, before falling back to "Talking with you". Explicit waiting reasons, a running round and a mid-turn agent all still win, in the same order as before.
- `host.logPrompt` now publishes a `turn` live signal, so a human message refetches `feature.list` and `feature.get` at once rather than when the next turn starts.
- Tests:
  - core rule unit tests;
  - server tests through the router caller with the fake ACP agent: reply, wake, mid-turn, idle stop, then a human message;
  - status-line unit cases;
  - a tier-2 test in `chat-column.test.tsx` that renders the header and the sidebar row together over the fake tRPC client, for a wake ending, a lead reply, a human message and an explicit reason. It replaces the three old header tests that pinned "Talking with you" after a turn ended.

## Surprises
- Asks had the same disagreement as replies: the header showed "Talking with you" while the sidebar showed "Needs you". The new rule covers asks too.
- The sidebar's working signal is still `liveSession && !awaitingInput`, and the header's is still the main thread's state. I left both as they were; they agree at turn boundaries. There is one known case where precedence differs: while the agent is mid-turn with a waiting reason set, the header shows the reason first and the sidebar shows working first. That predates this ticket.

## Left undone
- The Orchestrator card (`Sidebar.tsx` `chatsState`) still counts only an open ask (thread state `waiting`) as waiting, not a reply. Applying "replied" to every project chat would turn the card amber after every conversation. Decision 15 covers the feature lead only, so I left the card alone.
- No changes to the drive machinery were needed: no new service, env var, seed or process.

### 34. Honest undo, clean crash lines, the effort shown is the effort run, and deny-with-reason

# Ticket 34 — honest undo, clean crash lines, the effort shown is the effort run, deny-with-reason

## What was done
- **Undo:** the edit box's checkbox now reads "Also undo the agent’s file edits since — changes made by shell commands stay". `rewindClaudeFiles` (side-channels.ts) now returns the SDK's `filesChanged`. `AgentHost.fork` takes the rewound turns' `turn_ended.files` (edit-tool diffs plus ticket 16's git snapshot), subtracts what was restored (made relative with `worktreeRelative`), and logs one `notice` after the `rewound` event: "Left as they are — changed outside the agent’s edit tools, so not undone: a, b". If nothing was left, it logs nothing. Shell changes are never restored.
- **Crash and failed-start text:** `debugShaped` is replaced by a stricter `readsAsSentence`. A line is rejected if it has braces or brackets, a quoted JSON key, any `key=value`, a UUID or long hex id, a stack frame, or a warning prefix ("Unexpected case", "[warn]", "warning", "(node:N)", "deprecat…"). It must also contain at least two words. Both `crashText` and the new `failedStartText` use it. When no line passes, the thread shows the short line alone ("The agent could not start. Your next message tries again.").
- **Effort:** `threadModels` now returns `effort` = the catalog's `defaultEffort` for the current model. `AgentHost.models` uses it for a thread that is not running and has no pick. The catalog now learns a model's start level from any options an effort-unpicked session reports (a `config_option_update` after open, or a re-seed after a model-only switch), not only at open. A `default` that names no level no longer erases a level already known. Claude's `default` effort entry is read for a level it names ("Default (High)"), and `configRequests` asks for nothing when that level is already chosen. `Thread.effortPicked` stops a picked level from being learned as the start level.

## Surprises
- With runcastle as a "legacy" ACP client (no `recommendedValue` capability), claude-agent-acp 0.97.0 opens every session whose settings set no `effortLevel` on currentValue `default`, and leaves the level to the CLI. The concrete level (the SDK `system/init` message's `effort`) is never forwarded to the client. So when no session has ever reported a concrete level for a model, there is still nothing to learn, and the web's `effortShown` falls back to Medium. Making that case exact would need the Stop/PreToolUse hook's `effort.level` (Claude Code puts it in hook input) or pinning a level. I did neither.
- **Deny with a reason cannot ride the denial.** In claude-agent-acp 0.97.0, `permissions/effects.js` `parseClaudePermissionSelection` reads only `response.outcome.optionId`; `_meta` and any other field are ignored. `deny()` always sends the fixed `message: "User refused permission to run tool"`. codex-acp 2.3.0 maps options to app-server decisions, which have no message field. So `AgentHost.answer` is unchanged: the reason still follows as a steer or the next prompt, shown only with the denial.

## Left undone
- The stale comment in `apps/web/src/lib/use-thread.ts:242` ("the catalog learns the effort a model starts on as a session opens") is now only part of the story. I left it alone, since the web was otherwise untouched.
- The drive machinery doesn't need changes: no new service, env var, seed or process.

### 36. A replied lead turns amber at once; honest effort; the 1M model keeps its name

# Ticket 36 — digest

## What was done
- **Amber at once (cause found).** The race: Claude Code's Stop hook (`routes/hooks.ts`, inside the CLI) calls `markAwaitingInput` *before* ACP returns the prompt's end, and before the host's `turnFiles` git snapshot finishes. So the bit flipped and pushed `{ kind: 'turn' }` while the log had no `turn_ended` yet, and the browser's resync read `leadAwaitsHuman = false`. Then the host's own `markAwaitingInput` found the bit already set and published nothing, so the UI waited for the 30s safety poll. Fix: a new `Host.logAwaits` appends every event that can move `awaitsHuman` (turn_ended in `runTurn` and `endSelfTurn`, ask, ask_resolved) and always publishes `turn`, whatever the bit did. Reproduction test in `thread-router.test.ts`: the fake turn calls `markAwaitingInput` as the hook does, and the test reads feature.list and feature.get on each non-thread signal. It failed before the fix.
- **Effort shows Default.** `effortShown` (web `model-groups.ts`) now returns `'default'` when neither the held level nor the model's `defaultEffort` is one the model takes; it no longer guesses Medium. `EffortPicker` shows "Effort: Default", with a checked Default row above the levels while it is current. `use-thread` now passes the raw held level and `ModelControls` resolves it. One old test that expected "Medium" for an unknown level was rewritten.
- **1M survives the adapter report.** `modelCatalog` now adds each roster `[1m]` model as `"<adapter label> (1M)"` right after its base entry. It skips this when the adapter already offers one (`<base>[1m]` value, or a label that matches once "context" is ignored), and adds none when the base is not listed. `labelKey` now ignores "context", and `controls.ts` reuses it and the exported `LONG_CONTEXT`. In the host, `runsOn` logs the model of a session asked for a 1M roster model, which runs on the base value, as the catalog's 1M entry. So the chip, `current` and the answers' model name say "(1M)".

## Surprises
- With no 1M entry from the adapter, the existing test "runs a 1M model … on the same model" logged plain `sonnet`/"Sonnet 5". I changed it to expect the 1M entry (the session is still set to `sonnet`).
- The curated roster's 1M ids (`claude-opus-5[1m]`…) do not match the 5.5 adapter labels, so they add nothing unless their base is listed. That is intentional and keeps stale curated models out of the picker.

## Left undone
- `stop()`'s `turn_ended: cancelled` and `process: stopped` still use plain appends. A stop clears an open ask, and I did not check whether `ended()` publishes a `turn`/`event` signal for that case.
- Drive machinery: nothing new needed (no service, env var, seed or process). I did not run the scripts.
