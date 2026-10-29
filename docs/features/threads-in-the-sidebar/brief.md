## Purpose

The human, 2026-10-28: "I was thinking of having a nested sidebar with all the threads in each feature, and similarly with the project chat." Today threads (the several conversations a feature or the project chat can hold, from docs/features/several-sessions-per-feature/ and docs/features/chat-as-web-components/) are switched with a dropdown in the chat column's header (apps/web/src/components/chat/thread/ThreadSwitcher.tsx). The human finds that dropdown "one of the worst designs I've seen": with many threads it runs all the way to the bottom of the screen.

This feature makes the sidebar the one place threads live: each feature row, and the Orchestrator row, opens to show its threads.

## Understood

- **No switcher in the header.** The human was explicit. The chat header just names the thread you are in.
- **Both feature chats and the Orchestrator (project chat)** get nested threads.
- The sidebar already has the new style (docs/features/sidebar-refresh-less-clutter-more-character/decisions.md: two-line rows, the Orchestrator lead row); nested threads must sit inside that look.

## Must not swallow

- The rest of the chat header and the chat's look: "The chat looks the part" owns those, and waits on this feature.
- The Orchestrator page's past-conversation list: "The Orchestrator's page" owns it, and waits on this feature; it may shrink once threads live in the sidebar.
- The shared style and building blocks: "The whole app matches the sidebar" owns them.

## Open

- How a long thread list stays short in the sidebar (e.g. the last few threads plus "show all"), when a feature row is open or folded, and how starting a new thread is reached once the header switcher is gone. Design questions for this feature's own session.

## Ordering

Runs in parallel with "The whole app matches the sidebar" (the foundation). The two may meet in the sidebar files (the foundation may tone down the sidebar grain); whichever merges second reconciles. "The chat looks the part" and "The Orchestrator's page" wait on this one.

## Working agreement (the human, 2026-10-28)

Checkpoint: the human looks at each feature's designs before it builds. The orchestrator gathers ready designs into one message. Once the human has approved a feature's design, the orchestrator carries it through build, review and merge without asking for a test drive.
