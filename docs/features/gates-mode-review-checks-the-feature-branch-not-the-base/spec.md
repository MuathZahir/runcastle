# Gates-mode review checks the feature branch, not the base

## Problem

A review pass runs the project's verify commands (typecheck, tests) and the review page reports the pass as "gates mode · Verified". But the review agent works in the human's real checkout, which is still on the base branch — the lap's merge moved the feature ref without switching any checkout, and the prompt forbids the reviewer from checking the branch out or installing dependencies. So the gates test **main's** code. "Gates passed" proves only that main is green; the branch's own code is checked only by the implementers who wrote it, in their own sandboxes, self-reported. Reviewers keep noticing and writing it into their digests, and one improvised a scratch copy — the self-built environment the prompt forbids.

The human, reading the review page, cannot tell what was actually tested, or on which commit, because the only record of the gates is the agent's own prose.

## Approach

**What the human sees.** Every review pass — the lap's first review and each verification pass after fixes — now has a **Checks** section built from a record the server kept, not from the agent's words: one line per verify command marked *passed*, *failed* or *couldn't run* (with the reason), the short sha of the feature-branch commit it ran against, and the command's output one click away for anything not green. In the review trail each pass shows its own checks, so a lap reads as "tests failed → fixed → tests pass" across two shas. The headline review status shows only the **latest** pass's checks — the branch as it stands. A project with no verify commands configured says exactly that. Nothing is ever shown as passed that did not run and pass on the branch.

**The shape of it.**

1. **Server gate run (new).** Before the review agent starts — in the review-ticket workflow, ahead of the prompt being rendered and therefore before the agent picks Gates or Drive — the server runs the project's resolved verify commands (project-first, as `buildGateNotes` already resolves them) against the feature branch's tip sha at that moment. It runs them **wherever that project's burns run**, reusing the burn execution path as-is: a docker/podman container from the same image, the same dependency install (`setupCommand` or lockfile auto-detect), a warm burn cache slot where available; the same host-side setup burns use under `noSandbox`. No new execution path, no new rule about where installs may happen — the host checkout and talk worktrees are never touched. Each command runs once, under a time limit reusing the burn install step's 15-minute limit. Exit code decides passed/failed; output is captured to a file alongside the review's other artifacts (outside the repo, as the walkthrough already is).

2. **Gate result (new contract, stored on the review ticket).** The run produces one record per review pass, persisted on the review ticket row next to `reviewMode` / `reviewVerdict` / `reviewedCommit`. Its shape (decision-rich, from the ideation discussion):

   ```ts
   type ReviewGateRun =
     | { status: 'none_configured' }
     | { status: 'couldnt_run'; commit: string; reason: string; outputRef?: string }   // sandbox unavailable, install failed…
     | { status: 'ran'; commit: string; commands: GateCommandResult[] }

   type GateCommandResult = {
     command: string
     outcome: 'passed' | 'failed' | 'couldnt_run'   // couldnt_run = timed out / could not start
     exitCode: number | null
     reason?: string                                 // for couldnt_run
     outputRef: string                               // captured output, served over HTTP
   }
   ```

   The mutation emits an event (SPEC §12), so the review page updates live.

3. **Failure never blocks the review.** If the run as a whole can't complete (sandbox unavailable, install fails), the record is `couldnt_run` with the reason and the review proceeds on diff reading. It is an observation, never a defect against the branch, and never rendered as passed.

4. **Reviewer is handed results, runs nothing.** `buildGateNotes` stops saying "run exactly these" and instead renders the stored result into the prompt: per command, outcome, sha, and where to read the captured output. The review and verification prompt templates drop "run the gates first": the reviewer runs **no** verify commands in the host checkout (they would test the base branch — the bug itself). A failed command is a defect with the command as its repro; the reviewer reads the branch (`git diff` / `git show`) to explain it, and subtracts anything the project's `knownFailures` baseline lists, as today. No base-branch gate run. The no-checkout, no-install, no-self-built-environment rules and Drive mode are otherwise unchanged; Drive reviews get the same results for free because the run happens before mode choice. The digest's "say whether the gates passed" becomes "discuss the server's gate results".

5. **Review page renders the record.** The per-feature review listing gains the gate record per review ticket; the output file is served over the same HTTP route family as the walkthrough. The web review derivations pick per-pass checks for the trail and the latest pass's for the headline status.

## Seams

- **Server gate runner** *(new)* — one function taking the project, resolved config and a feature-branch sha, returning a `ReviewGateRun`. Its executor is injectable so tests can observe: which sha was checked out, that commands ran exactly once each in order, the time limit, and each path to `none_configured` / `couldnt_run` / `ran` with passed/failed/timed-out commands — without docker.
- **Review-ticket workflow** *(existing)* — observe that the gate run happens before the agent is launched, for both review and verification passes, against the tip sha at that moment; that its record is persisted on the review ticket with an event emitted; and that a `couldnt_run` still launches the reviewer.
- **`buildGateNotes`** *(existing, changed input)* — a pure function from the stored gate result (+ `knownFailures`) to prompt prose; observe the rendered text for each status, and that it no longer instructs running commands.
- **Prompt templates** *(existing)* — review and verify-fixes templates: observe the absence of "run the gates" instructions and the presence of the no-verify-commands rule.
- **`GET /api/reviews/:featureId`** *(existing)* — observe the gate record per review ticket, and the output file route serving captured output.
- **Web review derivations** *(existing, pure)* — observe per-pass Checks lines in the trail, latest-pass checks in the headline status, and the exact wording for `none_configured` / `couldnt_run`.

## Out of scope

- The review declaration parse bug (`review-declaration-parses-without-a-reason-line`) — a separate change.
- Drive mode's own checkout switch and setup (`review_drive start`) — untouched.
- Talk-worktree / no-install rules for interactive sessions — not loosened.
- The duplicated "Agentic review" button on the review page.
- Implementer-side gates inside burn sandboxes (`buildVerifyNotes`, `GATE_UNRUNNABLE.md`) — unchanged.
- Deriving a pre-existing-failure baseline automatically by running gates on the base branch.

## Open questions

None open from ideation. Mechanics left to the implementer within the decisions above: exactly how a burn sandbox is started for a non-ticket purpose (slot naming, container name), and the column/serialization chosen for the stored record.
