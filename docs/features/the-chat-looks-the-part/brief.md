## Purpose

The human, 2026-10-28, wants the whole app to look professional and aesthetic, going screen by screen, each in its own feature. The chat page was named directly as needing work. This feature reworks the chat column's look (apps/web/src/components/chat/, the thread UI from docs/features/chat-as-web-components/): how messages, tool activity and notices read, the box you type in, and the chat header, for feature chats and the Orchestrator's project chat alike.

## Understood

- The foundation feature ("The whole app matches the sidebar") lands the shared style, spacing and building blocks first; this feature applies them to the chat and fixes the chat's own layout on top. The sidebar's roomier, calmer feel is the reference.
- The thread dropdown is gone by the time this starts ("Threads in the sidebar" removes it; the header only names the thread). Do not bring a switcher back.
- Show directions first, rendered with design mode, before building.

## Must not swallow

- The shared theme and building blocks (the foundation owns them; if something shared is missing, say so rather than forking it locally).
- Threads' place in the sidebar.
- The feature's right panel, the test drive and the Orchestrator page's own content (their own features).
- New chat behaviour. This is look and layout.

## Open

- Which parts of the chat look worst to the human. Ask with previews.

## Ordering

Waits on "The whole app matches the sidebar" and "Threads in the sidebar"; starts by itself when both merge. Siblings: "The feature's right panel, step by step", "Test drive looks the part", "The Orchestrator's page", "The rest of the app looks the part".

## Working agreement (the human, 2026-10-28)

Checkpoint: the human looks at each feature's designs before it builds. The orchestrator gathers ready designs into one message. Once the human has approved a feature's design, the orchestrator carries it through build, review and merge without asking for a test drive.
