# Chat as web components

## Problem

Every conversation with an agent in runcastle is a Claude Code or Codex terminal shown in an xterm view. Opening one means spawning the CLI and waiting for it, so the app needs "Resume the conversation" screens, auto-resume machinery and "the agent hasn't checked in yet" notices. Past conversations can only be read back as plain text, not opened and continued. The terminal can't take a design crop as an image, can't show what the agent waits on in a form the eye finds, and gives runcastle only keystrokes and hook side channels to talk through. Work the agent does while no terminal is open (a lead woken by a round's end, a feature planning itself) runs as an invisible headless process.

## Approach

### What the human gets

Every agent conversation — the feature chat, side threads, scenario and "Fix it" chats, the project chat, the preparation chat — is a **thread** rendered by runcastle's own components (decisions 3, 8). Threads behave like ChatGPT threads (decision 7):

- **Opening a thread is instant.** It renders from runcastle's own log, with no agent process involved. There is no Resume or Start screen and no End session.
- **Sending starts the agent if needed.** Your message shows at once with a quiet "Starting the agent…" until it is taken. While a turn runs, a message you send joins that turn (steering).
- **Every thread can be opened.** The header's thread list holds the feature's main chat, its side threads and scenario chats, finished ones included, with New thread. The project page lists the project's chats the same way.
- **What the agent waits on docks where the composer is.** That is an approval (yes; yes and don't ask again; no, and say what to do instead) or its questions, one at a time, with an "Other" answer and a summary page when there are several (decision 8).
- **Everything in the capability inventory** (`capabilities.md`, decision 11) is in. That covers images by paste, drop or paperclip; Select area crops as attachments (decision 5); `@` files and `/` commands; the model, effort and fast mode per message (decision 9); and the turn's work folded to "Worked for 3m 43s" with a changed-files card. It also covers the task list and background commands, the context and usage-limits meter, and edit/rewind/branch (decision 10).

The look is approved and committed. The components live in the web app's chat thread folder. The preview page `/preview/chat.html` shows every moment. Wiring them connects them; it never restyles them.

### How it works

**One protocol for both runtimes (decisions 1, 2).** The server is an ACP client. For each running thread it spawns the runtime's official adapter as a child process over stdio:

- `@agentclientprotocol/claude-agent-acp`, with `CLAUDE_CODE_EXECUTABLE` set to the human's installed `claude`.
- `@agentclientprotocol/codex-acp`, with `CODEX_PATH` set to the human's installed `codex`.

It speaks ACP through `@agentclientprotocol/sdk`. Adapter versions are pinned exactly. A doctor probe reports when an installed CLI is older than the pinned adapter needs, and says to update it.

The per-session briefing stays what it is today:
- **Claude:** the settings file with its hooks and guards, the MCP config, the plugin dir, the system prompt file, the permission mode and the model reach the adapter's Agent SDK as CLI arguments through the session's `_meta.claudeCode.options`.
- **Codex:** keeps its synthetic per-session `CODEX_HOME` (config, hooks, AGENTS.md, auth).

The runtime adapter seam (`AgentRuntimeAdapter`) grows one method that describes an ACP launch (command, env, session `_meta`) beside today's argv launch. Program-output terminals (dev-server panes, design server output, the Settings AFK flows) keep the PTY path untouched.

**The agent host.** A new server module owns every running agent connection. Its responsibilities:

- **Starting.** It starts a thread's adapter lazily, on the first prompt. It calls `session/load` when the thread has an agent conversation id, `session/new` otherwise. The agent id comes back from ACP and is recorded on the row, replacing the SessionStart-hook dependency for liveness.
- **Prompts.** `prompt(threadId, content, { source })` sends a turn. A human prompt while a turn runs steers into it (`_session/steering`). A runcastle prompt waits for the turn's end, as lead delivery does today.
- **Stopping a turn.** It cancels the running turn (`session/cancel`).
- **Answers.** It answers what the agent waits on. A permission request or an `AskUserQuestion` elicitation becomes the thread's pending ask, and the human's answer resolves it.
- **Idle stop.** It stops a process after 30 idle minutes, never while an ask is pending (decision 7). It stops everything on shutdown.

At boot no process runs and every thread is idle; nothing is "ended" in a way the human sees.

**The thread log.** Every ACP session update, every prompt sent and every ask and its answer is turned into a runcastle **thread event** and appended to the thread's log, a JSONL file in the session's data dir. Thread events are a core contract, IO-free, in `@runcastle/core`:

- A thread event carries a monotonic index, a timestamp and one of these payloads: user prompt (with images and source), agent text chunk, thought chunk, tool call and its updates, plan, subagent, ask opened and resolved, turn started and ended (with duration and the changed files), usage and context, model change, compaction, error.
- A pure reducer `foldThread(events) → ThreadView` produces exactly what the components render. `ThreadView` holds the items, the state (`working | waiting | idle`), the pending ask, the plan, background tasks, context use, the current model, effort and title.

The web's thread types (`ThreadItem`, `Ask`, `PlanEntry`… today in the web app's `chat-thread` lib) move into core as that reducer's output. The web re-exports them, so the designed components keep compiling.

The server folds the same events for its own needs: the thread list's state and title, the sidebar's waiting dot (today's `awaitingInput`), and `humanTypedAt`, now set when a human prompt is sent rather than by the UserPromptSubmit hook.

**Live updates.** Appending an event publishes a new live signal `{ kind: 'thread', threadId }` on the existing bus and `/api/stream`. The web fetches events after its cursor (`thread.events({ threadId, after })`), the same pattern the burn transcripts use, and folds them with the same reducer. A token-by-token chunk stream is coalesced on the server so the bus is not flooded.

**Threads and session rows.** A thread is a session row of a conversation kind (`chat`, `side`, `scenario`, `drive-fix`, `project`, `prepare`). From now on a thread keeps one row for its whole life. Starting and stopping its process changes the row's process state, and never creates a new row. `status` keeps its column but now means the process (`launching | live | ended` = starting, running, stopped), and the human never sees it.

- **Terminal-era threads.** A feature's main chat continued across many rows. Those are listed once per distinct agent conversation, newest row first. They open read-only through today's transcript reader (plain turns). Sending in one resumes that conversation into a new log on that row.
- **One main chat.** The "one live session per feature" guard becomes "one main chat thread per feature". Side and scenario threads can run beside it, as side sessions do today.

**The tRPC surface** is one new router, `thread`:
- reads: `list` (by feature or project), `events` (after a cursor), `view` (a folded snapshot for first paint)
- turns: `send` (text, images as base64, model/effort/fast for this message), `stop`, `answer` (an ask id and the answer)
- threads: `new` (a side thread, or a fresh project chat), `branch` (from a message), `edit` (rewind to a message and send, with `undoFiles` on Claude)
- controls: `setModel`, `compact`, `usage` (limits and account), `files` (worktree file list for `@`), `rename`, `export`

Today's launch procedures (`feature.launchSession`, `talkToProject`, `talkToPrep`, `openSideSession`, `openScenarioChat`, `fixDrive`) keep their names. Each now returns a thread id and sends its kickoff as the thread's first prompt (a runcastle-tagged line, shown as a runcastle line), instead of spawning a PTY. `feature.endSession` survives only for archive and delete. `design.sendCrop` is retired: the crop goes from the design pane straight into the composer, on the web side.

**What runcastle sends an agent.**
- **Lead delivery** (Go, a round's end, Stop, the orchestrator's `send_to_feature`) becomes `host.prompt(leadThread, text, { source: 'runcastle' })`, which starts the chat if no process runs (decision 6).
- **Removed:** the headless lead waker, the asyncRewake waiter hook, `codex queue` delivery and typed-terminal delivery.
- **The orchestrator's lines to the project chat** use the same queue.
- **Kickoff overrides** (resolve a conflict, stop a drive and iterate, a scenario follow-up) are sent as prompts into the thread.
- **Every resumed main chat** still gets the fresh state header with the first prompt after its process starts (one-chat-per-feature decision 13).

**Self-planning stays unattended (decision 6).** A thread started with `purpose: 'self-plan'` is marked unattended. Its brief still says nobody is watching, and the host answers its permission requests and questions with a refusal so it cannot hang. It is otherwise an ordinary thread the human can open, watch and type into.

**Hooks and guards stay.** The CLIs still read the per-session settings and hooks:
- **PreToolUse guards** (the edit, install and lead guards) keep working unchanged.
- **The UserPromptSubmit status line** still annotates prompts.
- **SessionStart, Stop and SessionEnd** stop being the source of liveness and turn state. The host knows both from ACP. Their handlers stay tolerant of either path.
- **Approvals.** Sessions launched with `bypassPermissions` today keep it, so approvals appear where they appear now (mostly shell commands in the preparation and scenario chats).

**Going back and controls (decisions 9, 10).**
- **Model, effort and fast mode** are ACP session config options, set before a prompt when they changed. A model change is a thread event and shows as a divider.
- **Edit** rewinds the conversation by forking at the message and continuing on the fork (the adapters' `session/fork`; Codex `SessionFork`). With `undoFiles`, on Claude, it first restores the files from Claude Code's checkpoints. The thread's log is cut at that message, and the cut events are kept in the log file as superseded rather than deleted.
- **Branch** creates a new side thread, forked at the message.
- **Usage limits and account** come from the adapters (Claude's structured `/usage` and `authStatus`; Codex's rate limits and auth status).
- **Context and cost** come from ACP usage updates.
- **Titles** come from the runtimes' generated titles and can be renamed.
- **Prompt suggestions** come from Claude's `promptSuggestions`.

### Docs this changes

The project's charter (`CONTEXT.md`) locked decisions #3 ("the app never rebuilds the chat UX"), #4 (context injection is hooks-first) and #13 ("terminals are server-owned PTYs streamed to xterm") are reversed or narrowed by this feature. Only the project session may edit the charter, so the amendments are listed for it under Open questions. A new ADR, **0015 — Agent conversations run over ACP**, records the decision and supersedes the parts of ADR-0009 (the kickoff rides argv; nothing is typed) that no longer hold for conversations. `apps/web/STYLE.md`'s description of the chat surface is updated with the wiring.

## Seams

- **`foldThread(events) → ThreadView`** (new, core, pure). This is the one place thread behaviour is decided: folding, live versus settled turns, asks, plan, model dividers, rewind cuts. It is tested with event fixtures and is the seam most behaviour should be tested at.
- **The agent host** (new, server): `start`, `prompt`, `cancel`, `answer`, `setConfig`, `fork`, `stop`, `onEvent`. It is tested against an **in-process fake ACP agent** built with `@agentclientprotocol/sdk`'s agent side and connected over an in-memory stream, so no CLI is spawned in tests. The fake scripts session updates, permission requests and elicitations.
- **The `thread` tRPC router** (new, server). It is tested through the router caller with the fake agent behind the host.
- **`AgentRuntimeAdapter.acpLaunch`** (existing seam, new method). Pure and tested like today's `writeArtifacts` / `buildClaudeArgs`: given a launch input, it returns the command, env and session `_meta`.
- **The launch procedures and `deliverToLead`** (existing). Tested with the fake agent: they now return thread ids and send kickoffs and wakes as prompts.
- **`ChatColumn`** (new, web). It takes a thread id and renders the designed components. Tested with tier-2 component tests against a fake tRPC client, the same way the existing chat tests mock it.

## Out of scope

- The feature page and project page layout: header, panel, sizing (design mode owns it). The thread switcher sits where today's session switcher sits: in the feature header's actions, and as the crumb on the project page.
- Program-output terminals: dev-server panes, design server output, the Settings AFK checklist's sign-in, setup-token and image-build terminals (decision 3).
- The CLIs' own settings screens, login, themes, vim mode, `!` shell mode and the `/resume` picker; plan mode and the permission-mode switch (decisions 4 and 11).
- Switching a thread between Claude and Codex (decision 9).
- Burn agents: they stay headless in sandcastle, unchanged.

## Open questions

- **Charter amendments, for the project session.** `CONTEXT.md` #3 (the app now renders agent conversations itself, over ACP), #4 (context injection: the briefing files plus ACP; hooks remain for guards) and #13 (agent conversations are no longer PTYs; PTYs remain for program output).
- **Adapter fit, to be confirmed by the first round's tickets:**
  - whether claude-agent-acp's `_meta.claudeCode.options.extraArgs` carries every flag runcastle passes today (`--settings`, `--mcp-config`, `--plugin-dir`, `--append-system-prompt-file`);
  - whether codex-acp honours a per-session `CODEX_HOME` and its `hooks.json`.

  The fallback for either is the adapter's own option for the same setting. A gap that has no such option is reported back rather than worked around.
