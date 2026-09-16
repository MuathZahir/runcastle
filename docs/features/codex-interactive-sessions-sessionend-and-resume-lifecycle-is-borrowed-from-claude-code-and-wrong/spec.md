# Codex interactive sessions: honest SessionEnd and resume lifecycle

## Problem

Interactive Codex sessions look like they close out from under the operator:
the feature's next-step bar flips to **Resume session** while the terminal is
often still running, and Resume then frequently opens a cold, unbriefed
session instead of the conversation it promised. The bookkeeping was borrowed
one-for-one from Claude Code's hook timing, and live verification against
codex-cli 0.153.4 (`research/live-verification.md`) shows the borrowed
assumptions are wrong at both ends: Codex emits SessionStart only with the
first submitted turn, and emits SessionEnd once at real quit — roughly two
seconds before the process actually exits, and potentially (as Claude
demonstrably does with in-TUI rollovers) at moments when the terminal is very
much alive. A separate, verified boot-time hazard — the blocking
update-available dialog on every synthetic `CODEX_HOME` — can keep a session
dark before any hook has fired, with "Update now (runs npm install -g)" as
the highlighted default.

Since `native-first-message-delivery` shipped (2026-09-15), the formerly
dominant resume failure (rollout files stranded in the previous session's
synthetic home) is fixed, and argv-delivered kickoffs mean a fresh Codex
session records its conversation id almost immediately. What remains is this
feature's share: end-of-session truth, teardown timing, the announced-not-
silent no-resumable path, and the update-modal suppression.

## Approach

From the operator's perspective: a Codex session's card says the terminal is
alive exactly while the process runs; **Resume session** appears only when it
is really gone; clicking Resume either reopens the recorded conversation or
says plainly on the timeline that there was nothing to resume and a fresh
session is being started; and no runcastle terminal ever boots into codex's
update dialog.

The shape, per the locked decisions:

- **PTY exit is the single source of "ended" for Codex sessions**
  (decisions 1 and 4). The hooks route branches per runtime: for a
  `runtime='codex'` session, the SessionEnd handler no longer changes row
  status and no longer performs teardown; it emits one truthful timeline
  event — "conversation ended (reason: …)" — carrying the `reason` field the
  payload provides (verified: `"other"` for Ctrl-C quit). All teardown
  (`ended` status, waypoint auto-release, project-session landing, and the
  resolve-conflict merge probe) runs in the PTY exit handler for codex; the
  exit handler already does the first three for every runtime, so the change
  is moving the merge probe in for codex sessions. The Claude runtime's
  handlers stay byte-for-byte as ADR-0009 describes.
- **Resume with nothing to resume announces itself** (decision 2). When a
  Codex relaunch wants to resume but no ended row carries a conversation id,
  the launcher emits `session.resume_unavailable` ("no resumable conversation
  was recorded — starting a fresh session") and proceeds with the fresh
  launch. No refusal, no extra click, no silence. The resume argv itself is
  verified-correct and unchanged: the stored conversation id is the UUID
  `codex resume` accepts, and `--dangerously-bypass-hook-trust` is valid on
  the resume subcommand.
- **The session config suppresses the update check** (decision 3). The
  rendered per-session `config.toml` gains top-level
  `check_for_update_on_startup = false`. This touches only the synthetic
  per-session home; the human's own codex config is never written.
- **Claude guard-rail** (decision 4): nothing here may change
  Claude-session behaviour. Shared code paths that must differ get a
  per-runtime branch; if a shared seam's shape must change, the Claude side
  is updated in the same ticket with its tests.

Event vocabulary: `session.resume_unavailable` is new; the codex
conversation-ended note reuses an existing-shaped dotted type (subject.verb)
and carries `{ sessionId, reason }`. `session.ended` remains the event the
UI already keys on and, for codex, is now emitted from the PTY exit path
only (via the existing exit flow), so stream consumers need no new handling
for it.

## Seams

All existing seams; no new ones.

1. **The hooks route** (`POST /api/hooks/:event` handling, feature-scoped and
   project-scoped) — existing. Observes: a codex SessionEnd leaves the row's
   status untouched and emits the reason-carrying timeline note; a Claude
   SessionEnd still marks the row ended (pinned in both directions per the
   guard-rail); codex SessionEnd performs no waypoint release / merge probe.
2. **The PTY exit handler** (the launcher's exit finalizer) — existing.
   Observes: for a codex session it flips `ended`, releases the waypoint,
   lands a project session, runs the resolve-conflict merge probe, and emits
   `session.pty_exited`; Claude behaviour unchanged.
3. **The launcher's resume decision** (the resume-or-fresh branch of the
   launch paths) — existing. Observes: with no resumable row,
   `session.resume_unavailable` is emitted and a fresh spawn proceeds; with a
   resumable row, the argv carries `resume <uuid>` plus the trust-bypass
   flag exactly as today.
4. **The rendered Codex config** (the config-render function covered by the
   existing launch-artifacts tests) — existing. Observes: the update-check
   suppression line is present in every rendered session config.

## Out of scope

- **Kickoff delivery** — argv delivery, resume-sends-nothing, and rollout
  carry-across shipped in `native-first-message-delivery`; nothing here
  touches them.
- **The Claude Code runtime's lifecycle** (ADR-0009) — byte-for-byte
  unchanged, enforced by tests in both directions.
- **A committed live-CLI end-to-end test** (decision 5) — the burn sandbox
  has no TTY or credentials; the rerunnable host-side harness lives in this
  feature's `prototypes/` with findings in `research/live-verification.md`.
- **Codex's post-exit daemon processes** (app-server etc. outliving the TUI)
  — codex's own design, observed and documented, not runcastle's to manage.
- **Seeding/normalising fresh `CODEX_HOME` beyond the update-check line**
  (long-path DB failure, temp-dir helper refusal are documented environment
  hazards only).

## Open questions

- Which moments other than quit fire SessionEnd on codex (a `/new`-shaped
  rollover could not be provoked in the harness). The design is robust
  either way — any such firing now costs a timeline note, not a dead row.

## Pre-burn note (decision 6)

One lap. Before tickets burn, the feature branch must merge current main
(post-`native-first-message-delivery`): the tickets name seams that feature
reshaped, and burning against the pre-merge branch would have agents
patching deleted machinery.
