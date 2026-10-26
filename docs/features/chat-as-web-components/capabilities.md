# What a chat can do — the inventory

Everything a person does in Claude Code's or Codex's terminal, and where each lands in
the web chat. "Adapter" names what the ACP adapters already carry (checked against
`claude-agent-acp` and `codex-acp` on 2026-10-26), so the work is ours only on the web
side. Every row is in scope (decision 11); the last section is what is not rebuilt, and why.

## Writing to the agent

| Capability | Status | How | Adapter |
|---|---|---|---|
| Multi-line message, Enter sends, Shift+Enter breaks | in | composer | — |
| Images by paste, drop anywhere on the thread, or the paperclip | in | chips above the text | images, both |
| Select area crops from design | in | land as chips (decision 5) | images |
| `@` a file to point the agent at it | in | `@` lists worktree files, fuzzy | resource links, both |
| `/` commands and skills | in | `/` lists the adapter's command list | both |
| Recall your last message (↑ in an empty box) | in | composer | — |
| Prompt suggestion (the agent's guess at your next message, Tab takes it) | in | ghost text in an empty box | Claude (`promptSuggestions`) |
| Draft kept per thread across reloads and thread switches | in | browser storage | — |
| Send while the agent works (steering) | in | Enter joins the running turn; marked "Sent into the running turn" | both (`_session/steering`, Codex `SteeringQueue`) |
| Interrupt (Esc) | in | Stop button and Esc | `session/cancel`, both |

## Choosing how it runs

| Capability | Status | How | Adapter |
|---|---|---|---|
| Model per message | in | picker in the composer; a divider marks a change | config option, both; mid-conversation change works on both |
| Effort / reasoning level | in | same picker | Claude `effortLevel`, Codex reasoning effort |
| Fast mode | in | a picker row where the runtime offers it | both (`FastModeConfig`, Claude fast mode) |
| Switch runtime mid-thread (Claude → Codex) | out | a thread belongs to one runtime's conversation; start a new thread instead | — |
| Permission mode / plan mode | out | decision 4 | — |

## Watching it work

| Capability | Status | How | Adapter |
|---|---|---|---|
| Live tool calls with verb and target | in | rows; the call in flight shimmers | tool_call updates |
| Output of commands, diffs of edits | in | click a row | tool_call content |
| Thinking | in | "Thought for 6s", opens to the text | thought chunks |
| Subagents | in | one row per subagent, opens to its calls | child sessions, both |
| Task list (Claude's todos, Codex's plan) | in | strip over the composer: "2 of 5 · current step" | plan updates, both |
| Background commands, with Stop | in | rows on the same strip | async tasks, both |
| Settled turn folds to "Worked for 3m 43s" | in | final words stay in view | — |
| What a turn changed: "2 changed files +29 −12" | in | card under the answer, per-file diffs | file-change report / diffs |
| Elapsed time while working | in | "Working · 1m 19s · Esc to stop" | — |
| Compaction | in | divider "Conversation compacted" | compaction updates, both |
| MCP server status (`/mcp`) | in | as a slash command; the adapter renders it | both |
| Web search, image generation, review events (Codex) | in | rendered as tool rows with their own verb | Codex events |

## Answering it

| Capability | Status | How | Adapter |
|---|---|---|---|
| Approvals: yes / always / no-and-say-why | in | docked in place of the composer; digits answer | permission requests |
| Edit approvals show the diff first | in | diff in the dock | permission request carries it |
| Multiple-choice questions, one at a time, Other, summary page when >1 | in | docked in place of the composer | `AskUserQuestion` via elicitation |
| MCP elicitation (a server asks for a form or a URL) | in | URL: a link to open; form: simple fields in the dock | elicitation, both |

## Going back

| Capability | Status | How | Adapter |
|---|---|---|---|
| Edit a past message (rewinds the conversation to there) | in | pencil on hover; "Rewind and send" | `session/fork` + resume at a message (Claude); Codex `SessionFork` |
| Also undo the agent's file changes since then | in | checkbox in the edit box, Claude only | Claude file checkpoints (`rewindFiles`); Codex has none |
| Branch a new thread from any message | in | branch icon on hover | `session/fork`, both |
| Retry the last answer | in | = edit the last message unchanged | as above |
| Copy a message as Markdown | in | copy on hover | — |
| Export a thread as Markdown | in | thread menu | — |

## Knowing where you stand

| Capability | Status | How | Adapter |
|---|---|---|---|
| Context used (`/context`) | in | ring by the composer; opens to the numbers | usage updates |
| Thread cost (`/cost`) | in | same popover | Claude cost; Codex token counts |
| Usage limits (Claude `/usage`, Codex `/status`) | in | same popover: 5-hour window, weekly, per-model | Claude `/usage` structured; Codex `RateLimitsMap` |
| Which account and plan | in | same popover ("Claude Max") | `authStatus` push, both |
| Which model answered | in | under each answer, on hover | — |
| Thread titles | in | generated by the runtime, renameable | Claude session titles, Codex `TitleGenerator` |
| A thread waiting on you, elsewhere | in | dot in the thread switcher | — |
| Notify when a thread finishes or waits | in | runcastle's existing notifications | — |
| Find in thread | in | the browser's own Ctrl+F works on real text | — |

## Not rebuilt

- **Login and logout** stay in the CLI; the Settings AFK checklist keeps its terminal for them (decision 3).
- **`/config`, `/permissions`, `/hooks`, `/memory` editors, themes, vim mode, keybindings**: the CLI's own settings screens. The app has its own theme; the rest stays in the CLI.
- **`!` shell mode** (run a command yourself inside the session): not available in SDK mode; the app has terminals for that.
- **The CLI's `/resume` picker**: the thread list replaces it.
- **Plan mode and the permission-mode switch**: decision 4.
