## Purpose

The human wants to manage runcastle from their phone and accept finished work from the orchestrator thread by looking at it: "the orchestrator thread can show me a couple screenshots from the feature so i can accept or not." They then widened it: "For the tool to show images, it should also be able to show other files. For example, if the agent uses the tool on a file, it should show the file as a card that the user can click to open the file. If the agent uses it on an image, it shows the image in the chat."

Today the chat only shows images the human attached (`apps/web/src/components/chat/thread/ChatThread.tsx`, the user message). No agent can put anything but text in the chat.

## Understood (agreed with the human)

- One tool, not two. It behaves by file type: image inline, anything else a card that opens the file.
- It is available to every agent, including the orchestrator, and works for Claude and Codex: it belongs on runcastle's own MCP server, not a runtime feature.
- Accepting needs nothing new. The orchestrator shows the screenshots, the human replies "merge it", and the existing check-in way of working handles the rest. No accept button unless the feature's own session finds a real reason.
- The recommendation the human accepted: copy the file when it is shown, so the image or card keeps working after the feature's worktree is deleted at merge.

## Must not swallow

- Review taking or saving screenshots ("Review keeps its screenshots").
- The phone layout ("Runcastle on your phone"). It must work there, but the phone view is its own feature.
- Editing files, or a general file browser.

## Open

- What "open" does for a non-image file: which types the app views itself (text, markdown, PDF) and what falls back to a download. It must work from a phone browser, so opening with a desktop program is not enough.
- Where the copies live, how they are served, and what limits the tool has on which paths it may show. The app has no login, so serving arbitrary paths needs thought.
- How it looks in the transcript when a chat is resumed or reopened, and whether old chats keep showing it.
- Size limits.

## Ordering

Starts by itself after "Threads hold features" merges. "Review keeps its screenshots" follows it. Nothing technically requires this order; it was chosen to keep the cut sequential and light on the machine.

## Working agreement

Agreed with the human for this whole cut (Threads hold features, Agents show files in chat, Review keeps its screenshots, Runcastle on your phone, Agents can notify your phone):

Checkpoints:
1. The human approves the phone view's design before "Runcastle on your phone" builds.
2. The human tries the finished phone link and a real notification on their actual phone, before those features merge.

Everything else is carried through to merged by the orchestrator without stopping. This feature has no checkpoint of its own. Publishing a release needs the human's yes.

## Added by the orchestrator, 2026-10-31

## Working agreement correction (orchestrator, 2026-10-31)

Checkpoint 2 splits in two, because notifications start only after the phone view merges: the human tries the phone link before "Runcastle on your phone" merges, and receives a real notification before "Agents can notify your phone" merges. This feature still has no checkpoint of its own.
