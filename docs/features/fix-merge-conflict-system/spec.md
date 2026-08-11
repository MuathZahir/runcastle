# Fix merge conflict system

## Problem

A Merge & ship that hits a conflict strands the feature. The review UI offers "Resolve with agent", but the revisit session it launches is briefed to merge the base branch in and resolve the conflicts while the talk-session edit guard denies every file write outside the feature docs — the brief and the guard contradict each other, so the agent either wedges or bypasses the guard with shell scripts. Worse, once the conflict *is* resolved, nothing ever clears the recorded conflict: the only event that supersedes it is a burn starting, so Merge & ship stays disabled ("Fix the merge conflict first") forever. And while the conflict stands, the next-step bar's conflict branch hides the Burn verb entirely — even with pending fix tickets — so the one event that could clear the conflict is unreachable. The user is deadlocked at the last step of the pipeline with no button that works.

The run lane's "Resolve in terminal" (a ticket branch that failed to land on the feature branch) launches the same session kind with the same resolve-and-commit brief, and is wedged by the same guard.

## Approach

From the user's perspective: clicking "Resolve with agent" opens a terminal whose agent can actually resolve the merge and commit it; when that session ends, the conflict card clears and Merge & ship is back as the primary action. If runcastle can't see the resolution (it happened outside a session, or the session died), Merge & ship is still clickable as an explicit retry — it either ships or refreshes the conflict card with the current facts. Fix tickets stay burnable throughout.

Four coordinated changes:

**1. Resolve sessions may write, scoped to an in-progress merge (decision 1).** Both conflict-resolve launch sites — the review conflict card and the run lane's ticket-landing escape hatch — mark the session they launch with a resolve-conflict purpose. The purpose is carried on the session row so the hook route can see it. The edit guard's evaluation gains that flag plus the worktree's merge state: for a resolve-purpose session, file writes are allowed while a merge is in progress in the session's worktree (MERGE_HEAD exists), and denied with the standard ticket message otherwise. All other session kinds/purposes behave exactly as today (decision 4: no Bash matcher; the guard's tool surface is unchanged). The guard stays fail-open on anything it cannot read.

**2. Resolution is detected at session end (decision 2a).** When a resolve-purpose session ends, the server checks in the talk worktree whether the merge landed — for a base-into-feature resolve, the base branch tip is now an ancestor of the feature branch. If so it emits a `merge.resolved` event on the feature. The event-feed derivation that yields the standing conflict treats `merge.resolved` exactly like `burn.started`: the conflict is superseded, the card disappears, and the review bar returns to its normal shape. The check is best-effort — a git failure must never break session teardown; it just means the fallback below carries the load.

**3. Merge & ship is never dead (decision 2b).** The review bar's conflict branch keeps Resolve as the primary but offers Merge & ship as an *enabled* secondary labeled as a retry, instead of disabled. The merge procedure itself already permits retries (the server never gated on the recorded conflict — the lock was purely in the UI). A successful retry ships the feature, which supersedes the conflict; a failed one emits a fresh `merge.conflict` event whose timestamp and file list replace the stale card. The bar therefore honors findings F8 (never *recommend* a merge that will fail again) without manufacturing a deadlock.

**4. Burn is reachable during a conflict (decision 3).** In the conflict branch of the review bar, when pending tickets exist, Burn appears as an enabled secondary sized to the pending count. Burning runs tickets on the feature branch and never touches the base merge, and `burn.started` already supersedes the recorded conflict.

No schema changes beyond the new session purpose (a nullable column or equivalent on the session row) and the new `merge.resolved` event type flowing through the existing event pipeline.

## Seams

- **`evaluateEditGuard` (existing, pure).** Input grows a resolve-purpose flag and a merge-in-progress signal. Observable: allow/deny verdicts for every (kind, purpose, merge-state, path) combination — the whole of decision 1 is testable here without git or a live session.
- **The hooks route's PreToolUse handler (existing).** Wires the session row's purpose and the worktree's real MERGE_HEAD state into the guard. Observable: deny shape returned for a wedged write, `{}` for an allowed one.
- **A merge-landed probe in the git service (new, small).** Given a worktree and two branches, answers "is the first now an ancestor of the second" — the resolution detector. Observable: boolean against a real repo fixture; used by session-end handling.
- **Session-end handling in the hooks route (existing).** For resolve-purpose sessions, runs the probe and emits `merge.resolved`. Observable: event emitted (or not) given the worktree's git state; teardown survives probe failure.
- **`unresolvedMergeConflict` (existing, pure).** Now cleared by `merge.resolved` as well as `burn.started`. Observable: derived conflict state from event sequences.
- **`nextStep` (existing, pure).** The conflict branch: enabled retry-merge secondary, Burn secondary when pending > 0, Resolve still primary. Observable: full bar shape per (conflict, pending, live, driving) combination.
- **`launchSession` input (existing, extended).** Both resolve launch sites pass the resolve-conflict purpose. Observable: session row carries the purpose; kickoff lines unchanged.

## Out of scope

- Any Bash/shell matcher on the edit guard (decision 4 — explicitly declined; the guard's tool surface stays `Edit|Write|NotebookEdit`).
- Changes to the burner's unattended sandbox resolver — it never had the guard problem.
- Hints or affordances on read-only phase views (decision 5 — the build-phase detour was a symptom of Burn being hidden).
- The generic revisit/ideation/qa guard behavior — unchanged for every session without the resolve purpose.

## Open questions

- None blocking. One note for implementation: the ticket-landing resolve merges the *ticket branch* into the feature branch, so the session-end probe must check the branch pair the session was launched about (carried with the purpose), not assume base-into-feature.
