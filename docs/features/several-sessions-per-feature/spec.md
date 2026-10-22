# Several sessions per feature

## Problem

A feature has exactly one conversation today: the **main chat**, the feature's one `chat` session. It plans the feature, becomes the lead after Go, and is resumed by every Chat door. While it is busy (mid-grill, or running rounds as the lead) the human has nowhere else to talk about the feature. They cannot ask a quick question, do a small side task, or write a drive scenario without interrupting the main chat or opening a conversation that knows nothing. The human's words: "another side session to ask about something in the feature or start a new session to do something else… Each session should have the context of the feature and what we were doing."

The launcher enforces this with a guard: one live terminal per feature, refused otherwise. Every lookup that finds "the chat" (resume, lead delivery, the Chat door) assumes there is only one.

## Approach

### What the human sees

The feature's chat area gets a **session switcher** in its header (decision 10). It lists the main chat first, then live side sessions, then ended ones, plus a **New side session** action. Picking a live session shows its terminal. Picking an ended one shows its read-only transcript with **Reopen**. A side session that has finished a turn or waits on a permission prompt shows an amber waiting dot on its row and on the switcher (decision 12). The feature's status line and next-step bar are unchanged: they speak for the main chat.

**New side session** starts a fresh conversation; nothing is forked (decision 14). Its first message carries three things:
- the feature's current state, the same short header the chat kickoff uses;
- the main chat's last few turns, quoted with a cap of about two thousand tokens, with runcastle's own kickoff lines left out;
- the paths of the main chat's full transcript and `decisions.md`, so it can read further back when asked.

Claude Code and Codex start the same way. The first message also tells it that it is a side session of this feature and what it may and may not do (decision 15), and to wait for the human (decision 3). It is named after the first thing the human types in it (decision 8). Reopening an ended side session resumes its own conversation.

Side sessions can be opened in all four states, any number at once, whatever the main chat is doing: live, ended, or running headless as a self-planning run or a lead wake (decision 7).

### Roles

Only the round loop belongs to the main chat (decision 15). The main chat plans and, after Go, is the lead:
- It alone receives Go and the messages a round sends back.
- It alone may call the four round tools: `dispatch_round`, `stop_round`, `declare_ready` and `wait_for_you`.

A side session gets every other tool the main chat has. That covers the feature reads, `complete_phase`, `emit_tickets`, `update_ticket` / `cancel_ticket` (already refused at call time for a ticket a running burn has claimed), `resolve_finding`, `create_feature` draft parking, and `record_event`.

The rule holds in two places. The side kind's tool list leaves the round tools out, and the server refuses a round-tool call that arrives from a side session. The server already refuses a second round while one runs. Nothing else is guarded: the human is trusted not to drive two sessions at the same thing (decision 18).

The side role is set in three places so it holds:
- the appended system prompt written at launch;
- the per-turn hook's label;
- the first message.

A `/clear` in the main chat keeps it the main chat (decision 16). The role belongs to the session row, not to the conversation: runcastle already moves the row onto the post-clear conversation. The excerpt for a side session opened after a clear is read from the main chat's current transcript, so it quotes the turns since the clear.

### Where a side session works

A side session runs in the feature's **talk worktree**, the same folder as the main chat (decision 5). It may write exactly what the main chat may write in the current state: docs-only in planning (or whatever Design mode lets the planning chat write once that merges), anything after Go. Its commits land the way the main chat's do. Outside a burn that is straight onto `feature/<slug>`. During a burn it is the chat's temp branch (`runcastle/chat/<slug>/<unique>`), landed through the per-feature landing queue at the next chat landing or at run end. The briefing says the folder is shared and to stage only its own files.

### The scenario chat

The scenario chat is the "New scenario" / "Fix it" chat docked beside a running drive (`scenario` kind). On a **feature** drive, its first message now carries the same feature state and main-chat excerpt as a side session (decision 17). Everything else is unchanged: its kind, the drive's checkout, its write rules, its dock, and one-per-drive. While live it also appears in the feature's switcher. A project drive's scenario chat is unchanged.

### Shape

- **A new session kind, `side`.** Every existing lookup keyed to `kind = 'chat'` keeps finding only the main chat, with no audit of each call site. That covers the most-recent-resumable query, `deliverToLead`'s "find the lead", the lead waker, the Chat door and the shipped feature's question list. The edit guard, install guard, lead shell guard and per-turn hook treat `side` like `chat` for write permission in the current state. The MCP audience table gives `side` the `chat` set minus the four round tools.
- **One excerpt builder**, shared by side sessions and the scenario chat. It reads the main chat's current transcript with the existing transcript reader, drops runcastle's kickoff lines the way the conversation transcript read already does, and caps the quote. A quote too long for the CLI's argv kickoff limits goes to a file in the session's artifacts directory, and the kickoff points at it.
- **The session row** records which main-chat row a side session was opened beside. Side sessions are grouped into conversations on `ccSessionId`, exactly as project conversations are, and named with the existing derived-title logic. The title search starts after the side session's own kickoff, which carries the quoted excerpt, and it is cached the same way.
- **The launcher.** A side launch skips the one-terminal guard (`assertSpawnable`) and the headless-running refusal, so it never blocks the main chat or drive-fix and is never blocked by them. A new side session starts fresh. A reopen resumes the side session's own `ccSessionId`. The worktree keep-alive already counts any live session, which covers side sessions.
- **tRPC**: open a side session (new, or reopen by id), list the feature's sessions for the switcher (main chat, side sessions grouped by conversation, the live scenario chat, each with status and waiting flag), and read a side session's transcript. End uses the existing end-session path.
- **Web**: a switcher in the header of today's feature chat component, beside the existing terminal and transcript views. Design mode puts its own switcher in the same place; whichever merges second makes them one.
- **Feature deleted**: live side sessions end with the feature, the same way the main chat does. On Shipped they keep working like the main chat.

## Seams

- **The launcher's session launch for kind `side`** (existing seam, new kind). Observable in the kickoff and argv built for each runtime:
  - a fresh start whose first message carries the state header, the capped excerpt and the two paths;
  - `--resume <side ccSessionId>` for a reopen;
  - the guard not refusing while the main chat, or a headless main chat, is live;
  - the system prompt and kickoff carrying the side role.
- **The MCP server's tool registration per audience, plus call-time refusal** (existing seam). Observable: `side` sees no round tools but does see `complete_phase` and `emit_tickets`, and a round-tool call carrying a side session's id is refused.
- **Lead delivery** (existing seam). Observable: with a side session live and the main chat ended, Go or a round's message wakes the main chat, never the side session.
- **The edit guard decision per session** (existing seam). Observable: a side session in planning may write only `docs/features/<slug>/`, and after Go anything, matching the main chat.
- **The feature session list tRPC procedure** (new seam). Observable:
  - the main chat first;
  - side sessions grouped by conversation, titled from the human's first message;
  - ended ones flagged, and the waiting flag;
  - the live scenario chat on a feature drive.
- **The scenario launch on a feature drive** (existing seam). Observable: its kickoff carries the excerpt.
- **The switcher in the feature chat header** (web component, new). Observable in a component test: grouping, the waiting dot, New side session, picking a live versus an ended row.

## Out of scope

- The page layout and the chat column. *Design mode* owns them; this feature adds a switcher to today's chat header only.
- Turning the terminal into web components. *Chat as web components* owns that.
- Forking a conversation (`--fork-session`). It costs too much context (decision 14).
- Side sessions on project chats. The project already has a conversation list with New chat.
- A separate worktree per side session (see Later laps).
- Promoting a side session to lead (decision 13).
- A notice to the main chat of side-session changes (decision 18).
- Renaming side sessions.
- Charter text. Only the project session may write `CONTEXT.md`. When this lands, the project session should record in an ADR that "one conversation per feature" is now "one main chat that leads, plus side sessions".

## Open questions

- None blocking. Decision 5 (sharing the talk worktree) is the one assumption the human has not confirmed; a test drive will show whether two agents in one folder collide.

## Later laps

- **A separate worktree per side session**, on its own branch landed into the feature branch through the per-feature landing queue. Only if two agents sharing the talk worktree collide in real use (decision 5).
- **"Make this the lead"**: handing the round loop, the lead's messages and Go to a side session (decision 13).
- **A notice to the main chat** naming what side sessions changed since its last turn, if a lead acting on stale state shows up in practice (decision 18).
- **Renaming a side session.**
