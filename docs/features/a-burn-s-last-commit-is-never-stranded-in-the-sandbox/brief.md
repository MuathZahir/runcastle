# Brief

## The bug (seen 2026-10-28)

In round 1 of `tickets-stop-repeating-checks-and-tests-earn-their-place`, the runcastle server restarted ~2 minutes in (11:10:37). Both workers kept running. Ticket 2's agent finished, with typecheck and tests green, and committed — but the commit's sync back to the host was refused with git's "stale info" (a `--force-with-lease` rejection). The sync hook then printed its standard line, `runcastle: commit sync failed (will retry on your next commit); do not re-commit`, and exited 0. The agent trusted it and stopped. There was no next commit, so the container was removed with the only copy of the work, and runcastle marked the ticket failed with "agent made no commits". (Ticket 1, in the same round, only landed because its agent noticed and pushed by hand.)

**Expected:** a finished ticket's commits reach the host's temp branch, or the ticket fails loudly saying its commits were stranded — never silently "no commits".
**Got:** the final commit dies in the sandbox whenever its sync fails, because the hook's only recovery is "the next commit carries it".

## Where

- The post-commit sync hook is written by `buildRepoSetupSteps` in `packages/server/src/workflows/ticket-burner.ts` (~line 1537); the doc comment above `buildIsolatedSetupCommand` (~line 1463) explains the "it will heal; do not re-commit" reasoning, which is wrong for the last commit.
- The retry repeats the identical `--force-with-lease` push, which cannot succeed if the lease itself is stale (the remote ref moved, e.g. after a server restart).

## What to do

Small, concrete fix — the feature's agent should build it itself, no workers needed unless the code says otherwise. Pick the approach in the feature's own session; candidates: make the retry refresh the lease (fetch the temp branch) before pushing again; and/or have the burner verify, before it accepts the agent's completion, that the sandbox HEAD reached the host temp branch and push it once more if not. The hook's message must stop telling the agent a later commit will heal it when there may be none. Add a test for the behaviour that matters (a stale lease still syncs / a stranded last commit is caught), not for the hook text.

## Must not swallow

- **The burner prompt (`packages/skills/burner/implement-ticket.md`) and the verify-notes text.** The in-flight feature `tickets-stop-repeating-checks-and-tests-earn-their-place` is rewriting both. Fix this in the hook and the burner's own logic; if the agent's instructions truly need a line, put it in the hook's stderr message, which the agent already reads.
- Server-restart recovery in general (orphaned rounds, late round wakes). Only the stranded-commit path.

## Working agreement

**Autonomous**, the human on 2026-10-28: "start it now and finish it yourself if it doesn't affect other features." The orchestrator carries it to merged. It only touches the sync hook region of ticket-burner.ts, which no other in-flight feature edits.
