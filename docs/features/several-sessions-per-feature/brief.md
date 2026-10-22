# Brief

## Why this feature exists
The human, 2026-10-21, while planning *Design mode*: "I feel like one thing we really need is multiple sessions within a feature. It makes sense that I would want to have another side session to ask about something in the feature or start a new session to do something else, etc.. Or in this case, create the scenario. Each session should have the context of the feature and what we were doing."

## Why it was parked
It reverses the core rule of *one-chat-per-feature* (one live conversation per feature, one transcript resumed by every door), which needs its own grilling. The human plans to run it **in parallel** with *Design mode*, accepting easy-to-fix merge conflicts, so no dependency was set.

## Known starting points
- Claude Code can fork a conversation: `claude --resume <id> --fork-session` starts a new session holding everything said so far, and leaves the original untouched (verified against the Claude Code docs, 2026-10-21). A side session forked from the main chat knows the feature and "what we were doing". The Codex runtime needs its own answer.
- *Design mode* puts a **session switcher** in the chat column's header (the feature page becomes chat-first, with one resizable panel on the right). In design mode it lists the feature chat and the scenario chat during a drive errand. This feature adds side sessions to that same switcher. Whichever merges second reconciles the column.

## What it must decide
- Fork the main chat or start fresh with the feature's state, and whether the human picks per session.
- Which session is the lead after Go, and which may write tickets, report planning steps or dispatch rounds.
- Two sessions editing code in one worktree at once (the planning chat may edit code under *Design mode*): share it, or give a side session its own worktree.
- How side sessions' commits land during a burn (today only the one chat has a temp-branch landing path).
- Naming, ending and finding old side sessions. The launcher's "one live session per feature" guard.
- Whether the scenario chat becomes just another side session.

## What it must NOT swallow
- The page layout and the chat column. *Design mode* owns them.
- Turning the terminal into web components. *Chat as web components* owns that.
