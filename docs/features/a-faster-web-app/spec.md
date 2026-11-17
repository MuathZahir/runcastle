# A faster web app

## Problem

The human reaches runcastle's web app over SSH port forwarding from other PCs. A refresh sometimes takes a long time to show anything, and on a slower PC a key typed in the message box shows up seconds later. Nothing is broken; it is just slow enough to get in the way of every chat.

## Approach

From the user's side nothing changes except speed (decision 10). A refresh shows the project page quickly, a repeat refresh faster still, and typing in any chat keeps up with the keys, even in a long chat with an agent streaming. The only visible differences: rarely used parts show a brief "Loading…" the first time they open (decision 9), and switching back to the tab no longer refetches everything (decision 8).

The work runs in three steps: measure, fix, measure again against the targets in decision 6.

### 1. Measure (before any fix)

A new measuring script beside the thread-timing one, built the same way (real Chrome via playwright-core against a scratch copy of the data, served by a local `buildApp`). It has:
- a typing measure: in the longest chat of the scratch data (500+ messages; seed a synthetic one if none is long enough), type a sentence and record key-to-paint time per key, idle and while a second writer streams agent text into that same chat;
- a load measure: cold and warm refresh to "project page with sidebar filled", recording bytes over the wire, request count and time;
- throttling through the Chrome DevTools Protocol: CPU 4x, network 10 Mbit/s and 60 ms round trips;
- a Linux-friendly Chrome path (the current default is a Windows path).

It prints a small table, before and after. The baseline numbers go into this spec under "Measured" before any fix lands. If they point somewhere this plan does not, the lead says so and re-plans with the human before fixing.

### 2. Fix typing

The cause, from reading the code: the draft lives in the same component that draws the whole transcript, so each key redraws every message and re-parses every message's markdown. Nothing in the web app is memoised. While an agent streams, each live signal (about every 120 ms) also re-folds the whole log into items and redraws everything again.

- **Keys stop redrawing the transcript.** The composer's draft moves out of the transcript's render path, so a key re-renders the composer and its small neighbours only. The transcript and each message item are memoised on their item identity; the item list already keeps the same reference when nothing changed.
- **Markdown parses once per message text.** The markdown renderer is memoised on its text, with its plugin list hoisted to a constant.
- **Streaming redraws only what changed.** Folding the log into items reuses the previous items for the unchanged prefix, so a streamed chunk changes one item, not all of them. Unchanged items keep their identity, so memoisation holds.
- **Per-key side work gets cheap.** The draft is saved to the browser's storage after a short pause rather than on every key, and always on send and when the page hides. The `@` file lookup waits for a short pause instead of asking the server on every key.
- **No windowing** (decision 7). If the 50 ms target is still missed after these, the lead stops and brings the numbers to the human.

This applies to every chat, since all of them share one thread column: feature chats (including worker and scenario chats) and the project chat.

### 3. Fix refresh

The cause, from reading the code and the installed build: the server sends the app's files with no compression and no caching, so every refresh downloads the whole 1.66 MB script and 120 KB of styles again. The script is one chunk that includes everything. On load, the page then fetches every list twice (once normally, once on the live stream's first connect).

- **Compressed, cached app files.** The server compresses the app's files (gzip, or brotli where the browser accepts it), compressing each file once and keeping it in memory. Hashed asset files are sent as cacheable forever; the page itself (`index.html`) always revalidates, so a runcastle update shows on a plain refresh. Fonts are cached too.
- **Smaller first script.** The terminal, design view, command palette and phone-link QR load on first use (decision 9), each behind a small "Loading…" in its own place. Large stable libraries (React, Radix, the markdown stack) go in their own chunk so an app update does not invalidate them.
- **One fetch per list on load.** The live stream's first connect no longer triggers a full resync; only a reconnect after a drop does. Refetch on window focus is turned off for queries the live stream keeps current (decision 8).
- **Long chats.** Opening a long chat waits for its whole log today. This gates only the chat column, not the page, and the read is compressed already. If the measurements show it still dominates a refresh landing on a long chat, read the newest part of the log first; otherwise leave it.

### Measured

Baseline, 2026-11-16, before any fix. Longest feature chat (8.4 MB log), CPU 4x slower, 10 Mbit/s, 60 ms round trips. "Key to screen" is the browser's own Event Timing for each key (press to next paint); "round trip from the driver" is how long until the test driver saw the key handled, which is what a typist feels once keys queue up.

| What | Before | Target |
|---|---|---|
| First visit: project page shown | 4681 ms | 3000 |
| First visit: over the wire | 1966 KB, 13 requests | — |
| Repeat refresh: project page shown | 2799 ms | 1500 |
| Repeat refresh: over the wire | 1954 KB | — |
| Idle chat: key to screen, typical / slowest 5% | 344 / 448 ms | 50 |
| Agent streaming: key to screen, typical / slowest 5% | 400 / 728 ms | 50 |
| Agent streaming: key round trip from the driver | 2096 ms | — |

The numbers point where the code read did: every refresh downloads the whole app again, each key costs a full redraw of the chat, and a streaming agent stacks redraws until keys show two seconds late (the human's "a couple seconds later"). The plan stands.

After, 2026-11-16, same data and throttling, on commit e8779ae. Ranges are over three or four runs.

| What | Before | After | Target |
|---|---|---|---|
| First visit: project page shown | 4681 ms | 2477–2967 ms | 3000, met |
| First visit: over the wire | 1966 KB, 13 requests | 474 KB, 25 requests | — |
| Repeat refresh: project page shown | 2799 ms | 1055–1216 ms | 1500, met |
| Repeat refresh: over the wire | 1954 KB | 103 KB | — |
| Idle chat: key to screen, typical / slowest 5% | 344 / 448 ms | 24–32 / 32–40 ms | 50, met |
| Agent streaming: key to screen, typical / slowest 5% | 400 / 728 ms | 24–40 / 40–88 ms | 50: typical met, slowest 5% mostly not |
| Agent streaming: key round trip from the driver | 2096 ms | 200–257 ms | — |

Two fixes beyond the plan came out of the measurements. The feature list no longer carries each feature's brief (218 KB of the 491 KB the first page read fetched; only the draft page shows a brief, and it reads the feature itself). And a profile while streaming showed React walking the whole chat on every chunk, because the values the page publishes for the sidebar and palette, and the providers around the chat column, changed identity on every render; they now hold still.

What is left of the streaming slowest 5% is mostly the browser laying out the long chat after each chunk (the chat's scroll-to-bottom reads its height, which forces that layout). Cutting it further means skipping layout of off-screen messages, which is the human's call (decision 7).

## Seams

- **The measuring script** (existing, extended): real Chrome, throttled, against a scratch copy of the data. Observes key-to-paint time, load time, bytes and request counts. It is the check for decision 6.
- **The server's app-file route** (existing): request a file, observe the response's encoding and caching headers, and a 304 on a repeat with the same tag. Server tests at this seam.
- **The thread view hook and its fold** (existing): feed a log, append a chunk, observe that unchanged items keep their identity. Unit tests at this seam.
- **Chat render counting** (new, test only): a component test (happy-dom tier, per the web style guide) renders a thread column with many items, types into the composer, and counts message renders. Expected: zero message re-renders per key.

## Out of scope

- A desktop app or any packaging change (decision 5).
- Visual redesigns (decision 10).
- Windowing long chats (decision 7), unless the human says otherwise after seeing the numbers.
- The Vite dev server on 4513 (decision 3).
- A merge check for speed (decision 11).

## Open questions

- Whether the human ever tunnels to 4513 (decision 3).
