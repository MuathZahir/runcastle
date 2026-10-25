# Brief

## Why this feature exists
The human, 2026-10-20, while planning *Design mode*: "One thing I was thinking of for some time now is moving from a terminal to actual web components (text input, messages, etc..). Of course this would be done in a separate feature."

Today every chat is a Claude Code (or Codex) terminal in an xterm view. *Design mode* replaces the feature page's Overview and Chat tabs with one page that has a permanent chat column beside a main area. This feature fills that column with web components instead of the terminal.

## Why it was parked
It is its own feature with its own decisions, and it must not hold *Design mode* up. It waits on design mode so the column it fills exists and does not move.

## Known starting points
- Claude Code's headless mode streams messages as JSON in both directions, so it can be driven without a terminal. The burner already reads that stream format.
- A read-only transcript viewer for past project conversations exists (`ConversationTranscript`), reading both runtimes' transcript formats.

## What it must decide
- How it drives the agent: the CLI's JSON-streaming mode, or the Agent SDK. The Codex runtime needs the same answer.
- What it keeps from the terminal, and how: permission prompts, the multiple-choice question widget, slash commands, plan mode, interrupt (Esc), resume of the one transcript (`one-chat-per-feature`).
- Whether the project chat and the scenario chat move too, or only the feature chat.
- How Select area crops from the design pane attach: as real image attachments instead of a typed file path.

## What it must NOT swallow
- The page layout itself. *Design mode* owns it.
- Design mode's pane, its dev server and its tools.
