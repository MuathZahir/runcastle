# ADR-0006: Burn robustness — attempt chaining, transient-error retry, per-ticket controls

- **Status:** accepted (2026-07-22)
- **Extends:** ADR-0002 (burn concurrency) and ADR-0005 (isolated workspace),
  whose post-commit sync hook is what makes the core mechanism here — commits
  surviving a dead agent — hold in every workspace mode.

## Context

A real burn died like this: the ticket-2 agent had finished its implementation
work and was re-running lint for a final verification when the Anthropic API
stream dropped ("Connection closed mid-response"). In non-interactive
`claude --print` mode the CLI cannot recover a dropped stream — it exits 1.
Sandcastle 0.12.0 treats any nonzero agent exit as fatal
(`AgentError: claude-code exited with code 1`), the burner mapped the throw
straight to a failed ticket, and the run closed 2/3.

Three structural gaps made a two-second network blip cost a nearly-finished
ticket:

1. **No transient-error retry.** `burnMaxIterations` only covers turns that end
   *cleanly* (exit 0 — context cut, idle stop); a mid-stream drop exits nonzero
   and short-circuits the whole sandcastle run before the iteration loop can
   act.
2. **Work was orphaned, not lost.** The dead attempt's commits still sat on its
   temp branch — in every workspace mode (isolated mode's post-commit hook
   pushes each commit to the host worktree; mounted/noSandbox commit directly
   into a host worktree) — but nothing ever looked at that branch again. The
   whole-feature re-burn started failed tickets from scratch.
3. **No surgical controls.** The user's only tools were run-wide: cancel the
   run, or re-burn everything. No per-ticket retry, no way to stop one stuck
   agent without killing its siblings, no way to discard a bad attempt chain.

True session resume (`resumeSession`) was considered and rejected: sandcastle
captures the session JSONL to the host only *after* a successful agent exit, so
on precisely the failure paths that matter there is no session to resume (and
for container sandboxes the in-container `~/.claude` dies with the container).

## Decision

**Attempt chaining: a retry runs on a fresh temp branch *based on the failed
attempt's branch*, and the new agent is told to continue, not start over.**

1. **Classify throws** (`classifyTicketRunError`): transient infrastructure
   deaths (nonzero CLI exit, idle timeout, connection/network errors,
   overload/rate-limit/5xx, session-capture failure) are `retryable`; auth,
   billing, and model errors are `fatal`, and fatal patterns win (an
   `exited with code 1: Invalid API key` never retries). Unknown throws default
   to fatal — blind retries of git/sandbox setup errors would compound.
   Interpreted outcomes (zero commits, BLOCKED.md, landing conflicts) are agent
   or human decisions, never auto-retried.
2. **Retry in-run** up to `burnAttempts` (new config, default 3, env
   `RUNCASTLE_BURN_ATTEMPTS`) with 5s/10s/20s backoff. Each attempt gets a
   unique temp branch; if the dead attempt left commits, the next attempt's
   `baseBranch` is the dead branch (the chain), and the prompt gains a
   `buildRetryNotes` block: what happened, how many commits are already on the
   branch, `git log` first, do not revert or redo.
3. **Persist the chain across runs**: a ticket that still fails stores its
   chain tip in `tickets.attempt_branch`. The next burn of that ticket — the
   whole-feature re-burn or a per-ticket retry — resumes from it the same way;
   a successful landing clears it. The boot temp-branch sweep already keeps
   unmerged branches, so preserved chains survive restarts; once landed, the
   intermediate branches become merged and are swept normally.
4. **Interpret over the chain**: a resumed agent that verifies the work and
   commits nothing new is *done* (the chain lands); one that commits nothing
   new and writes BLOCKED.md is failed with the chain preserved. Landing the
   final branch lands the whole chain, so the serialized merge queue is
   unchanged.
5. **Per-ticket controls** (new tRPC `ticket` router + run-lane UI):
   - `ticket.retry` — reset ONE failed ticket (plus its transitive *failed
     blockers*, without which the retry would just cascade back) to pending and
     start a burn; other failed tickets stay failed, unlike the whole-feature
     re-burn. `fresh: true` deletes the preserved branch and clears
     `attempt_branch` first. Refused while a run is live (the scheduler
     snapshots its ticket set at start and would strand the reset ticket).
   - `ticket.stop` — abort one burning ticket's agent via a per-ticket
     `AbortController` composed with the run signal (`AbortSignal.any`). The
     ticket fails as "stopped by user" with its commits preserved — dependents
     cascade rather than silently building on missing work; the user then
     retries (continue), retries fresh, or cancels the ticket (which satisfies
     dependents).
   - Failed lanes show the error headline inline; `ticket.retrying` /
     `ticket.resuming` / `ticket.stopped` events narrate the timeline.

## Consequences

- A transient API/network death now costs one backoff delay plus a container
  re-setup, not the ticket — and never the committed work.
- Uncommitted changes still die with the attempt (isolated mode's clone lives
  in the container). The burner prompt already pushes frequent commits; the
  retry notes tell the new agent exactly that only commits survived.
- A resumed attempt's branch may fork from an older feature tip; landing uses
  the existing non-fast-forward merge paths, so parallel-landing conflicts are
  possible exactly as before — conflicts remain human territory and are never
  chained or auto-retried.
- `burnAttempts` multiplies worst-case cost of a genuinely crashing environment
  (bounded at 5); fatal classification and the no-retry default for unknown
  errors keep pathological loops out.
