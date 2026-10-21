# Several sessions per feature

## Problem

A feature has exactly one conversation today: the **main chat**, the feature's one `chat` session. It plans the feature, becomes the lead after Go, and is resumed by every Chat door. While it is busy (mid-grill, or running rounds as the lead) the human has nowhere else to talk about the feature. They cannot ask a quick question, do a small side task, or write a drive scenario without interrupting the main chat or opening a conversation that knows nothing. The human's words: "another side session to ask about something in the feature or start a new session to do something else… Each session should have the context of the feature and what we were doing."

The launcher enforces this with a guard: one live terminal per feature, refused otherwise. Every lookup that finds "the chat" (resume, lead delivery, the Chat door) assumes there is only one.

## Approach

### What the human sees

The feature's chat area gets a **session switcher** in its header (decision 10). It lists the main chat first, then live side sessions, then ended ones, plus a **New side session** action. Picking a live session shows its terminal. Picking an ended one shows its read-only transcript with **Reopen**. A side session that has finished a turn or waits on a permission prompt shows an amber waiting dot on its row and on the switcher (decision 12). The feature's status line and next-step bar are unchanged: they speak for the main chat.

**New side session** forks the main chat (decision 2). The new session holds everything said so far, then goes its own way. Its first message tells it what it is: a side session of this feature, forked from the main chat, not to carry on the main chat's task, what it may and may not do, and to wait for the human (decision 3). It is named after the first thing the human types in it, not the history it inherited (decision 8). Reopening an ended side session resumes its own conversation; it does not fork again.

Side sessions can be opened in all four states, any number at once, whatever the main chat is doing: live, ended, or running headless as a self-planning run or a lead wake (decision 7).

### Roles

The main chat alone steers (decision 4). Only it is the lead after Go and receives the lead's messages. Only it may call the steering tools: `complete_phase`, `emit_tickets`, `dispatch_round`, `stop_round`, `declare_ready`, `wait_for_you`. A side session gets every other tool the main chat has: the feature reads, docs edits, `update_ticket` / `cancel_ticket` (already refused at call time for a ticket a running burn has claimed), `resolve_finding`, `create_feature` draft parking, `record_event`. This holds in two places: the side kind's tool list leaves the steering tools out, and the server refuses a steering call that arrives from a side session.

The role is set in three places so it holds against the inherited history: the appended system prompt written at launch, the per-turn hook's label, and the first message.

### Where a side session works

A side session runs in the feature's **talk worktree**, the same folder as the main chat (decision 5). It may write exactly what the main chat may write in the current state: docs-only in planning (or whatever Design mode lets the planning chat write once that merges), anything after Go. Its commits land the way the main chat's do. Outside a burn that is straight onto `feature/<slug>`. During a burn it is the chat's temp branch (`runcastle/chat/<slug>/<unique>`), landed through the per-feature landing queue at the next chat landing or at run end. The briefing says the folder is shared and to stage only its own files. Sharing the folder also means `--resume` finds the main chat's transcript: Claude Code files conversations by the folder they ran in.

### The main chat hears what changed

Nothing a side session says is merged into the main chat's conversation. But the main chat's next turn is told what changed (decision 11). The per-turn `UserPromptSubmit` hook, which already injects the feature's state into every main-chat turn, adds one line. That line names the side-session changes since the main chat's last turn (docs files edited, tickets edited or cancelled, findings resolved) and points at `get_feature_context`. The record of those changes is fed by the side session's own MCP writes and by the file writes the existing pre-tool hook already sees for it. Once a turn has been told, its line is not repeated.

### Codex

Runcastle has no Codex fork (decision 6). On Codex, a side session starts a fresh conversation. Its first message carries the feature's state header, a quote of the main chat's last few turns read through the existing transcript reader, and the paths of the main chat's transcript and `decisions.md`, so it can read further back. If the installed Codex CLI has a real fork command, the build verifies that against the CLI and uses it instead. The same fresh start is the fallback on Claude Code when there is nothing to fork: no main chat yet, or its transcript is gone.

### The scenario chat

The scenario chat is the "New scenario" / "Fix it" chat docked beside a running drive (`scenario` kind). On a **feature** drive it now forks the main chat (decision 9). It keeps everything else: its kind, the drive's checkout, its write rules, its dock, and one-per-drive. While live it also appears in the feature's switcher. Its briefing says it works in the drive's checkout, since the inherited history is full of paths into the talk worktree. The main chat ran in the talk worktree, so the build must check that `--resume <main> --fork-session` finds it from the drive's checkout. If it does not, the scenario chat uses the Codex-style fresh start with the latest turns. A project drive's scenario chat is unchanged.

### Shape

- **A new session kind, `side`.** Every existing lookup keyed to `kind = 'chat'` keeps finding only the main chat, with no audit of each call site. That covers the most-recent-resumable query, `deliverToLead`'s "find the lead", the lead waker, the Chat door and the shipped feature's question list. The edit guard, install guard, lead shell guard and per-turn hook treat `side` like `chat` for write permission in the current state. The MCP audience table gives `side` the `chat` set minus the steering tools.
- **A fork column on the session row**: the main-chat row a side session (or scenario chat) forked from, and whether it forked or started fresh. Side sessions are grouped into conversations on `ccSessionId`, exactly as project conversations are, and named with the existing derived-title logic. The difference is that the search starts after the side session's own kickoff line, so the inherited main-chat turns never name it. The title is cached the same way.
- **The launcher.** A side launch skips the one-terminal guard (`assertSpawnable`) and the headless-running refusal, so it never blocks the main chat or drive-fix and is never blocked by them. It resumes the main chat's newest `ccSessionId` with `--fork-session` (new) for a new side session. It resumes the side session's own `ccSessionId` without fork for a reopen. The worktree keep-alive already counts any live session; that covers side sessions.
- **tRPC**: open a side session (new, or reopen by id), list the feature's sessions for the switcher (main chat, side sessions grouped by conversation, the live scenario chat, each with status and waiting flag), and read a side session's transcript. End uses the existing end-session path.
- **Web**: a switcher in the header of today's feature chat component, beside the existing terminal and transcript views. Design mode puts its own switcher in the same place; whichever merges second makes them one.
- **Feature deleted**: live side sessions end with the feature, the same way the main chat does. On Shipped they keep working like the main chat.

## Seams

- **The launcher's session launch for kind `side`** (existing seam, new kind). Observable in the argv built for each runtime: `--resume <main ccSessionId> --fork-session` for new, `--resume <side ccSessionId>` for reopen, the fresh-with-latest-turns kickoff on Codex or with nothing to fork. Also observable: the guard does not refuse while the main chat or a headless main chat is live, and the system prompt and kickoff carry the side role.
- **The MCP server's tool registration per audience, plus call-time refusal** (existing seam). Observable: `side` sees no steering tools, and a steering call carrying a side session's id is refused.
- **Lead delivery** (existing seam). Observable: with a side session live and the main chat ended, a lead message wakes the main chat, never the side session.
- **The edit guard decision per session** (existing seam). Observable: a side session in planning may write only `docs/features/<slug>/`, and after Go anything, matching the main chat.
- **The per-turn `UserPromptSubmit` hook response for the main chat** (existing seam). Observable: after a side session edits a doc or cancels a ticket, the main chat's next turn carries one line naming it, and the turn after does not.
- **The feature session list tRPC procedure** (new seam). Observable: the main chat first, side sessions grouped by conversation with derived titles that skip inherited turns, ended ones flagged, the waiting flag, and the live scenario chat on a feature drive.
- **The scenario launch on a feature drive** (existing seam). Observable: the fork flag on the argv, or the fallback kickoff.
- **The switcher in the feature chat header** (web component, new). Observable in a component test: grouping, the waiting dot, New side session, picking a live versus an ended row.

## Out of scope

- The page layout and the chat column. *Design mode* owns them; this feature adds a switcher to today's chat header only.
- Turning the terminal into web components. *Chat as web components* owns that.
- Side sessions on project chats. The project already has a conversation list with New chat.
- A separate worktree per side session (see Later laps).
- Promoting a side session to main chat (decision 13).
- Renaming side sessions.
- Charter text. Only the project session may write `CONTEXT.md`. When this lands, the project session should record in an ADR that "one conversation per feature" is now "one main chat per feature, plus side sessions".

## Open questions

- Whether the installed Codex CLI has a fork command. The burn checks the installed CLI; the fallback is specified either way.
- Whether `--resume <id> --fork-session` from the drive's checkout finds a conversation that ran in the talk worktree. The burn checks; the fallback is specified.
- Six decisions were challenged by an independent pass and stand as decided: 2, 3, 4, 6, 9 and 11. The mechanism parts of the challenges to 3, 4, 6 and 9 are folded into this spec because they do not change the decisions: the role set at launch too, server-side refusal, the transcript path, the cross-folder check. The challenges to 2 (add "Start fresh") and 11 (also name side-session commits) are left for the human.

## Later laps

- **A separate worktree per side session**, on its own branch landed into the feature branch through the per-feature landing queue. Only if two agents sharing the talk worktree collide in real use (decision 5).
- **"Make this the main chat"**: handing the main chat's role, lead queue and planning steps to a side session (decision 13).
- **A "Start fresh" secondary action** beside New side session, if forks of long main chats prove costly (the challenge to decision 2).
- **Renaming a side session.**
