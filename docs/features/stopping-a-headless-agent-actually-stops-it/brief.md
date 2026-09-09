## Why this feature exists

Repeatedly observed by the human: stopping a headless agent (burn, fix ticket, verification pass) flips the ticket to a terminal state in the UI, but events keep streaming in — the agent process is still alive and working. In one case a verification run "showed as stopped" after a waive while the agent visibly carried on. The stop affordance is currently a lie.

## What is actually wrong (diagnosed in the project session, 2026-09-08)

The whole stop chain is: UI Stop → `stopTicketRun` (packages/server/src/workflows/ticket-burner.ts:2199) → `AbortController.abort()` → the AbortSignal handed to sandcastle's `run()`. Runcastle does **no process or container killing of its own anywhere** in the workflows — it trusts sandcastle's documented "signal kills subprocess". That trust fails in at least two ways on this stack:

1. **Windows tree-kill.** The spawned CLI is `claude.cmd` (a shell shim) whose node grandchild does the actual work. Killing the direct child reaps the shim, not the tree. This exact bug class was already diagnosed and fixed for dev panes in the shipped feature `windows-dev-pane-teardown-kill-the-process-the-sidecar-actually-owns` (taskkill-/T-equivalent semantics, kill what the sidecar actually owns) — read its docs; the burn path needs the same medicine at the sandcastle boundary.
2. **Docker burns.** Killing the host `docker run` client process does not stop the container. The agent inside keeps burning; its post-commit hooks keep syncing commits; events keep arriving.

Secondary consequence: the outcome path marks the ticket terminal off the abort (DB and UI move on) while the orphaned process lives — so "stopped" is reported optimistically, and `cancelTicket` (waive, a pure DB flip that never touches a process by design) then accepts the terminal ticket, compounding the illusion.

## Design questions the grill session must resolve

- **Where does the kill live?** Sandcastle is already patched permanently by this project (ADR-0011, the named-volume patch) — is the fix another sandcastle patch (upstream-able), or a runcastle-side kill layered on top (e.g. docker kill by container name/label at abort time, taskkill /T /PID on the host CLI's tree)? Killing a container needs a handle — does the burner know its container name/label today, and if not, how does it get one?
- **Confirmation of death.** Should the UI show "stopping…" until the process is confirmed dead rather than flipping straight to stopped? What is the server's observable signal that it IS dead — process exit is knowable for host agents, container exit for docker ones. Today nothing observes it.
- **The orphan window.** A killed container may leave `.git/*.lock` files and half-synced state; the burner already has recovery for killed containers (ticket-burner.ts ~1309) — verify the stop path lands in a state that recovery handles.
- **Scope guard**: cancelRun (whole-run) and stopTicketRun (one lane) share the fix; the interactive PTY sessions and dev panes are already handled elsewhere and are NOT this feature.

## What this feature must not swallow

- Not the verification-pass repetition bug (own quick change: feature `verification-pass-repeats-itself…`).
- Not the dead "Continue to review" button (own quick change: `dead-continue-to-review-button…`).
- Not dev-pane/test-drive teardown — already shipped, only read for prior art.
