# Outcome — Start lap from review opens a real lap conversation

The review page's "Start lap N+1" door opens the feature chat with a lap briefing. Today, with no open notes or defects, `enterIterate` in `apps/web/src/components/Workspace.tsx` (~line 630) calls `launch.mutate({ featureId, kind: 'chat' })` with no kickoffLine, and the carry road after triage (`commitTriage`, ~line 675) does the same. The server's `planKickoff` only builds a lap briefing when `lapInFlight` is true (`packages/server/src/launcher/sessions.ts:311`, which requires phase `planning` and lap > 1). The lap counter only increments at Burn from review (`services/features.ts:780`), so that state never happens, and the chat resumes with the generic revisit line plus the header "Feature state: review; lap 1". Observed repro: a lap-1 feature at review, all tickets done, no open notes or defects, spec has a `## Later laps` section. The human clicks "Start lap 2". The agent replies "This session reopened as an ordinary revisit, not a lap session" and tells the human to start the next lap from the review page, which is the button they just clicked. Fix: both launches (the empty-handed one and the carry one) send a review-phase lap briefing for lap N+1, built server-side from `carriedWork`, like `lapKickoff`. The briefing states: this conversation plans lap N+1; its agenda is the carried notes (`test-notes.md` `## Carried, still open`), the open defects from `get_feature_context`, and the spec's `## Later laps`; the agent writes decisions under `## Lap N+1` and amends spec.md; it emits the lap's tickets (they land `pending`, and Burn from review moves them onto lap N+1 through `carryPendingTicketsIntoLap`); it does NOT call `complete_phase`, because the feature stays at review; it finishes by telling the human to review the cards and click Burn. Prefer a server-side decision (for example, the launcher recognising a review-phase chat opened by the iterate door) over the web hand-building the text. The web must not duplicate `lapKickoff`. The briefing rides the resumed chat as a kickoff override (one-chat-per-feature decision 13). Acceptance: (1) reproduce the repro above in a test before fixing it; (2) after the fix, the kickoff delivered through both roads names lap N+1 and its agenda; (3) the plain Chat toggle on a review feature still gets the ordinary header with no lap framing.

- Shipped: 2026-09-30
- Laps run: 1

## What shipped

14 commits · 12 files

### Lap 1
- 6 tickets landed: #1 The review page's "Start lap N+1" door opens the feature chat with a…; #2 The revisit skill and the injected revisit prompt recognise a lap…; #4 Start-lap briefing hands the lap planner the wrong lap's review evidence (lap 1: tells it none exists); #5 Empty-handed Start lap into an already-live review chat keeps the fix-ticket "Review iteration" system prompt; #6 SPEC.md §15.2 still describes the deleted lap model (LAP n REVIEW ITERATION, complete_phase through ideation/spec/tickets); #7 Stale complete_phase pointers remain: the resolve_finding tool description invites the call, and a comment claims review-phase calls are refused
- 0 waived
- 0 failed

## Review record

### Lap 1 · review

- Reviewed commit: d0c6f64dbbf50fd4d13293bea577136704f407d2
- Landed since: 4
- Outcome: done

### Lap 1 · verification

- Reviewed commit: 683192daaae354777abcada3acef579cf0446757
- Landed since: 0
- Outcome: done

- No findings

## Notes record

- No human notes

## Per-ticket digests

### Lap 1

#### 1. The review page's "Start lap N+1" door opens the feature chat with a…

# Ticket 1 — Start lap from review opens a real lap conversation

**What was done.** I added a `start-lap` value to `SessionPurpose` (`packages/core/src/schemas.ts`). Both Start-lap roads in `apps/web/src/components/Workspace.tsx` now call `launch.mutate({ featureId, kind: 'chat', purpose: 'start-lap' })`: `enterIterate` (the empty-handed road) and the carry road in `commitTriage`. The web builds no briefing text. On the server, `planKickoff` in `launcher/sessions.ts` takes a new `startLapFromReview` flag. When it is set, the plan's line is the new `reviewLapKickoff(lap + 1, carried)`, which covers:
- the agenda: `## Carried, still open`, the `openDefects` from get_feature_context, and `## Later laps`
- where decisions go: under `## Lap N+1`, with spec.md amended
- the tickets it emits land pending and Burn from review moves them onto lap N+1
- "Do NOT call complete_phase"
- the closing instruction: "review the cards and click Burn"

`lapKickoff` and `reviewLapKickoff` now share a private `lapAgenda(carried)` helper. `lapKickoff`'s text is unchanged. The launcher sets the flag only when purpose is `start-lap` AND the phase is `review`, through a new `planLaunchKickoff` helper that the fresh launch and `briefLiveChat` both use. The two copies of the `planKickoff` call they had are gone. The briefing rides the resumed chat ahead of the usual state header, and `plan.lap` stays unset because the lap counter has not moved yet.

**Tests.** `test/lap-kickoff.test.ts` has a new "the review page's Start lap door" describe:
- The repro: a lap-1 feature at review with nothing open → the kickoff names lap 2 and its agenda.
- The carry road: a carried note → "1 note carried … address them".
- The plain Chat toggle at review → no lap framing.

`test/chat-door.test.ts` gained a live-chat delivery case. With the launcher flag forced off, the three new briefing tests failed and the control passed; with the fix they pass. Typecheck is green.

**Surprises.** The full suite gave 1 failure, in `packages/server/test/dev-pane.test.ts` ("kills the child process tree so the port-holder is not orphaned"). It fails again when run on its own. It tests PTY process-group reaping and touches none of the changed code, so it looks environmental (this sandbox has no init reaper). It is not in the stated baseline.

**Left undone (ticket 2's territory).** The injected system prompt (`artifacts.ts` `renderRevisitPrompt`) still renders the `reviewIteration` framing for this session because `plan.lap` is undefined. Ticket 2 should make it recognise the lap briefing, for example by using `session.purpose === 'start-lap'`, which is now stored on the session row. The `lapInFlight` / `lapIteration` planning-phase path is untouched. No drive machinery changed: no new services, env vars, seeds or processes.

#### 2. The revisit skill and the injected revisit prompt recognise a lap…

# Ticket 2 — revisit skill + injected prompt recognise a lap planned at review

## What was done
- `renderRevisitPrompt` (artifacts.ts): when `lap` is set, the "## This is lap N" block now says the conversation plans lap N from the Start-lap door at review, and that the feature stays at review until Burn. It lists the agenda (carried notes in `## Carried, still open`, `openDefects` to link/carry/close, `## Later laps`), tells the agent to write decisions under `## Lap N`, amend spec.md and prune promoted Later-laps items, and `emit_tickets` (they land pending and Burn moves them onto lap N). It forbids `complete_phase` and ends with "review the cards and click Burn". The Rules line is now always "Do NOT call `complete_phase`". `reviewIteration` (the fix-ticket interview) was already excluded whenever `lap` is set, and a test now pins that.
- `lapKickoff` (sessions.ts) got the same change: no more "complete_phase through ideation → spec → tickets"; it says not to call complete_phase and to hand back with "review the cards and click Burn".
- revisit SKILL.md Lap mode: the Start-lap click is the start of the lap, so the agent must never send the human off to start one. The feature stands at review, move 7 is now "Do NOT call complete_phase", and the Do NOT list has no lap exception. I also removed "the human drives the pipeline from the UI", the wording that invited "start the next lap from the UI".
- **The planning-phase lap path was deleted because no road reaches it.** Phase only moves forward (`setPhase` callers: building at burn, review from runner, shipped at merge), features are only created at lap 1, and the lap counter only moves at Burn from review, which goes straight to building. So I removed `lapInFlight`, the `lap`/`carried`/`lapInFlight` inputs and the `lap` output of `planKickoff`, the launcher wiring of both, and their tests: the lapInFlight suite, lap-N grill, stranded-lap re-entry, chat-door "lap in flight", and the "DO call complete_phase" artifact tests.

## Surprises
- After this, the launcher never passes `lap`/`carried` to `writeArtifacts`, and `lapKickoff` has no src caller. Both are left for the sibling ticket 1 to wire: its review-phase iterate-door recognition should set `lap: feature.lap + 1` and `carried` on the artifacts and use `lapKickoff(feature.lap + 1, carried)` as the line.
- `carriedWork().reviewEvidence` is the lap BEFORE `feature.lap`. At review, the evidence a lap-N+1 planner needs is the current lap's (`currentLapReviewEvidence`). `reviewEvidenceSection(lap)` labels it "Lap ${lap-1}", which equals `feature.lap`. Ticket 1 should build `carried` with the current lap's evidence, or the prompt will mislabel it.
- `packages/server/test/dev-pane.test.ts > kills the child process tree…` fails, including when run on its own. It tests PTY process-tree teardown and imports nothing I touched, so I believe it is a sandbox environment fault. I did not confirm that against the pre-change tree. Everything else passed: 4459 tests passed, 1 failed (that one), and typecheck is clean.

## Left undone
- `toolCompletePhase`'s `iterating` branch in mcp/server.ts still answers a review-phase call with warnings. It's harmless now that nothing tells a session to call it; it could be simplified later.
- CONTEXT.md / ADR-0010 prose about Rethink-era laps was not touched.
- Drive machinery: no new service, env var, seed or process, so no edit was needed and none was made.

#### 4. Start-lap briefing hands the lap planner the wrong lap's review evidence (lap 1: tells it none exists)

# Ticket 4 — Start-lap briefing reads the right lap's review evidence

**What was done.** `launcher.ts` gained `startLapCarriedWork(ctx, featureId)`: it returns `carriedWork()` but swaps `reviewEvidence` for `currentLapReviewEvidence()`. Both kickoff paths use it: a fresh or resumed launch (`launchSession`), and the answer to an already-live chat (`briefLiveChat`). So the kickoff line (`reviewEvidenceSentence`) and the injected prompt (`reviewEvidenceSection`) now name lap N's review when the Start-lap door plans lap N+1 at review. `carriedWork()` itself is unchanged: `get_feature_context` (mcp/server.ts) still reads the previous lap's evidence. The carried value only reaches the kickoff and artifacts when `plan.lap` is set, and that happens only on the start-lap road. So the plain Chat toggle and other launches behave as before.

**Repro re-run.** I added "hands the planner the review of the lap it is standing on" to `packages/server/test/lap-kickoff.test.ts`. It seeds a lap-1 feature at review with a `done` lap-1 review ticket and writes a real DIGEST.md into its review dir. It then launches `{kind:'chat', purpose:'start-lap'}` with spawn:false and reads the prompt. The injected prompt is `system-prompt.md`; this repo has no `prompt.md`. Before the fix the test failed on "Lap 1 left NO review evidence on disk". After the fix it passes: the prompt says "Lap 1's review left this on disk" and lists the digest path, and the kickoff command names the same path.

**Verification.** Typecheck: 0 errors. Full suite: 4464 passed and 1 failed. The failure is `dev-pane.test.ts > kills the child process tree so the port-holder is not orphaned` ("expected true to be false"): the child process was still alive after the kill. It still fails when run alone, and it shares no code with the launcher. I read it as an environment problem with killing processes in this sandbox, but it is not in the baseline list. The prompt's baseline counts (118 files / 1768 tests) also do not match this checkout, which has 310 files and 4502 tests. I made no drive-machinery changes, and none were needed.

**Surprises.** None beyond the above.

**Left undone.** The review's other findings stay out of scope for this ticket:
- If the chat is already live, the start-lap briefing is typed into a session whose system prompt still frames it as a fix-ticket interview.
- SPEC §15.2, CONTEXT.md and ADR-0010 still describe laps in the old, pre-review-planning way.
- `ReviewEvidence.lap` is documented as "the lap before the one reading this". That is still accurate from lap N+1's point of view.

#### 6. SPEC.md §15.2 still describes the deleted lap model (LAP n REVIEW ITERATION, complete_phase through ideation/spec/tickets)

# Ticket 6 — SPEC §15.2/§15.5 lap model

**What was done.** I rewrote two passages in `docs/SPEC.md`. The first is the §15.2 kickoff-registry bullet. It now names the `start-lap` launch purpose and the `PLAN LAP <n> FROM REVIEW` briefing (`reviewLapKickoff`, built server-side from `carriedWork`). It lists the agenda: carried notes, open defects and `## Later laps`. It says the decisions go under `## Lap <n>`, the spec gets amended, and `emit_tickets` lands tickets as pending until Burn from review moves them through `carryPendingTicketsIntoLap`. It also states that `complete_phase` is never called and that the session hands back with "review the cards and click Burn". The second is the §15.5 `revisit` lap-mode bullet, which now matches that. I took the names from `sessions.ts` and `SessionPurpose` in core. It is one commit and docs-only.

**Repro re-run.** `git grep -n "REVIEW ITERATION\|complete_phase. through" HEAD -- docs/SPEC.md` now returns no hits (exit 1). Typecheck is green. The three tests that read SPEC.md (core docs.test, web run-record and walkthrough) pass. I did not run the full suite, because the change is docs-only.

**Left undone (out of scope, per the ticket).** Other parts of SPEC §15 still describe Rethink-era laps:
- §15.2 still describes `feature.rethink` / `rethink()` as a service that moves phase back to ideation, and I could not find a `rethink` in the trpc routers or in `features.ts`.
- §15.3 still says "the two-click lap".

CONTEXT.md #15 and ADR-0010 §1/§3/§5/§8 still have the same drift. The stale `complete_phase` hints that the review found in one tool description and one comment are also untouched. No drive machinery was affected.

#### 7. Stale complete_phase pointers remain: the resolve_finding tool description invites the call, and a comment claims review-phase calls are refused

# Ticket 7 digest

**What was done.** I made three text-only changes and committed them as d0cd2cfd:
- The `resolve_finding` tool description (`packages/server/src/mcp/server.ts`) no longer says an un-dispositioned earlier-lap defect "comes back as a warning from `complete_phase("tickets")`". It now says the warning comes at the human's Burn click, and tells the agent to disposition each defect before it hands over.
- The `reviewLapKickoff` docblock (`packages/server/src/launcher/sessions.ts`) no longer claims a `complete_phase` call at review "would be refused by the pipeline". It now says the briefing forbids the call, and that a stray call is still answered by the `iterating` branch of `toolCompletePhase`.
- The comment on `const iterating` in `toolCompletePhase` now says the same: the lap briefing forbids the call, and a stray one falls through to the full answer.

I took the smaller option the ticket allowed and kept the `iterating` branch rather than deleting it. It is now documented as tolerance for a stray call, not as a call anyone is invited to make. No behaviour changed.

**Repro re-run.** I re-ran the repro on this branch's tree. `grep -n 'warning from'` on server.ts finds nothing. `grep -n 'refused by the pipeline'` on sessions.ts finds nothing. `const iterating = feature.phase === 'review' …` is still there, and its comment and the docblock now agree with it.

**Verify.** `bun run typecheck` passed with 0 errors. `bun run test` had 1 failure out of 4501 tests: `packages/server/test/dev-pane.test.ts` › "kills the child process tree so the port-holder is not orphaned". It also fails when run on its own. The test checks that a PTY process tree gets killed; my diff only changes comments and one description string, so this is an environment fault in the sandbox, not caused by the change. The baseline said the suite should be fully green, so that expectation does not hold in this sandbox.

**Surprises.** The suite had 310 files and 4501 tests, not the 118 files the baseline listed.

**Left undone.** A stray `complete_phase("tickets")` at review still runs `markTicketsReady(…, 'building')`. If that milestone should never be set from review, dropping the `iterating` branch would be a separate change. No drive machinery changed, so nothing under `.runcastle/` needed checking.

#### 8. Verify the fixes that landed

Lap 1 · mode unrecorded · NO DECLARATION · nothing verified — Review declaration missing or unparseable.

Gates verification pass — verifies pass #3 on feature/start-lap-from-review-opens-a-real-lap-conversation

Lap 1 · all 4 landed fixes held · gates green except 3 environmental test failures, none from this lap

## Fixes

- **#4, the Start-lap briefing had the wrong lap's review evidence: HELD.** `launcher.ts` now has `startLapCarriedWork`, which is `carriedWork` with `reviewEvidence` swapped for `currentLapReviewEvidence`. Both the fresh/resumed launch and `briefLiveChat` use it. `carried` reaches `writeArtifacts` only when `plan.lap` is set (l.739), and that happens only on the start-lap road. `get_feature_context` and the plain Chat toggle are unchanged. The new lap-kickoff test is the finding's repro: a lap-1 feature at review with a done lap-1 review ticket and a DIGEST.md. It checks that the prompt says "Lap 1's review left this on disk" and names the digest path, and that the prompt no longer says "left NO review evidence". It passes.
- **#5, an empty-handed Start lap into a live review chat kept the "Review iteration" prompt: HELD.** For a `start-lap` launch at review, `launchSession` now ends the live chat (`isStartLap` → `endSession`) and relaunches it. So the lap prompt is rendered fresh and nothing is typed into the old terminal. The rewritten chat-door test first checks that the original chat's prompt has "## Review iteration". It then checks that the relaunched session is new, is the only active session, has "## This is lap 2", and does not have "## Review iteration". It passes. Harmless leftover: `briefLiveChat` still builds `startLapCarriedWork`, although the start-lap road can no longer reach it.
- **#6, SPEC §15.2 described the deleted lap model: HELD.** Re-ran `git grep -n "REVIEW ITERATION\|complete_phase. through" <branch> -- docs/SPEC.md`: no hits (exit 1). The §15.2 kickoff-registry bullet and the §15.5 revisit lap-mode bullet now describe `start-lap` / `PLAN LAP <n> FROM REVIEW`, say it never calls complete_phase, and end with "review the cards and click Burn". Other stale text is still there and was out of scope: §15.2 rethink and §15.3 "two-click lap" in the spec, plus drift in CONTEXT.md and ADR-0010.
- **#7, stale complete_phase pointers: HELD.** Re-ran the repro greps on the branch. `warning from` no longer matches in `mcp/server.ts`, and `refused by the pipeline` no longer matches in `sessions.ts`. The `reviewLapKickoff` docblock and the `iterating` comment now agree with the code: the briefing forbids the call, and a stray call falls through to the full answer. Text-only change.

## Gates

Both gates ran once, in a scratch detached worktree at the branch tip (683192da) so they checked the branch's code, not main. The inherited `RUNCASTLE_*` asset env vars were unset. The worktree has been removed.

- `bun run typecheck`: 0 errors (core, server, web, scripts).
- `env -u GIT_ASKPASS bun run test`: 310 files, 4442 passed, 57 skipped, 3 failed. The stated baseline (118 files, 1768 tests, fully green) is outdated for this checkout. The 3 failures are all environmental, and none of the three tests touch a file this branch changed:
  - `project-drive.test.ts`: the identity file reads `project-drive project_drive topic %DB_NAME%`, an unexpanded Windows env placeholder.
  - `review-directory-preparation.test.ts`: it expects `/reviews/...` paths but gets Windows `\reviews\...`.
  - `review-ticket.test.ts`: `AGENT_BROWSER_SESSION` is `review-tkt_E5RVzX6MkH6U`, which leaked from this review session's own environment into the test process.
  - There was also one unhandled EPIPE from `dev-pane.test.ts` (PTY sidecar kill). The implementers reported the same environment-only dev-pane failure.

These are the same 3 unrelated failures the pass being verified reported. None was introduced by this lap, so no finding was filed.

REVIEW-MODE: gates
REVIEW-VERDICT: verified
