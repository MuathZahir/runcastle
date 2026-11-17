## Purpose

The human finds the web app slow: a refresh sometimes "takes forever to load", and on another PC the message box gets very laggy: "I would click the key and the letter appears a couple seconds later." They reach runcastle over SSH port forwarding from other PCs.

## Decided with the human (2026-11-16)

- What: fast page loads and lag-free typing; measure first, then fix what the measurements show.
- Where: the runcastle web app, used over SSH from another PC.
- Who: the human.
- Out: a desktop app. The human floated moving to one, or offering both; the orchestrator advised it does not fix any of this (it would talk to the same server over SSH) and it stays a separate question for later.

## Understood (orchestrator's code read, not measured — verify)

1. Typing lag (most likely): the draft is state inside `useThread` (`apps/web/src/lib/use-thread.ts`) with a synchronous localStorage write per keystroke; `ThreadColumn` renders both the Composer and `ChatThread`, so each key re-renders the whole transcript. `ChatThread` is not memoised and renders every item with no windowing.
2. Slow refresh: the server serves the built app (`packages/server/src/routes/web.ts`) with no compression (gzip applies only to `/api/trpc/*`), no cache headers or ETags, reading each file per request; the Vite build has no code splitting (xterm, react-markdown, cmdk, Radix all load up front). A long thread's first events read also gates the page.
3. Live updates: each SSE resync invalidates ~25 query families (`apps/web/src/lib/live.ts`), and every refetch costs a round trip over the tunnel.
- `threads-open-fast-and-show-the-truth` (shipped 2026-11-01) covered thread open timing, not typing or bundle size.

## Must not swallow

- A desktop app or any packaging change.
- Visual redesigns; behaviour stays the same, only faster.

## Open

- Which port the human opens over SSH: 4512 (the built app) or 4513 (the Vite dev server, which is slow over a tunnel by nature). Asked, not yet answered.
- Real numbers: a performance profile while typing in a long chat, and a network trace of a refresh over a throttled link.

## Ordering

Independent; nothing waits on it.

Planning mode: automatic
