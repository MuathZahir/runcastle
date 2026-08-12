# Decisions — UI State Management

## 1. Root cause is accepted: dead-pipe blindness + deaf spots, not the transport
**Decision:** Keep the existing SSE + backed-off-poll architecture. No WebSocket swap, no transport rewrite.
**Why:** The push pipeline (bus → `/api/stream` → `live.ts` invalidation bridge) exists, works, and shipped in v1.0.21. The staleness the user hits on 1.2.4 comes from (a) the client never verifying the stream's 25s heartbeat, so a half-dead connection silently pins every poll at the 30s back-off, and (b) changes that never enter the event system at all (doc file writes, session liveness via hook callback, un-emitting mutation paths). A WebSocket has the identical half-open failure mode and fixes none of the deaf spots — it would rewrite the working pipe to arrive at the same missing pulse check.

## 2. Full scope, one lap
**Decision:** One lap covering all three legs: (1) the pipe must prove it's alive — client heartbeat watchdog, reconnect + full resync, resync on refocus/online, honest degraded-mode polling; (2) every change must enter the pipe — docs file changes become events, session liveness tied to the real process, emit/invalidate coverage audit; (3) refresh must land where you were — persist project navigation.
**Why:** The user confirmed full scope explicitly. Each leg is small, they form one "liveness you can trust" story, and fixing any subset leaves the refresh habit alive (a proven pipe with deaf spots still goes stale; a hearing pipe that can silently die still freezes everything at once).

## 3. Navigation persistence via localStorage, not a router
**Decision:** On reload, restore the last-open project (and its view) from localStorage instead of deriving the landing view from project count. Mirrors the existing per-project feature-selection persistence (`runcastle.selected.v1:<projectId>` in `lib/workspace.ts`). No router, no URL scheme.
**Why:** The pain is "refresh loses my place", and restoring cures it completely at a tenth of the effort of introducing a router into an app deliberately built without one. URL routing (back button, bookmarks, sharing) is deferred as a possible future feature, not part of this fix.

## 4. Doc changes enter the event system via a server-side file watcher
**Decision:** The server watches each active feature's `docs/features/<slug>/` directory (per-feature-worktree watchers, started/stopped with feature activity) and emits a `docs.changed` event on any write. No PostToolUse hook reporting.
**Why:** The watcher catches every writer — talk agent, human hand-edits, git checkouts at phase boundaries — and does not depend on hook delivery, which is precisely the channel already proven unreliable (the session-liveness lie). A PostToolUse hook would only cover agent writes and add per-tool-call HTTP chatter to every session.

## 5. Session liveness: PTY-alive means active
**Decision:** One canonical rule everywhere in the UI: a session whose terminal process is running is an active session (`launching` and `live` both count). The SessionStart hook callback only upgrades it to "agent checked in"; a session stuck past ~30s without check-in shows a subtle "agent hasn't checked in yet" hint on the session panel instead of being treated as absent. This replaces today's split where the top bar requires `live` while other UI accepts `launching`.
**Why:** The server spawns and owns the PTY and already tracks its exit (`session.pty_exited`) — that is ground truth. Gating "in session" on an out-of-band HTTP callback from inside the agent process means any hook failure makes the button lie indefinitely, which is the reported bug. The button must reflect what the server knows first-hand.

## 6. Data-stream health gets a visible, subtle status indicator
**Decision:** Surface the SSE data-stream status (live / reconnecting-degraded) as a small indicator in the status bar. No toasts or banners for transient reconnects. The watchdog itself follows the pattern the terminal WebSocket already implements in-repo (`lib/terminal.ts`: detect silent half-open death, force-close, reconnect with backoff) — port that thinking to the data stream rather than inventing a new one.
**Why:** A dead stream being invisible is what made the staleness feel haunted and undebuggable. The status already exists in code (`useLiveSync` returns it; `App.tsx` discards it) — rendering it is nearly free. The existing workspace OFFLINE banner is the terminal's, not the data stream's; users reasonably conflate them, one more reason the data stream needs its own honest signal.
