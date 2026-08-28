# ADR-0008: Burn performance — measure the burn, bound the agent, enforce the rules

- **Status:** accepted (2026-07-27)
- **Extends:** ADR-0004 (dependency caching) and ADR-0005 (isolated workspace),
  both of which fixed *environment* costs. This one addresses what the agent
  itself spends, which turned out to be larger.

## Context

Two independent passes over real burn history — 10 sandcastle logs, then the
SQLite event log plus the live in-container Claude transcripts — put roughly
**30 hours of agent time across 42 ticket attempts** (~43 min/attempt), of which
**7.1 hours went to attempts that never finished**.

Where the time went, by category:

| Category | Share |
|---|---|
| running tests | 41% |
| model thinking/writing | 19% |
| reading/grepping via Bash | 16% |
| typecheck | 11% |
| git | 5% |
| build/codegen | 3% |
| lint + format | 2.5% |

Five findings drove this ADR:

1. **An iteration is not a cheap retry.** Sandcastle calls `withSandbox` INSIDE
   its iteration loop, so every iteration builds a new container and re-runs
   `onSandboxReady` — 70–507s of dependency install per iteration, ~2.5 min
   average, ~51 min across 21 iterations — and the fresh agent re-reads
   everything the dead one had already read. A code comment claimed the
   opposite ("the same warm container, so the setup hook runs once"); it was
   wrong.

2. **Uncommitted work dies with the process, and agents batch commits.** 9 of 21
   iterations ended with the agent exiting 0 without
   `<promise>COMPLETE</promise>`. Commit cadence was the best available
   predictor of success: the ticket that committed 6 times finished in 46 min on
   one iteration; the ticket that committed 0 times burned two iterations and
   shipped nothing.

3. **Serialising the test suite is catastrophic, and agents did it constantly.**
   51 invocations across 10 logs passed `--maxWorkers`, `--pool`, `--shard` or
   `--runInBand`. A suite that runs in ~55s at its configured concurrency took
   **10–20 minutes** serialised (worst single call observed: 1208s). The agents
   were not being careless — they were surviving real `exit 137` OOM kills.

4. **Agents used the shell for everything.** 1641 Bash calls and **zero**
   `Read`/`Grep`/`Edit`/`Write`. 62% of all tool calls were repo reading through
   `cat`/`sed`/`grep`/`find`, and 129 calls rewrote files by piping `python3`
   heredocs — individual ones measured at 29s, 57s, 120s and 761s. Nothing
   restricted the toolset (`buildBurnAgent` sets no `allowedTools`); the agents
   simply were never told the tools existed.

5. **Prompt rules did not hold.** The prompt has said "run any full suite once"
   since before this work; the same suite was re-run five, six and seven times
   within single tickets.

## Decision

**Measure the burn, bound the sandbox, and enforce the handful of rules that
prompt text demonstrably could not.**

1. **Timing telemetry** (`createToolTimer`, `classifyToolCall`). The sandcastle
   stream already carries a timestamp on every event; the burner stopped
   discarding it. Each event closes the previous one's interval, charged to the
   preceding tool's category (or `model` after a text event). A `ticket.timing`
   event is emitted on **every** exit path, because a failed ticket is exactly
   the one whose breakdown you want. Iteration boundaries and gaps over 20 min
   are dropped — they are container rebuilds, not work.

   Honest limit: a tool's interval includes the model's latency in producing the
   next event, so per-call figures are upper bounds. This is built for comparing
   category **shares** across burns, which needs no coupling to Claude Code's
   stream-json internals. The classifier is validated against the real corpus of
   1648 logged commands, not only against unit fixtures — which is how two
   material bugs were caught (a filename read as the tool being run, and
   `pnpm --filter <pkg> test` not matching, which alone under-counted the
   largest category by a third).

2. **The burn guard** (`burn-guard.ts`, config `burnGuard`, default on). A
   Claude Code `PreToolUse` hook, installed into each sandbox by the same
   `onSandboxReady` hook that installs dependencies, denying: `git stash`,
   test-runner concurrency overrides, and file rewrites through interpreter
   heredocs. Verified against the Claude Code docs: PreToolUse hooks "fire
   before any permission-mode check and can enforce policies by returning deny,
   even in `bypassPermissions` mode" — which is what sandcastle runs AFK agents
   in, making this the only layer that binds. Hooks can only tighten, never
   loosen.

   Written as POSIX `sh` (the image ships `jq`) and delivered base64-encoded
   inside the setup command, so it needs no new vendored asset and no rule text
   can break the shell. Rules live in one TS table that drives both `grep -E` in
   the container and the unit tests, so there is no second transcription to
   drift. Every failure path exits 0 — no `jq`, no stdin, a non-Bash tool, a
   timeout — because a guard must never be able to wedge a burn.

   **Scope discipline:** every rule is one an agent cannot reasonably need. A
   false deny in an unattended agent is expensive. "Re-running a full suite" is
   deliberately NOT a rule — the prompt explicitly permits a second run after a
   fix, and the guard cannot distinguish the two.

3. **`burnCpus`** → the providers' `--cpus`. At width N every container
   otherwise sees the host's full core count and sizes its worker pools from it,
   oversubscribing the box N-fold. **Deliberately no memory twin**: sandcastle
   exposes no `--memory`, and a hard cap would convert host-level pressure into a
   certain in-container OOM kill of the agent. Bound memory with
   `burnConcurrency`.

4. **`verifyCommands` + `knownFailures`** → a `{{VERIFY_NOTES}}` prompt block.
   The operator states once what every agent was otherwise rediscovering per
   ticket: the repo's real verification commands (one ticket burned two full
   suite runs discovering `--filter helix` was the wrong workspace name) and the
   pre-existing-failure baseline (which every agent re-derived by running the
   whole suite before touching anything). `verifyCommands` is also the only
   sanctioned way to bound test concurrency, now that agents may not.

5. **Prompt rules** for the parts a hook cannot check: commit every green slice
   and never end a turn on uncommitted green work; use `Read`/`Grep`/`Edit`
   rather than the shell; capture a suite's output to a file and read it back
   rather than re-running; and treat a guard denial as policy rather than a
   broken environment.

## Consequences

- Every burn now emits its own time breakdown, so the effect of a change is
  measurable in-product instead of by forensic reconstruction. This is the
  gate for any further performance work.
- Agents lose three habits they used constantly. The concurrency-flag denial is
  the one with real risk attached: under genuine memory pressure the sanctioned
  fallback is to run only the touched test files and say so, NOT to serialise.
  If that proves wrong in practice, `burnGuard: false` reverts to prompt-only.
- Committing every green slice multiplies the one operation still crossing the
  host mount under ADR-0005 (the post-commit push). It was originally a push
  *plus* a `reset --hard` of the mounted working tree, which stats every tracked
  file across the mount — 15–90s a commit, ~19–25 min over a feature — and that
  reset is gone: the hook is push-only, so a synced commit now costs one pack
  write. The mounted worktree is left dirty as a result, which means sandcastle
  preserves it rather than removing it, and runcastle removes it host-side with
  `cleanupBurnWorktree` once the run is over — no sandcastle teardown hook
  required (`SandboxHooks` has only `onWorktreeReady`/`onSandboxReady`, and none
  is needed).

## Rejected

- **Adding pnpm back to `PM_CACHE_SANDBOX_PATHS`.** Re-raised during this work
  as a missing-key bug. It is ADR-0004's measured decision: a bind-mounted pnpm
  store cannot hardlink into the container overlay, so pnpm copies every file of
  every package, and the run measured with that mount installed in **751s** —
  slower than the 71–507s cold installs it would replace. ADR-0004 predicted
  this exact suggestion. A Docker *named volume*, not a bind mount, is the
  mechanism if it is ever revisited.

- **Moving runcastle and target repos into the WSL2 filesystem.** Also re-raised.
  ADR-0005 considered and rejected it as a product decision (bootstrap wizard,
  data-dir migration, breaks "point it at your existing repo", nothing for
  macOS) and shipped `burnWorkspace: isolated` instead. All 22 sandbox setups in
  the reviewed logs use the isolated clone, so the hot path is already off the
  mount; only the per-commit sync still crosses it.

- **Reusing the container across iterations.** Container reuse is sandcastle's
  to give — `withSandbox` is inside its iteration loop.

## Session resume — three cases, only one of them blocked

Recorded because an earlier draft of this ADR collapsed these into a single
"resume is rejected", which is wrong and would have buried a real opportunity.

1. **Interactive terminal sessions** (`launcher.ts`) resume today, via
   `claude --resume <ccSessionId>`, with a resume target per session kind. Not
   affected by anything here — these run on the host, where the session JSONL is
   already in `~/.claude/projects/`.

2. **Burn ATTEMPT resume — genuinely blocked, and ADR-0006 is right.** An
   attempt dies when `run()` throws, and the common throw is a nonzero CLI exit.
   Sandcastle's `invokeAgent` does `Effect.fail(new AgentError(...))` on a
   nonzero exit *before* reaching its capture block, so on exactly that path
   there is no session on the host to resume, and the container's `~/.claude`
   dies with it. ADR-0006's `buildRetryNotes` remains the answer.

3. **Burn ITERATION resume — available, and not what ADR-0006 evaluated.** The
   abnormal endings this ADR measures are the *other* shape: `claude --print`
   exits **0** without emitting the completion signal (9 of 21 iterations).
   `invokeAgent` returns normally, so sandcastle captures the session —
   "Capturing session" follows every one of them in the logs — and
   `sessionStorage.resumeIntoSandbox` exists to rewrite that JSONL into a fresh
   container. `RunResult.iterations[].sessionId` exposes the id.

   The only obstacle is sandcastle's own guard: `resumeSession` is refused when
   `maxIterations > 1` and applied only to iteration 1. runcastle can sidestep
   it without an upstream change by running `maxIterations: 1` and driving the
   loop itself — which is machinery it already has, since ADR-0006's attempt
   chain is exactly that loop. Folding iterations into the attempt chain, and
   attaching `resumeSession` when the previous attempt exited cleanly, would
   remove the re-orientation cost that finding 1 measures.

   Left unbuilt pending a measured burn (finding 1 is the cost; this ADR's
   telemetry is what will say whether it still dominates after the environment
   work). Known unknowns for the spike: whether the rewritten session replays
   cleanly into a new container, how the prompt interacts with a resumed
   session, and whether per-run commit collection and branch chaining stay
   correct when an "iteration" becomes an "attempt".

- **A hard container memory limit.** See decision 3.
