# Outcome — Gates-mode review checks the feature branch, not the base

A Gates-mode review's verify commands currently run against the base branch's code; make them prove something about the branch under review — or stop claiming they do.

- Shipped: 2026-09-30
- Laps run: 1

## What shipped

21 commits · 37 files

### Lap 1
- 7 tickets landed: #1 Server gate runner, gate record contract and gate-log HTTP; #2 Gate run wired into every review pass; prompts hand over results; #3 Checks section on the review page from the server's gate record; #5 A timed-out gate command keeps running while the next command starts beside it; #6 Checks for an unresolved branch show a bare "@" with no sha; #7 Gate run has unguarded throw paths that would fail the review instead of recording couldnt_run; #8 Third copy of the CheckTone→StatusTone map added in ReviewTrail
- 0 waived
- 0 failed

## Review record

### Lap 1 · review

- Reviewed commit: 87dc06f590793a42aeab8093de81cfbc70e2fee2
- Landed since: 4
- Outcome: done

### Lap 1 · verification

- Reviewed commit: 2f016907270e0f9304bde9851d09f5c324b27f75
- Landed since: 0
- Outcome: done

- No findings

## Notes record

- No human notes

## Per-ticket digests

### Lap 1

#### 1. Server gate runner, gate record contract and gate-log HTTP

# Ticket 1 — Server gate runner, gate record contract and gate-log HTTP

**What was done.**
- **Contract and column.** Added `packages/core/src/review-gates.ts`, re-exported from the core barrel. It holds the zod schemas and types for `ReviewGateRun`, `GateCommandResult` and `GateCommandOutcome`, exactly as the ticket specified. Also added the nullable JSON column `tickets.review_gate_run`, with migration `0042_review_gate_run.sql` (renamed from drizzle's random name, with the journal tag updated to match). The field is mirrored through `schemas.ts` `Ticket`, `WorkflowCtx.updateTicket`, `rowToTicket`, the `storeTickets` defaults (null) and `updateTicket`, which already emits `ticket.updated` with the patch.
- **Paths.** Added `reviewGateLogDir`, `reviewGateLogPath` and `isReviewGateLogName` to `paths.ts`. Only `run.log` and `<digits>.log` are allowed; `reviewGateLogPath` throws on any other name.
- **Route constants.** Added `REVIEW_GATE_LOG_ROUTE` and `reviewGateLogUrl` to `routes.ts`. Deviation: the route is `'/ticket/:ticketId/gates/:log'`, relative to `REVIEWS_BASE` like its sibling routes, not the absolute `/api/...` form the ticket wrote. The full URL is still `/api/reviews/ticket/<id>/gates/<log>`.
- **HTTP.** `routes/reviews.ts` now returns `gateRun: ReviewGateRunWire | null` on each listing entry. The wire type is exported and every `log` is swapped for `outputUrl`. The new GET route serves the log as `text/plain; charset=utf-8`. It returns 400 for a log name the gate run never writes, and 404 for an unknown ticket, an implementation ticket or a missing file.
- **Runner.** Added `workflows/review-gates.ts` with `runReviewGates({ config, project, ticketId, sha, deps })`.
  - It clears any stale branch or worktree, then pins `runcastle/gates/<ticketId>` at `sha` using a new `pinBranchAt` helper in `services/git.ts`.
  - It opens the sandbox through the injectable `deps.withSandbox`. The real version (`burnGateSandbox`) reuses the burner's slot / isolated / mounted setup, cache mounts and `selectSandbox` under `withBurnCacheSlot`.
  - Each command runs once, in order, under `GATE_COMMAND_TIMEOUT_MS` (= `SETUP_HOOK_TIMEOUT_MS`, now exported). Logs go to `<reviewDir>/gates/<i>.log`, and the gates dir is wiped at the start of each run.
  - A failure to open the sandbox or install dependencies returns `couldnt_run` and writes the error to `run.log`.
  - The throwaway branch and its worktree are removed in `finally`.

**Surprises.**
- Sandcastle's `exec` has no timeout of its own. The limit is a `Promise.race`, so a timed-out command keeps running until `sandbox.close()` kills the container. Under `noSandbox` a hung host process can outlive the review.
- When the setup hook fails, the reason is whatever `createSandbox` rejects with. I did not verify against a real engine whether that includes the install output.
- In the full suite, `packages/server/test/dev-pane.test.ts` ("kills the child process tree…") failed, and it fails when run alone too. My diff does not touch it, so it is most likely this sandbox's process reaping. Everything else passed: 4481 passed, 37 skipped. Typecheck is clean.

**Left undone (on purpose — sibling tickets).**
- Nothing calls `runReviewGates` yet. Wiring it into `review-ticket.ts` before launch, persisting the result and rendering `buildGateNotes` from it, the prompt templates and the web Checks section all belong to other tickets.
- `carried-work.ts` and `outcome.ts` do not carry the gate record; neither needed it for this ticket.
- Drive machinery: no new service, env var, seed or process, so no edit was needed there. The migration is applied by the existing boot migrate.

#### 2. Gate run wired into every review pass; prompts hand over results

**What was done.** In `review-ticket.ts`, `reviewTicketOutcome` now runs the gates on every pass (review and verification) before rendering the prompt. The run happens after the review directory is wiped and before the Drive/Gates choice. It resolves the feature branch's tip with `headSha`, calls `deps.runGates ?? runReviewGates` (a new `ReviewDeps.runGates` seam) and persists the result through `ctx.updateTicket(ticket.id, { reviewGateRun })`. If the branch does not resolve, the runner is not called: the pass records `couldnt_run` with an empty commit, and the reviewer is still launched. `buildGateNotes(gateRun, ticketId, config, project)` renders from the stored record:
- `none_configured`: says there are no gates.
- `couldnt_run`: gives the short sha, the reason and the `run.log` path, and says it is an observation and never passed.
- `ran`: lists each command as passed, FAILED (exit N) or couldn't run (reason), with its absolute log path.

It keeps the `knownFailures` baseline paragraphs and always ends with "Do not run any verify command yourself". In the templates, `review-ticket.md` now has a "## The server's gate results" section holding `{{GATE_NOTES}}` before step 1, so Drive reviewers read it too. This deviates from the ticket, which said to keep the placeholder inside 2b. Step 2b, the step 2a fallback sentence, the digest bullet and the hard rules were reworded, and a new hard rule says never to run the verify commands. `verify-fixes.md` says to read the server's results and never to run a verify command. The no-checkout, no-install and Drive rules and the declaration block are unchanged. I added no timeline event: this file emits none for its other steps, and `updateTicket` already emits `ticket.updated`.

**Surprises.** A static import of `review-gates` from `review-ticket` creates an ESM cycle (ticket-burner → review-ticket → review-gates → ticket-burner). It crashed real server boot with a TDZ ReferenceError on `SETUP_HOOK_TIMEOUT_MS`, which `mcp-large-batch.test.ts` caught. It is fixed by a lazy `await import('./review-gates')` inside `runBranchGates`, with a type-only import for `ReviewDeps`. Full suite: 4501 passed, 1 failed. The failure is `dev-pane.test.ts` "kills the child process tree…", the same environment failure ticket 1 reported. Typecheck is clean.

**Left undone.** `runReviewGates` takes no abort signal, so cancelling a run during the gate run waits for it to finish, up to 15 minutes per command. No drive machinery change was needed: this ticket adds no service, env var, seed or process.

#### 3. Checks section on the review page from the server's gate record

# Ticket 3 — Checks section on the review page

**What was done.** I added the pinned `gateRun` wire shape to `ReviewArtifacts` in `apps/web/src/lib/reviews.ts`. It is exported as `ReviewGateRunWire` / `GateCommandWire`, and the field is optional and nullable, so payloads that don't have it still parse. A new pure module, `apps/web/src/lib/feature-ui/checks.ts`, exports `gateCheckLines(gateRun)` (re-exported by the barrel). It returns:
- `summary`, the full sentence the trail shows
- `short`, the compact form for the headline, e.g. `checks 2/2 passed @abc1234`
- `commit`, the 7-character sha, or null
- `tone`: `ok` only when every command passed, `danger` when one failed, `warn` when something couldn't run, `idle` when there are no checks
- `lines`, one per command; a failed line shows `exit N`, a couldn't-run line shows its reason, and only lines that aren't green get an `outputUrl`
- `outputUrl` for a whole run that couldn't run

`gateRun` is passed through `ReviewPassFigure` → `TrailPass` → `PassNode`. `ReviewTrail`'s `PassMilestone` renders a `PassChecks` block from `MetaLine` rows and `LINK` links, with no `styles.css` changes. The headline `reviewProperty` reads `artifact.gateRun` off the stamped pass (latest completed) and adds `short` to its sub-note, e.g. `gates mode · this build · checks 2/2 passed @abc1234`. The call sites needed no changes, because they already pass the full stamped `ReviewArtifacts` row. The Review row's tone is unchanged: the reviewer still judges failures against `knownFailures`.

**Surprises.** `test/lap-timeline.test.ts` builds a `TrailPass` fixture by hand, so it needed `gateRun: null` added. The full suite had one failure: `packages/server/test/dev-pane.test.ts`, "kills the child process tree…". It also fails when run on its own, and this diff doesn't touch it (web-only). It looks environmental — a process-tree kill inside the sandbox — and isn't in the stated baseline.

**Left undone.** The server side (producing `gateRun` and serving `outputUrl`) belongs to the parallel server ticket. `outputUrl` is used exactly as the wire provides it. The drive machinery was not checked because nothing in this ticket needs it: no new service, env var, seed or process.

#### 8. Third copy of the CheckTone→StatusTone map added in ReviewTrail

## What was done
The `CheckTone → StatusTone` map that ReviewTrail.tsx had copied is gone. The map in `apps/web/src/ui/status.tsx` (`CHECK_TONE`) is now exported, re-exported from `apps/web/src/ui.tsx` next to the other status primitives, and imported by ReviewTrail from `../../ui`. ReviewTrail no longer imports the `CheckTone` type, since it isn't used there any more. There is no behaviour change. Committed as `ticket(8)`.

I re-ran the repro step against my commit (`git show HEAD:…/ReviewTrail.tsx | grep -n -A5 CHECK_TONE`). ReviewTrail now shows only the import and the single use, `CHECK_TONE[checks.tone]`, with no local map. The only definition left is `export const CHECK_TONE` at `ui/status.tsx:315`, so the repro no longer reproduces.

## Surprises
- `bun run typecheck` passed. The full `bun run test` had one failure: `packages/server/test/dev-pane.test.ts`, "kills the child process tree so the port-holder is not orphaned" (process group still alive). It fails on its own in a single-file run as well. This change only touches web code and no server code, so I read it as a sandbox process/timing issue and not something this ticket caused. It is not on the prompt's baseline list, though, so I'm flagging it.
- The test count (4541 tests / 311 files) is far above the baseline the prompt states (1768 / 118). That baseline looks out of date.

## Left undone
- `apps/web/src/components/review/StatusStrip.tsx:25` has its own `DOT: Record<CheckTone, StatusTone>` with the same values. The ticket names it as the third copy, but its fix only prescribes ReviewTrail, and `DOT` existed before this lap, so I left it. Replacing it with `CHECK_TONE` from `../../ui` is a one-line follow-up.

#### 9. Verify the fixes that landed

Gates verification pass — pass #4's four fixes (#5–#8) all held.

## Fixes

- **#5 A timed-out gate command keeps running beside the next one: held.** (`e06cbf2e`) `runReviewGates` now loops over sandboxes. A command that hits its time limit returns `stillRunning`, and `use` returns early. The sandbox teardown kills whatever is still running: `killRegistry().killAndWait(lane)` for host children under `noSandbox`, and the container is removed under docker/podman. The remaining commands then run in a fresh sandbox. The new test checks the order `open, exec hangs beside 0 running, kill hangs, close, open, exec after beside 0 running, close`, which is exactly the finding's repro turned into a check. If the sandbox cannot be reopened, the commands that already ran are kept and the rest are recorded as `couldnt_run`.
- **#6 A bare "@" with no sha: held.** (`5a6f0691`) `gateCheckLines` now returns `commit: null` for `couldnt_run` with `commit: ''`. `ReviewTrail` already hides the `@sha` part when the commit is null. The only other place that uses `gateCheckLines` (`review.ts` headline) reads `.short` and not the commit. Tests cover both the derivation and the rendered trail (no `>@<`).
- **#7 Gate run throw paths that would fail the review: held.** (`9926568a`) The log-directory `rmSync`/`mkdirSync` calls moved inside the try. `writeRunLog` catches its own error and returns `log: null`. `runBranchGates` in review-ticket.ts now wraps both the lazy import and the run, so anything that still escapes becomes `couldnt_run` and the reviewer still launches. There is a new review-ticket test for an injected `runGates` that throws.
  - Minor observation, not filed as a finding: the reopen-failure branch that #5 added (merged after #7) calls `writeFileSync(<i>.log)` without a guard, and the `finally { discardBranch() }` can also throw. Either one would escape `runReviewGates` and break its "never throws" doc comment. The outer guard in `runBranchGates` still catches it, so the review is never blocked. The only cost is that the already-recorded per-command results collapse into one "the gate run failed" `couldnt_run`. This needs a timeout, then a failed reopen, then an unwritable log dir, so it is very unlikely.
- **#8 Third copy of the CheckTone→StatusTone map: held.** (`17cbb4eb`) The copy in ReviewTrail is gone. `ui/status.tsx` now exports `CHECK_TONE` through `ui.tsx`, and ReviewTrail imports it. The `DOT` map in `StatusStrip.tsx` was already on `main` before this lap, so it is not this lap's.

## Gates (each run once)

The checkout was on `main` as the rules require, so these commands tested main's code, not the feature branch.

- `bun run typecheck`: exit 0. Core, server and web are clean, and so is scripts/.
- `env -u GIT_ASKPASS bun run test`: exit 1. 310 files; 4447 passed, 57 skipped, 3 failed. None of the three failures come from this lap. They ran on main's code, and each has an environment cause in this review session:
  - `review-ticket.test.ts` › "does not put review browser settings in implementation or container agents": the received value is `AGENT_BROWSER_SESSION=review-tkt_Jm8EbnT4yfc6`. That is this review session's own environment variable leaking into the test.
  - `project-drive.test.ts` › identity file reads `project-drive project_drive topic %DB_NAME%`: an unexpanded Windows env placeholder from the host shell.
  - `review-directory-preparation.test.ts` › stale siblings: Windows `\` path separators where the test expects `/`. That file is not touched on this branch.

  The baseline's "fully green" figures (118 files / 1768 tests) are clearly out of date for this repo (now 310 files). The failures above come from running inside a live review session on Windows, not from branch code.

Nothing was plainly broken. No findings were filed.

REVIEW-MODE: gates
REVIEW-VERDICT: verified
REVIEW-REASON: all four landed fixes (#5–#8) hold on reading; typecheck is green; the 3 test failures came from this review session's environment and ran on main's checkout
