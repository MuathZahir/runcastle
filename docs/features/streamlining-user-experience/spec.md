# Streamlining User Experience

## Problem

Runcastle's happy path has too much friction at both ends. Creating a feature demands upfront decisions the user shouldn't have to make (Full vs Small, Start mapped) and defaults that cause near-misses (branching from main when the user is on another branch). The freshly opened grill session sits dead until the user types "Hi". The embedded terminal swallows Claude's newline shortcuts, so Shift+Enter submits half-written prompts. And once tickets are burned, the pipeline is a one-way street: finding a bug during review leaves no path back — no way to talk to an agent, ticket the fixes, and re-burn — and a merge conflict is a literal dead end. Finally, features accumulate forever; there is no way to archive or delete one.

## Approach

**Creation collapses to "type a title, hit Enter".** The New Feature form shrinks to a title (Enter submits) and an optional one-liner. Branch-from moves behind a collapsed Advanced disclosure and defaults to the branch currently checked out in the project repo (falling back to the project main branch only on detached HEAD or when a test drive has runcastle itself on a feature branch). The size toggle is deleted along with the whole `collapsed` concept: the size field leaves the feature schema, the phase-order skip and the G2 auto-satisfy leave the pipeline, and the ideate skill loses its size branch — every feature runs ideation → spec → tickets → implementation → review → shipped. Existing `collapsed` rows are read as full. The Start-mapped checkbox is also deleted: `escalate_to_map` mid-grill becomes the only door into the mapped flow, and the ideate skill gains early size-probing plus a hard rule to ask the human before charting a map.

**No session starts dead.** The converge-only kickoff mechanism (inject the kickoff line into the PTY shortly after the SessionStart hook marks the session live, then Enter as a separate keystroke) generalizes into a per-kind kickoff registry covering every session kind — ideation, waypoint, revisit, qa, converge. Each kind gets one kickoff line naming its opening skill and intent; the revisit kind's line varies by phase/purpose (ticket surgery, review iteration, conflict resolution).

**The embedded terminal respects Claude's keyboard.** The web terminal installs a custom key handler so Shift+Enter and Ctrl+Enter insert a newline in the Claude prompt instead of submitting (exact byte sequence verified against the Claude TUI during implementation). The same ticket audits adjacent interactions — Ctrl+C, arrow/history keys, and especially multi-line paste under bracketed paste — and fixes what is broken.

**Review becomes a loop, not a terminus.** The revisit session kind is surfaced at the review phase as **Iterate**, a next-step-bar action available whenever no session is live. Its kickoff briefs the agent to read the run outcome and ticket states, interview the human about what the test drive surfaced, and emit fix tickets. Burn accepts launch from review when pending tickets exist; burning moves the phase back to implementation, and the existing all-tickets-terminal auto-advance returns the feature to review when the run finishes. While pending tickets exist at review, Burn is promoted to the primary next-step action — the loop review → Iterate → Burn → review repeats until the human clicks Merge & ship. Burn remains the human gate on every cycle.

**Merge conflicts resolve inside the same loop.** On a conflicted Merge & ship, the review UI surfaces the conflict and offers an Iterate session pre-briefed to resolve it: merge the base branch into the feature branch in the talk worktree, resolve with full spec/decisions context, commit, and hand back for a clean retry. This doubles as a general update-from-base path for long-lived features.

**Features can leave the sidebar.** Feature status gains `archived`. Archive works from any phase: it ends any live session, hides the feature behind a show-archived filter, keeps all data, and is reversible. Delete works for non-shipped features only, behind a confirmation dialog: it cancels active runs, ends sessions, stops that feature's test drive, removes the talk worktree, deletes the feature branch and runcastle temp branches, and deletes all DB rows and session artifact dirs. Committed feature docs stay in git history untouched — no removal commit, no history rewrite.

**The away-period ends with a ping.** The web app requests Notification permission once and fires desktop notifications from the existing events poll when a run succeeds (review ready), fails, or a session needs the human. No server changes.

## Seams

- **tRPC feature router** (existing, primary) — creation defaults (current-branch base, no size/mapped inputs), burn-from-review acceptance and phase drop, archive/unarchive/delete behavior and their cleanup effects, merge-conflict surfacing. Nearly every server-side behavior in this feature is observable here.
- **Core pipeline functions** (existing) — phase order without `collapsed`, gate table without G2 auto-satisfy, and the new review → implementation transition; pure-function tests.
- **Events feed** (existing) — session kickoff (`session.kickoff` per kind), burn lifecycle, archive/delete, and merge-conflict events land here; the UI and the notification layer both read it, so it doubles as the observation point for kickoff injection without driving a real PTY.
- **Terminal key mapping** (new, client) — a pure function from keyboard event (key + modifiers) to bytes-to-send/let-through, unit-testable without xterm; TerminalView wires it in.
- **Event → notification mapping** (new, client) — a pure function from a polled event to notification payload or null; the Notification API call itself stays a thin shell.

## Out of scope

- A "quick fixes" lane for work that skips the pipeline — future feature, not a resurrected `collapsed`.
- Deleting shipped features, rewriting git history, or removal commits for feature docs.
- Email/webhook/mobile notifications — browser Notification API only.
- An un-map path (mapped stays one-way once charted).
- Test-drive state surviving server restarts, or any other robustness work not named above.
- In-UI git conflict editor — conflict resolution is agent-driven via the Iterate session.

## Open questions

- The exact newline byte sequence the Claude TUI accepts for modifier+Enter (`\x1b\r` vs backslash+CR) — verified empirically during implementation.
- Whether dropping the `size` column is a real migration or a tolerant read of legacy rows — implementer's choice, behavior pinned either way (legacy rows act as full).
