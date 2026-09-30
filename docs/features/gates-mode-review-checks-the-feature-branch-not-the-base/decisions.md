# Decisions — Gates-mode review checks the feature branch, not the base

## 1. The server runs the gates on the feature branch, in a sandbox, before the reviewer starts
**Decision:** Make the gates real rather than drop them. After the lap's last ticket lands and before the review agent starts, the server runs the project's verify commands itself: a burn-style sandbox checks out the feature branch's tip, installs dependencies the way burn containers already do, runs each verify command once and records the results. The reviewer is handed those results and no longer runs gates in the human's checkout; a red gate is a defect, the command its repro.
**Why:** Today the gates run on the base branch in the human's checkout, so "gates passed" proves only that main is green, and the branch's code is checked only by the implementers who wrote it. Running them server-side in a sandbox tests the actual branch, keeps installs inside sandboxes (ADR-0005, charter decision 6 — host checkout and talk worktrees stay untouched), stops reviewers improvising their own environments, and yields a structured gate result the review page can show honestly instead of relying on agent prose. "Stop pretending" was cheaper but gives up the only independent check on the branch's code.
**Where, considered and rejected:** (a) an on-demand tool the reviewer calls — same sandbox run, but the agent could skip or repeat it, which puts us back to trusting the agent to do it; (b) running the whole review agent in a sandbox on the branch — Drive needs the host (browser, dev server), so it would split the two modes and is a much larger change. The load-bearing choice is *the server runs the gates, not the agent*; running them before the agent starts is the simplest shape that guarantees they ran exactly once.

## 2. The gate run executes wherever the project's burns execute
**Decision:** The server's gate run reuses the burn execution path as-is: a docker/podman container for those sandbox settings, and the same host-side setup burns use under `noSandbox`. Same image, same dependency install (`setupCommand` or lockfile auto-detect), warm cache slot where available.
**Why:** No second execution path to build and maintain, and no new rule about where installs may happen — a project that already lets its burns install somewhere gets gates there too, and nowhere else.

## 3. A gate run that cannot complete is reported plainly and never blocks the review
**Decision:** If the gate run cannot produce a pass/fail — sandbox unavailable, dependency install fails, a command times out — the review still proceeds on diff reading. The gate result is recorded as "couldn't run" with the reason (and the captured output available), the review page says so in those words and never shows it as passed, and it is an observation, not a defect against the branch. Each verify command runs under a time limit, reusing the 15-minute limit the burn install step already uses.
**Why:** Diff reading is still worth having when the environment breaks; the environment failing is not the branch's fault, so it must not be filed as a branch defect — but it must never be passed off as green either. The time limit stops one hung test from stalling the review indefinitely.

## 4. Every review pass gets a fresh gate run, whatever its mode
**Decision:** The gate run happens for every review pass — the lap's first review and every verification pass after fixes — against the feature branch's tip at that moment, and before the reviewer chooses Gates or Drive. Drive mode gets the results too; its own checkout switch (`review_drive start`) is unchanged.
**Why:** A verification pass exists to re-check the branch after fixes, so it must see the new tip. Running before mode choice means Drive reviews get real gate results for free without touching Drive's machinery. The cost — a few minutes of sandbox + install per pass — is mostly absorbed by the warm cache slot.

## 5. Pre-existing failures stay a reviewer judgement against `knownFailures`
**Decision:** The server hands the reviewer each command's pass/fail and output; the reviewer subtracts anything the project's `knownFailures` baseline lists and files only new breakage as a defect — as today. No gate run on the base branch to derive the baseline automatically.
**Why:** The baseline setting already exists and works; a second run on base would double the cost of every review for a marginal gain.

## 6. The review page shows the server's gate record: per pass in the trail, latest pass in the headline
**Decision:** Each review pass carries a Checks section drawn from the server's stored gate result, not from agent prose: one line per verify command — passed / failed / couldn't run (with reason) — the short sha it ran against, and the output one click away for a failure or couldn't-run. In the review trail every pass shows its own checks (first review = before fixes, verification = after), so "failed → fixed → passes" reads as history. The headline review status shows only the latest pass's checks, since that is the branch as it stands. A project with no verify commands says exactly that.
**Why:** Today "gates passed" exists only in the agent's words; the page must show what was actually run, on which commit. Per-pass history keeps the fix story visible without letting an already-fixed failure masquerade as the current state.

## 7. The reviewer runs no verify commands itself
**Decision:** The review and verification prompts stop telling the reviewer to run the gates. The reviewer runs no verify commands in the host checkout; it reads the server's results and captured output, and for a failure reads the branch's code (via `git diff` / `git show`) to explain it. The no-checkout, no-install and no-self-built-environment rules, and Drive mode, are otherwise unchanged.
**Why:** Anything run in the host checkout tests the base branch — the exact bug being fixed. The server's run is the single source of gate truth.

## 8. One lap: the whole feature ships together
**Decision:** Spec the whole thing as lap 1 — server gate run + stored result, results handed to the reviewer, prompt changes, review-page Checks section. No deferred later-lap scope.
**Why:** The design is settled and nothing is uncertain enough to warrant a walking skeleton; a half-landed state (gates run but not shown, or prompt still telling the reviewer to run them) would be more confusing than today.
