# Decisions — Streamlining User Experience

## 1. Remove the Full/Small size concept entirely
**Decision:** Delete `size` / `collapsed` from the whole system — core schemas, `nextPhase` skip, G2 auto-satisfy, the New Feature form toggle, and the ideate skill's size branch. Every feature runs the full pipeline: ideation → spec → tickets → implementation → review → shipped. Existing rows are treated as `full`.
**Why:** The spec step is cheap (synthesized from the grill in the same context window), so skipping it saves nothing while forcing a confusing upfront choice. A future "quick fixes" lane will be its own entity, not a resurrected `collapsed`.

## 2. Mapping is escalation-only; agent asks before charting
**Decision:** Remove the "Start mapped" checkbox from the New Feature form. `escalate_to_map` mid-grill becomes the only door into the mapped flow. The ideate skill gains: (a) early size-probing — a couple of scoping questions up front so map-sized features escalate within minutes, not after a long rabbit-hole; (b) the agent must ask the human before escalating ("this looks map-sized — chart it?").
**Why:** Matches Matt Pocock's philosophy — the map/no-map call is best made after probing the idea, not upfront in a form (wayfinder itself says: no fog → no map). Asking first is cheap and a wrong escalation has no undo path today.

## 3. New Feature form: title + one-liner visible; Branch-from under Advanced, defaulting to the current branch
**Decision:** The form shrinks to title (Enter submits) + optional one-liner. "Branch from" moves behind a collapsed Advanced disclosure and **defaults to the branch currently checked out in the project repo**. Burns never touch the user's checkout (burner branches live only in isolated sandcastle worktrees), so the current branch is always one the user chose — fall back to main only when HEAD is detached or a test drive has runcastle itself temporarily on a feature branch.
**Why:** Happy path becomes "type a title, hit Enter, grill opens". The user repeatedly nearly forgot to switch base from main to their working branch — defaulting to the current checkout matches intent; main-as-default caused near-misses.

## 4. Kickoff injection for every session kind — no more dead starts
**Decision:** Generalize the converge-only PTY kickoff (type kickoff line 1.5s after SessionStart marks live, then Enter as a separate keystroke) into a per-kind kickoff line for all session kinds: ideation, waypoint, revisit, qa, converge. One code path, per-kind message (e.g. ideation: "Proceed with your task: invoke /runcastle:ideate…").
**Why:** Every session kind has a defined opening move; making the user type "Hi" to wake the agent is pure friction. The mechanism already exists and is E2E-proven for converge; the claude CLI offers no initial-prompt flag for interactive sessions, so PTY injection is the mechanism regardless.

## 5. Embedded terminal: fix modifier+Enter, audit common Claude Code shortcuts
**Decision:** Install an xterm.js `attachCustomKeyEventHandler` in `TerminalView` so Shift+Enter and Ctrl+Enter insert a newline in the Claude prompt instead of submitting (exact byte sequence verified against the Claude TUI during implementation). Same ticket does a quick audit of other embedded-terminal interactions: Ctrl+C, arrow keys/history, and especially multi-line paste (bracketed paste), fixing what's broken.
**Why:** Stock xterm emits bare `\r` for Enter regardless of modifiers, so the TUI submits. Known-broken shortcut is modifier+Enter; the paste path is suspect because the server's own kickoff code documents that text+`\r` in one write is treated as paste — the audit catches adjacent breakage while the file is open.

## 6. Review-phase iteration via the existing `revisit` kind, surfaced as "Iterate"
**Decision:** Extend `revisit` session availability to the `review` phase, labeled **"Iterate"** in the next-step bar (secondary action beside Merge & ship / Test drive, available whenever no session is live). Its review-phase kickoff line directs the agent to read the run outcome + ticket states, interview the human about what they found (bugs, tweaks), and emit fix tickets. No new session kind.
**Why:** `revisit` already resumes the feature conversation with full docs/ticket context and does ticket surgery without advancing phases — the review loop is a UI-surfacing gap, not a server gap. One session kind with phase-appropriate kickoffs beats a parallel near-duplicate kind.

## 7. The pipeline loops: burn from review returns the feature to implementation
**Decision:** `burn` accepts launch from `review` when pending (non-terminal) tickets exist; burning moves the phase back to `implementation`, and the existing auto-advance (G4: all tickets terminal) returns it to `review` when the run finishes. After an Iterate session emits tickets, the UI prompts Burn exactly as it does in the tickets phase (Burn becomes the primary next-step action at review while pending tickets exist). The loop review → iterate → burn → review can repeat until the human clicks Merge & ship.
**Why:** The human's real workflow is find-bug → fix → re-verify; a strictly forward-only pipeline forces workarounds. Burn stays the human gate every cycle; G4/G5 semantics are unchanged.

## 8. Archive (any feature) + Delete (non-shipped only)
**Decision:** Add `archived` to `FeatureStatus`. **Archive**: allowed from any phase, ends any live session, hides the feature behind a "show archived" sidebar filter, keeps all data, reversible (unarchive). **Delete**: allowed for non-shipped features only, requires a confirmation dialog; cancels active runs, ends sessions, stops a test drive of that feature, removes the talk worktree, deletes `feature/<slug>` + runcastle temp branches, deletes all DB rows (feature, tickets, sessions, runs, events, gate overrides, waypoints) and session artifact dirs. Committed `docs/features/<slug>/` history is left untouched — no history rewrite, no removal commit; branch deletion orphans them naturally.
**Why:** Archive covers "get this out of my sidebar" reversibly; delete covers abandoned experiments. Shipped features are merged into the base branch, so deleting their rows would orphan the record of shipped work — archive handles those.

## 9. Merge conflicts resolve inside the loop
**Decision:** When Merge & ship hits a conflict, the review UI surfaces the conflict state and offers to open an Iterate session pre-briefed to resolve it: the agent merges the base branch into the feature branch in the talk worktree, resolves conflicts with full spec/decisions context, commits, and hands back to the human to retry Merge & ship. Implemented as one more revisit kickoff variant, no new machinery.
**Why:** Today `merge.conflict` is an event with no path forward — a dead end exactly when iterate/burn cycles make base drift likely. The same flow doubles as a general "update from base" for long-lived features.

## 10. Desktop notifications for away-period endings
**Decision:** The web app uses the browser Notification API (permission requested once) to fire desktop notifications on events that end an away-period: run succeeded (→ review ready), run failed, and any session state that needs the human. Driven entirely by the existing 1.5s events poll — no server changes, no email/webhook infrastructure.
**Why:** Burn-and-walk-away is the product's promise, but today nothing signals completion; the client already sees the event within 1.5s and just doesn't surface it.
