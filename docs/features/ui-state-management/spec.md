# UI State Management

## Problem

The runcastle UI cannot be trusted to reflect reality. The agent writes a spec or emits tickets and the user, watching in the same tab, sees nothing until they refresh. The top bar offers "Start grill session" while the user is sitting inside the grilling session. Tickets freeze mid-burn when a tab has been backgrounded. A merge hits a conflict and the banner never appears. And the universal workaround — refresh — is itself punishing, because a reload always lands on the project chooser and the user must click back to where they were. The user's summary: these issues are everywhere, and refresh-as-a-lifestyle is not acceptable.

Diagnosis (from ideation, verified against the running system): the push architecture that shipped in v1.0.21 (event bus → SSE stream → query-invalidation bridge) exists and works, but it fails silently and has deaf spots. The client never verifies the stream's 25-second heartbeat, so a half-dead connection (laptop sleep, network blip) leaves the app believing it is live — and in live mode every poll is deliberately backed off from 1.5s to 30s, so one silent stream death staleness-freezes every surface at once. Separately, some real-world changes never enter the event system at all: agent doc writes emit nothing (and the doc query never polls), session liveness is gated on an out-of-band hook callback that can silently fail, and some mutations rely entirely on the server emit chain rather than invalidating their own queries.

## Approach

From the user's perspective: the UI simply stays correct. Docs, tickets, phase buttons, conflict banners, and run states update within a couple of seconds of reality, whether or not the tab was backgrounded, and a refresh — now rarely needed — reopens exactly the project and feature they were in. A small status-bar indicator shows whether the live stream is healthy, so any future staleness is diagnosable at a glance instead of haunted.

The architecture is deliberately unchanged: SSE push over the existing event bus, with interval polling as the fallback. Three legs of work harden it.

**Leg 1 — the pipe proves it is alive.** The client-side live bridge gains a heartbeat watchdog: the server already sends a heartbeat frame every 25s; the client now tracks time-since-last-message and, past a threshold (~35s), stops trusting the connection — it force-closes the EventSource, reconnects, and on the `ready` frame performs the existing full resync. This is the same half-open-socket treatment the terminal WebSocket client already implements; the pattern is ported, not invented. Liveness status becomes honest: only a stream with a recent pulse reports `live`; anything else drops the app back to 1.5s polling (the existing `useLivePoll` mechanism already does this off the status — the fix is making the status truthful). Additional resync triggers: window refocus and browser `online` events force an immediate status check and refetch, closing the backgrounded-tab hole where a dead stream plus suspended intervals meant an indefinitely frozen UI. The status itself, currently computed and discarded at the app root, is rendered as a small live/reconnecting indicator in the status bar — no toasts or banners for transient reconnects. It must be visually distinct from the terminal's existing OFFLINE banner, which describes a different connection.

**Leg 2 — every change enters the pipe.** Three deaf spots close:

- *Doc writes.* A new server-side docs watcher service watches each active feature's `docs/features/<slug>/` directory in its talk worktree and, on any change, emits a `docs.changed` event through the standard event-insertion choke point — which already publishes to the bus and thus to SSE, where the existing invalidation allowlist already covers doc reads. Watchers are started/stopped with feature session activity (not one per feature forever), are debounced against write bursts, and must be robust on Windows. This catches every writer: the talk agent, human hand-edits, and git checkouts at phase boundaries.
- *Session liveness.* One canonical rule, used by every surface: a session whose PTY is running is an active session — both `launching` and `live` statuses count, because the server spawned the process and tracks its exit. The SessionStart hook callback merely upgrades a session to "agent checked in"; a session that stays unconfirmed past ~30s shows a subtle "agent hasn't checked in yet" hint on the session panel rather than being treated as absent. This removes today's contradiction where the next-step bar demands `live` while other UI accepts `launching`, and ends the lying "Start grill session" button.
- *Emit/invalidate audit.* Mutations invalidate the queries they affect on success instead of trusting the server emit chain end-to-end — the merge mutation (which today invalidates nothing, leaving the conflict banner wholly dependent on SSE) and the test-drive mutation are the known offenders; the audit sweeps all mutations for others. On the server side, the audit verifies every mutating service path emits an event, since a missed emit now costs 30s of staleness rather than 1.5s. Queries hardcoding their own poll intervals outside the live back-off mechanism (commit count, prep/project sessions) are folded into it, and any query the invalidation allowlist should cover but doesn't gets added.

**Leg 3 — refresh lands where you were.** Project navigation state (current project id and top-level view), today held only in React state and re-derived from project count on every load, is persisted per the same localStorage pattern already used for per-project feature selection. On reload: restore the last-open project and view if it still exists; fall back to today's count-based landing rule otherwise (including first launch and the just-deleted-project case). No router and no URL scheme — that is explicitly deferred.

Contract changes are minimal: one new event type (`docs.changed`) flowing through the existing event schema, one new localStorage key for project navigation, and a rendered status derived from the existing live-status store. No tRPC surface changes are expected; the watcher and session-liveness work are server-internal plus UI-rule changes.

## Seams

- **The SSE stream endpoint** (existing) — connect as a client; observe the `ready` frame, heartbeat cadence, and coalesced `live` signals. Tests already exist at this seam; watchdog-related server behavior (heartbeat regularity) is asserted here.
- **The event-insertion choke point** (existing) — every service mutation and the new docs watcher emit through it; observing the events table/list shows whether a change entered the pipe. The emit-coverage audit is verified at this seam: perform each mutation, assert an event lands.
- **The docs watcher service** (new) — start/stop per feature worktree; observable by writing a file into a watched docs directory and asserting a `docs.changed` event (and nothing after stop, and no event storm on a write burst).
- **The live-status store** (existing, currently write-only) — module-level status the whole app reads; the watchdog is tested by driving frames/silence through it and asserting status transitions (`live` → degraded on silence, resync on recovery) and the poll-cadence flip.
- **The session registry** (existing) — session rows' status transitions (`launching` → `live` → ended) driven by spawn, hook check-in, and PTY exit; the canonical "active session" rule is a pure function over these rows, testable directly, and every UI surface consumes it instead of inspecting statuses ad hoc.
- **The project navigation store** (existing hook, new persistence) — observable via its localStorage key round-trip: select project → reload → same project restored; deleted project → falls back to landing rule.

## Out of scope

- URL routing, deep links, back/forward navigation — deferred as a possible future feature (decision 3).
- Transport changes (WebSocket migration, HTTP/2 push) — the SSE + poll architecture stays (decision 1).
- PostToolUse hook reporting of file writes (decision 4 chose the watcher).
- Terminal WebSocket behavior — it already has its own watchdog and banner; untouched.
- Multi-tab SSE connection-limit handling — the user works single-tab; noted as a known browser constraint, not addressed.
- Event-log cursor unification across consumers (per-observer fragmentation) — a real inefficiency, but mitigated by the back-off and orthogonal to correctness once the pipe is trustworthy; left for a future cleanup.

## Open questions

- Exact watchdog threshold and debounce values (~35s pulse timeout, docs-watch debounce window) are implementation-tuned, not contractual.
- Whether the "agent hasn't checked in yet" hint needs a retry affordance (relaunch/resend kickoff) or is purely informational — informational is the default; the session panel already has adjacent affordances.
- Whether `CLAUDE.md`'s stale "events are polled at 1.5s" architecture note gets corrected in this feature's tickets or ridden along in one of them — riding along is assumed.
