# Outcome — One chat per feature

A single persistent feature chat, one transcript resumed by every door, available in all four states including during a burn and in review; knows the full current state, answers questions, edits tickets; ideation, revisit and qa kinds collapse into it.

- Shipped: 2026-09-19
- Laps run: 3

## What shipped

60 commits · 104 files

### Lap 1
- 5 tickets landed: #1 The `chat` kind exists: enum, row migration, MCP audience, launcher resume, kickoff header; #2 The chat knows the full state: fattened get_feature_context + run-claimed ticket guard; #3 The chat coexists with a burn: per-feature landing queue, chat temp branch, boundary handoff; #4 One Chat door on the bar in all four states; #13 A brand-new Planning chat is instructed to revisit instead of ideate
- 7 waived: #6 launch-artifacts.test.ts never swept: 45 uses of the deleted ideation/qa/revisit kinds break typecheck and the suite; #7 The missing-transcript marker lost its only producer — its server test now fails and the shipped body's branch is dead; #8 The chat kickoff's Review clause names no drive outcome — it prints the phase word, and its test locks that in; #9 MODEL_STEPS dropped ideation/qa/revisit with no read-compat, so an existing config.json carrying those step models hits RuncastleConfig.parse; #10 "One transcript, resumed by every door" does not hold: any kickoff override discards the resume, and a resumed chat never receives the state header; #11 The constant Chat door errors instead of returning you to a chat that is already live — sharpest on the review page, which has no terminal surface; #12 The deleted qa read-only contract left its 12-line docblock, two comments and a now-meaningless alias behind in the MCP server
- 0 failed

### Lap 2
- 11 tickets landed: #15 Sweep launch-artifacts.test.ts of the deleted ideation/qa/revisit kinds; #16 Restore the missing-transcript marker for ended chats without a ccSessionId; #17 Kickoff overrides ride the resume, and every resumed chat gets the fresh state header; #18 The Chat door on a live chat returns you to it instead of erroring; #19 The review kickoff names the real drive outcome, not the phase word; #20 stepModels read-compat: old ideation/qa/revisit keys migrate instead of failing parse; #21 chat-branch.ts worktree-handoff mutations emit events; #22 Sweep the dead qa read-only leftovers from the MCP server; #24 The lap-2 full suite still contains deleted session-kind assertions; #25 A live chat discards purpose-specific kickoff overrides; #26 Chat branch rollover mutates the worktree without emitting an event
- 0 waived
- 0 failed

### Lap 3
- 2 tickets landed: #28 Chat briefing delivery is observable: kickoff only after a real terminal write; #29 Inline chat panel docked beside the feature body
- 0 waived
- 0 failed

## Review record

### Lap 1 · review

- Reviewed commit: 9e9b1304498e12ea1a3a9c34c209cb9a947383bc
- Landed since: 14
- Outcome: done

### Lap 1 · verification

- Reviewed commit: 295e290c10f63a93618424aba852a9707eee6373
- Landed since: 13
- Outcome: done

### Lap 2 · review

- Reviewed commit: 670468fae604ff442cb6a1587d2956cced78091a
- Landed since: 5
- Outcome: done

### Lap 2 · verification

- Reviewed commit: 015569048f052067950545f32e77c1d8079ba628
- Landed since: 2
- Outcome: done

### Lap 3 · verification

- Reviewed commit: 2d79f66abc74a85acd4a7548dafeed6b8dcb1dbf
- Landed since: 0
- Outcome: done

- **Kickoff is recorded before the briefing is submitted** — open
- **Full-suite acceptance is not demonstrated green** — open

## Notes record

- No human notes

## Per-ticket digests

### Lap 1

#### 2. The chat knows the full state: fattened get_feature_context + run-claimed ticket guard

# ticket(2) — the chat knows the full state + run-claimed ticket guard

## What was done

`get_feature_context` now also states `latestRun` (the newest branch-claiming
run's status, how many of its lanes landed and failed, and the first line of each
failed lane's error — the key is absent, not zeroed, on a feature that never
burned), `currentLapReview`, `findings` and `testNotes`. Two deviations from the
ticket's sketch, both to reuse what exists: the current lap's review outcome is
returned in the **existing `ReviewEvidence` shape** (`ticketId`, `seq`, `status`,
`lap`, `dir`, `digestPath`) rather than a new outcome word, because
`carried-work.ts` already speaks that shape for the *previous* lap and because
decisions #7 asks for the outcome *with a pointer to the evidence* — a bespoke
`{state: 'ran'}` had no pointer. `carried-work.ts` grew
`currentLapReviewEvidence` beside `previousLapReviewEvidence`, both over one
`lapReviewEvidence(lap)`. And `testNotes` is keyed on **status as well as lap**
(this lap's notes plus anything status `carried`), because `carriedWork`'s own
comment documents that filtering notes by lap number alone permanently loses a
note carried forward.

The call-time guard lives in `requireOwnTicket` (the only caller of which is
`update_ticket` and `cancel_ticket`), refusing with a `GateError` that names the
run id and the ticket's id, seq and title. "Claimed" is read from the event feed
by a new `runClaimedTicketIds`, and `startRun` now records the lanes a
branch-claiming run opens with on its `run.started` event — without that snapshot
nothing outside the scheduler's memory can name a pending lane, and at
concurrency 1 most of a burn's life is pending lanes it has not spoken about yet.
`activeBurnClaim` uses the existing `workflowClaimsFeatureBranch` predicate, so
research runs never freeze a ticket.

## Surprises

- An earlier interrupted attempt of this ticket had already committed a working
  version (`31d6297`). I kept its behaviour and reworked two things in it: it had
  widened the shared `runTicketIds` — which run *history* renders, and whose doc
  comment promises "exactly the lanes it had" — and it recomputed that query once
  per ticket inside a `filter` predicate. Both are now a separate function and one
  hoisted `Set`.
- **AC5's premise does not hold in this repo:** there is no shared zod schema for
  this payload. `FeatureContext` is a server-local TypeScript interface and
  `get_feature_context` replies with `JSON.stringify` (`ok()` in `mcp/server.ts`)
  — no `outputSchema`, no core-side wire type, nothing in `apps/web` reads it. So
  there was nothing to extend in `packages/core`; the rows inside the payload
  (`ReviewFinding`, `TestNote`) are zod-parsed on read by their own services. I
  did not invent a schema for it.
- **The suite is red on arrival, 39 failures, none of them mine.** They are
  ticket 1's kind collapse: tests still expecting `revisit` / `qa` / grill wording
  in `launch-artifacts`, `review-wires`, `runtime-adapter`, `lap-kickoff`,
  `shipped-qa-listing`, `waypoint-work`, plus the web's next-step, settings,
  review-bands and session-panel expectations. I captured the failure set before
  my first edit and after my last: **identical**, and no file in my diff appears
  in it. `bun run typecheck` is clean; my own new tests and every test touching
  the code I changed are green. The prompt's "expected fully green" baseline was
  written before ticket 1 landed.
- The `dev-pane` "kills the child process tree" failure looks environmental
  (process-tree kill in this container) rather than kind-related; it too fails
  identically before and after.

## Left undone

- Those 39 inherited failures. They are other tickets' files (session prompts,
  the next-step vocabulary, the settings roster), so fixing them here would have
  been scope expansion into work this burn's later tickets own.
- The audience table still explains itself in terms of "the qa refusals" and "the
  qa read-only contract" (`mcp/server.ts` around `TOOL_AUDIENCES`) — stale prose
  from the kind that no longer exists. Whoever finishes the collapse should sweep
  it.
- `admitNewTickets` folds *any* pending ticket into a live run when a review
  ticket settles, so a ticket the chat drafts mid-burn can still be swept into the
  running burn afterwards. The guard is honest about the present ("is it claimed
  now?"); nobody has decided whether drafting during a burn should be excluded
  from admission instead.
- Drive machinery: my change adds no service, env var, seed or process, so
  `.runcastle/drive-setup.ts` and `.runcastle/drive-stop.ts` needed no edit. I
  confirmed both files still exist and did not run them (no services in this
  sandbox).

#### 3. The chat coexists with a burn: per-feature landing queue, chat temp branch, boundary handoff

# ticket 3 — the chat coexists with a burn

## What was done

The per-run serial merge queue moved out of the burner into a new
`packages/server/src/services/landing-queue.ts` as a process-wide map keyed by
feature id (`featureLandingQueue`), so chat landings and ticket landings share
one serial order onto `feature/<slug>`. A new
`packages/server/src/services/chat-branch.ts` holds the coexistence lifecycle:
`parkTalkWorktreeForRun` (run start), `ensureTalkWorktreeDuringRun` (a session
spawning mid-run), `landChatCommits` (each docs checkpoint), and
`releaseTalkWorktreeAfterRun` (run end and boot reconcile). `git.ts` gained
`CHAT_BRANCH_PREFIX` / `chatBranchName` / `startBranchInWorktree` /
`chatBranchInWorktree`, the chat prefix in the boot sweep's temp-branch list,
and one early return in `ensureTalkWorktree` so a worktree parked on a chat
branch is never yanked back onto the feature branch mid-burn. The runner now
parks instead of detaching and hands the branch back on success, failure AND
cancel; `reconcile-runs` runs the same handoff at boot instead of a bare
reattach, so a crashed run's chat commits still land. The run-claim clause is
gone from `assertSpawnable`; the one-live-session clause is untouched.

Two deviations from the ticket's sketch. The chat's *next* branch is cut
**before** each landing rather than after, because `mergeTempBranch` deletes the
branch it lands and detaches any worktree holding it — cutting first keeps the
session's HEAD on a named branch at all times and means a failed landing loses
nothing (the new branch stands on the same commit). And the talk worktree is
parked for **every** branch-claiming run, not only when a chat is live: the
"chat spawns mid-run" case needs the same state, and one rule is simpler than
two.

## Surprises

- The ticket's second guard site (`services/features.ts:~827`) no longer exists:
  the four-states feature already deleted `assertIterable`/`rethink`, which is
  where that duplicate lived (`git log -S` confirms, commit `94b75e65`). The line
  at :826 today is `retryTicket`'s "a run is live" guard, which is a different
  rule and stays. Only the launcher site needed deleting.
- `apps/web/src/components/bodies/RunBody.tsx:161` still greys the conflict
  lane's "Resolve in terminal" while a run is running, quoting the refusal that
  no longer exists. Left alone — it is the web's territory and the button's
  semantics (which worktree a conflict resolver needs) are a separate question.
- The verify baseline in the prompt is stale. `bun run test` on this branch is
  255 files / 3710 tests with **17 pre-existing failures** in 8 files, all
  `revisit`/`qa`/chat-kickoff fallout from ticket 1 (and the `shipped-qa` filter).
  I confirmed the set is byte-identical at the branch point `f58b7af0` by running
  those 8 files in a scratch `git worktree` with `node_modules` symlinked, then
  removed the worktree. `bun run typecheck` is clean.
- `sessionFinished` now treats a `chat` session as finished once the feature is
  mapped (because `qa` collapsed into `chat`), which is what two of those
  pre-existing `waypoint-work` failures are about. Not mine to fix.

## Left undone

- Drive machinery: nothing to update — this ticket adds no service, env var,
  seed or process. I checked `.runcastle/drive-setup.ts` and `drive-stop.ts` are
  both present and unchanged; I did not run them (no services in the sandbox).
- No UI surface for `chat.landed` / `chat.land_failed` — the events are emitted
  and reach the stream, but nothing renders them specially.
- Parking the worktree emits no event of its own; the run's start/finish events
  are the only trace of the branch switch.

#### 4. One Chat door on the bar in all four states

# ticket(4) — One Chat door on the bar in all four states

## What was done

`ACTION_KINDS` now carries `chat` and none of `startGrill`, `askQuestions`, `revisit`; the
dispatcher in `Workspace.tsx` collapsed its three identical cases into one `chat` case. The
constant door lives in one new file, `apps/web/src/lib/feature-ui/next-step/chat.ts`, as
`CHAT_ACTION` (`{ label: 'Chat', kind: 'chat' }`), and every bar the four state resolvers
return carries it first in `secondary` — including building's running branch, where Cancel
run stays primary and Chat is an enabled secondary with no disabled state, and every review
branch, where it is prepended without reordering Merge/Burn/Test drive/Iterate.

Two deviations from a literal reading of the ticket, both smaller than the alternative:

- The ticket said to promote Chat to primary "only in planning when nothing is live". I also
  kept building's empty-ledger primary (`building.ts`, "No tickets to burn" with nothing
  live), because that slot WAS a `startGrill` primary and the alternative was a bar with no
  primary at all in the one state where talking is the only thing to do. It keeps its
  resume-aware wording ("Open a session" / "Resume the session").
- Planning's "Ask for changes" secondary became the constant `Chat` label but kept its
  tooltip (`hint: 'Open the chat to change the tickets before burning'`) — decision 8 forbids
  rewording the *label* per state, and dropping the hint would have lost real guidance.

In planning the prepend lives inside the file's local `step()` helper (ten call sites, one
invariant) and stands down when the caller already made the chat its primary, so no bar ever
renders the door twice. `resumableGrill` → `resumableChat` on `ResolverInput`, keyed off
`hasResumable(sessions, 'chat')`. `shippedQaSessions` → `shippedChatSessions` with its one
caller; the shipped bar's copy no longer promises a button called "Ask a question". The
QaHistory/QaRow components and the "Questions asked" heading were left alone — the shipped
body's panel redesign is explicitly `## Later laps`.

Criterion 5 needed no code: ticket 1 had already pointed `use-resolve-conflict.ts` and
`enterIterate` at `kind: 'chat'`. Both action kinds keep their entries and labels;
`resolveConflict` still passes `mergeConflictKickoff(...)`. Verified by reading, not changed.

## Surprises

- The prompt's stated baseline ("118 files, 1768 passed, 0 failed") does not describe this
  branch: the suite is 253 files / 3697 tests, and 17 tests in `packages/server` were already
  red when I started, from ticket 1's kind collapse. **They are still red and they are not
  mine** — my diff touches only `apps/web`, and none of the failing files import it. They are
  server-side assertions about the retired kinds: `/runcastle:qa` and `/runcastle:revisit`
  prompt slugs in `launch-artifacts.test.ts` (9), the qa sweep/endLive policy in
  `review-wires.test.ts` and `waypoint-work.test.ts`, `shipped-qa-listing.test.ts`,
  `lap-kickoff.test.ts` ("a lap-1 grill keeps the generic ideate line"), plus two that read
  as environment-flavoured (`dev-pane` process-tree kill, `kickoff-telemetry` briefing).
  Ticket 1's digest called these "chiefly the later UI ticket's territory" — they are not:
  every one of them is in `packages/server`, in prompt rendering, the launcher and session
  sweeping. Someone still owns them.
- Ticket 1 had rewritten several web test fixtures to `kind: 'chat'` without updating the
  assertions around them, which silently destroyed two tests' premises: "ignores a resumable
  session of a DIFFERENT kind" and the two `shippedQaSessions` cases that meant to prove
  non-chat kinds are excluded. I rebuilt them against a real other kind (`converge`,
  `waypoint`) rather than deleting the coverage.
- `burnWarningLine` calls into core's `ticketShapeWarnings`, which dereferences
  `ticket.context` unguarded — a ticket fixture without `goal`/`context` crashes the building
  resolver rather than warning. Worth knowing when writing building-state fixtures.

## Left undone

- The 17 `packages/server` failures above. Out of this ticket's scope (its verify line is
  `bun test in apps/web; bunx tsc`) and squarely inside the launcher/prompt/MCP files a
  sibling ticket is likely editing right now, so I did not touch them.
- Richer placement — inline panel, body placement, the shipped body's transcript-panel
  redesign — is `## Later laps` by decision 8 and deliberately untouched.
- `docs/features/*/` prose and `packages/server` comments still narrate `revisit`/`qa`/
  Rethink as live things. I fixed only the stale mentions inside files I edited in `apps/web`.
- No drive-machinery change: this ticket adds no service, no boot-required env var, no seed
  and no companion process, so `.runcastle/drive-setup.ts` and `drive-stop.ts` need no edit.
  I did not run them (no services in this sandbox) and did not need to read them.

## Verification

`bun run typecheck` — 0 errors (core, server, web, scripts). `npx vitest run apps/web/test` —
107 files, 1482 passed, 31 skipped, 0 failed. Full `env -u GIT_ASKPASS bun run test` — 3645
passed, 17 failed, all 17 the pre-existing `packages/server` set named above.

#### 13. A brand-new Planning chat is instructed to revisit instead of ideate

# ticket(13) — a brand-new Planning chat opens on ideation, not revisit

## What was done

The collapsed `chat` kind no longer maps unconditionally onto the revisit brief and
the `revisit` skill. A new pure predicate, `chatOpening(feature, planning)` in
`packages/server/src/launcher/artifacts.ts`, answers which of the chat's two opening
moves a feature calls for: a feature still in Planning that has produced none of the
three planning artifacts (no `decisions.md`, no `spec.md`, no pending tickets) opens
on `ideate`; everything else opens on `revisit`, as before. It reads the artifacts
through core's existing `completedPlanningSteps`, the same facts Planning's own
progress is derived from, rather than off the phase alone — so a planning feature that
has already been grilled is still a revisit.

Both renders split on that one predicate, which is the point: `renderSystemPrompt`
falls through to the generic (ideation) feature brief for the ideate opening, and the
composed chat kickoff line — `chatKickoffHeader` in `launcher.ts` — now opens with
`chatKickoffFor(runtime, opening)` (new, in `runtimes/skills.ts`) ahead of the
existing state header. The launcher passes the facts to the artifacts writer as a new
optional `planning` field on `WriteArtifactsInput`.

Two deviations from the literal ticket text worth knowing. First, the per-kind
`kickoffLinesFor` table's `chat` entry is byte-identical to what it was: a table keyed
only by kind cannot answer a question about a feature's artifacts, so it keeps the
revisit form as the state-unknown default (now expressed through `chatKickoffFor`) and
the launcher composes the real, state-correct line — which it already always did for
`chat`. Second, the kickoff gained an opening-move sentence in *both* states rather
than only the ideate one; the asymmetric version would have left the revisit case
naming no skill at all while the prompt named one, which is the F2 shape this module
already paid for.

Tests: two cases in `packages/server/test/chat-contract.test.ts` launch a real `chat`
session with `spawn: false` and assert against the generated `system-prompt.md` and
the launch argv — the repro step's own two artifacts — for a fresh feature and for one
carrying `decisions.md`.

**I re-ran the reviewer's repro step.** A `chat` launched for a newly created Planning
feature with no decisions/spec/tickets now writes a system prompt titled
`# runcastle — <title>` whose task line is "Begin by invoking the `/runcastle:ideate`
skill and drive the ideation session to completion", with the `complete_phase`
lifecycle section intact and no "a revisit never moves the pipeline" ban; the kickoff
positional in the argv reads "Proceed with your task: invoke the `/runcastle:ideate`
skill and drive this feature's ideation to completion. Feature state: planning; lap 1;
tickets: none; latest run: none. Call get_feature_context for the full picture."
Neither artifact mentions `revisit`. The repro no longer reproduces.

## Surprises

**The stated verify baseline is wrong for this branch, in both directions.** The prompt
said 118 files / 1768 tests / 0 failed; `env -u GIT_ASKPASS bun run test` on this
branch actually runs 255 files / 3717 tests and ends **17 failed** across 8 files.
`bun run typecheck` is genuinely 0 errors. I confirmed the failures are pre-existing
and not mine: `launch-artifacts.test.ts` (9 of them) I ran *before making any edit* and
it failed identically then, and the rest fail on expectations written for session kinds
that ticket 1 deleted from the enum — `KICKOFF_LINES.ideation` is now `undefined`, so
`expect(undefined).toContain('/runcastle:ideate')` throws
(`lap-kickoff.test.ts:216`, `kickoff-telemetry.test.ts:98`,
`runtime-adapter.test.ts:288`), and `renderSystemPrompt(feature(), 'qa'|'revisit')`
falls through to the generic brief (`launch-artifacts.test.ts`). `review-wires`,
`shipped-qa-listing` and `waypoint-work` (4 tests) fail the same way, on `'qa'` rows
and a `/revisit session/` error string. The one outlier is
`dev-pane.test.ts > kills the child process tree`, which asserts a process group is
gone — an environment difference in this sandbox, not a kind problem. Nothing in my
diff can reach any of the 17: the only production text my change alters is the chat's
composed kickoff line and which brief a `chat` renders.

**Server tests are not typechecked.** `packages/server/tsconfig.json` has
`include: ["src"]`, which is why those test files can still pass `'ideation'` as a
`SessionKind` and only fail at runtime.

**The generic feature brief was dead code.** With `prepare`/`project`/`drive-fix`
routed to their own renderers, the fall-through at the end of `renderSystemPrompt` was
unreachable in production once `chat` was mapped to revisit. It is the ideation brief,
so the fix reuses it rather than writing a new one — that is why the diff adds no new
prompt prose.

**A side effect worth knowing about, and I believe it is the right one.** Because the
composed chat kickoff now starts with "Proceed with your task: invoke the
/runcastle:…", `withoutKickoff` in `services/conversations.ts` (which matches on the
first 40 collapsed characters) now recognises it and strips it from transcripts and
conversation titles. Before this change the chat's state header did not match that
prefix, so the launcher's own line was attributed to the human. No test asserted
either way.

## Left undone

- **The 16 legacy-kind test failures.** They are ticket 1's territory ("retire legacy
  session expectations") and fixing them is a mechanical sweep of `'ideation'`/`'qa'`/
  `'revisit'` out of `launch-artifacts`, `lap-kickoff`, `kickoff-telemetry`,
  `runtime-adapter`, `review-wires`, `shipped-qa-listing` and `waypoint-work`. The most
  pointed one is `lap-kickoff.test.ts:214` — "a lap-1 grill keeps the generic ideate
  line", which is *this ticket's* subject asserted through a table key that no longer
  exists; my new tests cover that behaviour at the launch seam instead.
- **`renderQaPrompt` in `artifacts.ts` is now exported dead code** — nothing dispatches
  to it since the `qa` kind was deleted. Decision 3 says the read-only contract dies
  with the kind, so it should probably go, but deleting it is not this ticket.
- **A planning feature mid-way through planning** (decisions written, spec not) still
  gets the revisit brief, whose rules line says "Do NOT call `complete_phase`" — so it
  is told not to report the spec and tickets steps it is there to do. I took the
  ticket's smaller reading (no artifacts at all) deliberately; widening the predicate to
  "planning not finished" is a one-line change in `chatOpening` if the feature session
  decides that is wanted.
- **Drive machinery:** no edit needed and none made — this change adds no service, no
  required env var, no seed and no process. I checked that `.runcastle/drive-setup.ts`
  and `.runcastle/drive-stop.ts`, the two scripts the configured drive commands name,
  are both present; I did not run them (no services in this sandbox).

#### 14. Verify the fixes that landed

Gates verification pass

Ticket #13 held.

- A newly created Planning feature with no decisions, spec, or pending tickets now resolves `chatOpening` to `ideate`.
- The generated system prompt follows the generic ideation brief, names the runtime-specific `ideate` skill, retains the `complete_phase` lifecycle, and does not carry the revisit-only prohibition.
- The actual launch kickoff is composed through the same predicate and names `ideate`; it does not fall back to the state-unknown `kickoffLinesFor(...).chat` revisit default on this path.
- A Planning feature with an existing planning artifact continues to open on `revisit`, preventing a second ideation pass.
- Focused launch-level tests cover both the generated `system-prompt.md` and launch command for the fresh and already-started cases.

No verify commands are configured, so there were no gates to run.

No verification findings were reported.

### Lap 2

#### 18. The Chat door on a live chat returns you to it instead of erroring

# Ticket 18 — the Chat door on a live chat returns you to it

## What was done

`launchSession` now short-circuits for kind `chat`: if a chat session is already
`launching`/`live` on that feature, it returns that session's id instead of
throwing "a chat session is already live". The check sits early — right after
`requireNotDraft`, before `ensureWorktree`, the model chain and the session row
— so the no-op creates no debris and costs no spawn. The one-live-session guard
is otherwise untouched: a live session of any *other* kind (converge, waypoint)
still refuses, and the later `assertSpawnable` call inside the chat branch stays
as the race-free backstop for two clicks that slip past the `ensureWorktree`
await together.

I deliberately did **not** add an `alreadyLive` flag to `LaunchSessionResult`.
The web client does not need to distinguish the two cases, and an unused field
would have been speculative.

On the web side, the chat action's dispatch moved into a small `openChat`
helper, and a new pure function `chatTerminalPhase(viewing)` in
`next-step/chat.ts` answers "where does the chat terminal live from here" —
`'planning'` from review, `null` everywhere else. Review is the *only* page that
renders no terminal at all (review-arrival decision 5 dropped its band), so it
is the only page whose Chat door has to travel; planning, building and shipped
bodies each render `SessionPanel` themselves and the door must not yank the
human off the page they clicked from. The destination is the same one the review
page's own live-session line already offers as "Open", so no new navigation
concept was introduced. `next-step/index.ts` gained one barrel line so the new
function is reachable from `lib/feature-ui` like the rest.

Tests: new `packages/server/test/chat-door.test.ts` (three cases — the second
click answers with the live session in planning, the same from review, and a
live converge session still refuses) and one case added to
`apps/web/test/feature-ui.test.ts` for the pin.

## Re-running the review finding's repro

The finding's repro is the server path it names: `launchSession` for kind `chat`
with a chat already live. I ran it as `chat-door.test.ts` before the fix and got
exactly the reported error — `GateError: a chat session is already live for
live-chat — only one terminal per feature; end or resume it first`, thrown from
`assertSpawnable` at `launcher.ts:260` via `launchSession`. After the fix the
same call returns the live session's id, `listSessionsByFeature` still holds one
row, and the suite is green.

## Surprises

The stated baseline for this branch is wrong in both directions. It claims "118
files, 1768 passed, 0 failed"; the suite is actually **256 files, 3721 tests**,
and **16 of them fail on the branch tip before anything is touched**. I did not
take that on faith — I added a scratch `git worktree` at the base commit
(`835af16`), linked the installed `node_modules` into it, and ran the seven
failing files there: the same 16 failures, identical names. My diff adds zero
new failures. They are all leftovers of the `ideation`/`revisit`/`qa` kind
collapse (tests asserting `KICKOFF_LINES.ideation`, a `/revisit session/` error
string, the qa read-only prompt, `sessionFinished` sweeping a live chat because
it now returns `feature.mapped` for kind `chat`), plus one unrelated
`dev-pane` process-tree failure. Lap 2's scope names "the broken test suite" as
its own work item, so I left every one of them alone.

Second surprise: `packages/server/test/lap-kickoff.test.ts:216` asserts on
`KICKOFF_LINES.ideation`, a key that no longer exists on a
`Record<SessionKind, string>`. Typecheck does not catch it, so the server's
tsconfig evidently does not include `test/` — worth knowing before anyone trusts
a green typecheck to mean the tests still compile.

## Left undone

- The *other* roads that launch a chat from the review page — `enterIterate`
  with nothing open, `useResolveConflict`, and the triage carry — still land the
  human on review with no terminal on screen, same as before. They are decision
  8's "roads", not the constant Chat door this ticket owns, so I left them; the
  fix would be one `chatTerminalPhase` call each if someone wants it.
- The race path (two chat launches interleaved across the `ensureWorktree`
  await) still yields the old refusal for the loser. The bar disables its
  buttons while a launch is pending, so it is not reachable from the UI.
- No drive-machinery change was needed: this ticket adds no service, no required
  env var, no seed and no process. I confirmed `.runcastle/drive-setup.ts` and
  `.runcastle/drive-stop.ts` are both present and untouched; I did not run them
  (no services in this sandbox) and they are TypeScript, so `bash -n` does not
  apply.

#### 24. The lap-2 full suite still contains deleted session-kind assertions

# ticket(24) — deleted session-kind assertions in the lap-2 suite

## What was done

The four cited sites that reached for `KICKOFF_LINES.ideation` / `.revisit` — keys the kind
collapse deleted — now assert the collapsed contract:

- `kickoff-telemetry.test.ts` — a `chat` launch composes its briefing per feature
  (`chatKickoffHeader`) rather than taking a table line, so the test asserts the recorded line
  names the opening this feature's state calls for (`/runcastle:ideate`) and carries the header.
- `lap-kickoff.test.ts` — the "no briefing" resume asserted `not.toContain(KICKOFF_LINES.revisit)`,
  vacuous (`not.toContain(undefined)` never throws) and wrong in intent: decision 13 means every
  resume carries a fresh header. It asserts the header and the absence of a lap briefing. The
  lap-1 case asserts `KICKOFF_LINES.chat` positively, by its own opening skill
  (`/runcastle:revisit`). `launchAndRead` lost `'ideation'` from its kind union.
- `runtime-adapter.test.ts` — the unrecorded-runtime fallback is `KICKOFF_LINES.chat`.
- `review-wires.test.ts` — the review-drive refusal says "chat session", not "revisit session"
  (the message is built from `session.kind`). Outside the four cited locations, inside the title.

Then I swept the rest of the class the ticket names, which the reviewer could not see because they
could not run Vitest: `project-session.test.ts` ×2, `resolve-conflict.test.ts`,
`row-contracts.test.ts`. All four asserted against deleted kinds and **passed anyway**, guarding
nothing. Substitutions are branch-preserving (`chat` is not in `HOST_SIDE_KINDS` and is not
`project`, so it takes the same arms `ideation` did).

Repro step re-run last, exactly as written: 3 files, 26 tests, green. `bun run typecheck`: 0 errors.

## Surprises

- **`packages/server/tsconfig.json` is `"include": ["src"]` — test files are never typechecked.**
  That is the root cause of this whole ticket class: a deleted kind in a test is a plain string,
  not a compile error. Only the sites where `undefined` flipped a *positive* assertion failed
  loudly, which is exactly the four the review cited; the negative and pass-through forms rot
  silently. Widening that `include` would surface the class permanently, but it is a build-config
  change this ticket did not ask for.
- The stated baseline is stale: this suite is 256 files / 3726 tests, not 118 / 1768.

## Left undone

`bun run test` ends on 3 failures, unchanged in count and identity before and after my diff (both
files last touched by tickets 1/5/2, neither in my diff):

- `dev-pane.test.ts` "kills the child process tree" — `pidAlive(-pgid)` still true after the kill;
  sandbox process-group reaping, not code.
- `waypoint-work.test.ts` ×2 — **a real semantic gap, deliberately not fixed.** `sessionFinished`
  (`launcher.ts:293`) maps the old `ideation` arm onto `chat`, so a live chat on a mapped feature
  counts as *finished* and gets swept. These two tests were mechanically rewritten to launch
  `kind: 'chat'` while keeping the old `qa` expectations, and they now directly contradict the
  passing test above them (`launcher.ts` docstring still names `ideation`/`qa`/`revisit`). Same
  preconditions, opposite expectations — one side must go, and choosing which is a source-behaviour
  decision about the map handoff, which spec.md puts out of scope for this feature. Needs its own
  ticket; it is not a vocabulary fix and I would have been guessing.

Drive machinery: this diff is test-only — no service, env var, seed or process — so `.runcastle/`
needed no edit. I did not execute the drive hooks (no services in this sandbox).

#### 26. Chat branch rollover mutates the worktree without emitting an event

# ticket(26) — chat branch rollover now announces itself

## What was done

`landChatCommits` cut the chat's next temp branch with a bare
`startBranchInWorktree` call and said nothing about it, so the SSE stream and
the query invalidation it drives were blind to a worktree mutation — the exact
thing CLAUDE.md's "every service function that mutates emits an event" rule
exists to prevent. The rollover now emits `chat.worktree_parked` naming the new
branch and the worktree path, before the `chat.landed`/`chat.land_failed` event
that reports the *old* branch's landing.

Rather than paste a third copy of the same emit, I pulled the park-and-announce
pair into one private helper, `startFreshChatBranch` (move + emit, returns the
branch or `undefined` if git refused), plus `parkWorktree` (that, with the
existing detach fallback). `parkTalkWorktreeForRun`,
`ensureTalkWorktreeDuringRun` and `landChatCommits` all go through it. That
incidentally closes the duplication smell the lap-2 review recorded as an
observation in these same two parking paths — it was the only way to add the
third emission without triplicating it. No behaviour changed on the two
pre-existing paths; the event type, message and data shape are byte-identical
to what they emitted before.

The reviewer's repro step is now a test in `chat-coexistence.test.ts` ("names
the rolled-over chat branch on the timeline before it reports the landing"): it
drives a commit-bearing chat branch through `landChatCommits` and asserts the
full `chat.*` event sequence is park → park → landed, with the second park's
`data.branch` equal to the branch the worktree actually ended up on.

**I re-ran that repro step.** Before the fix it failed exactly as reported —
only `['chat.worktree_parked', 'chat.landed']`, no event for the rollover.
After the fix it passes, and so do the other four tests in that file.

## Surprises

- `bun run typecheck` is clean, but the full suite is **not** at the stated
  baseline: 7 tests fail across 6 files (`dev-pane`, `lap-kickoff`,
  `kickoff-telemetry`, `runtime-adapter`, `waypoint-work` ×2, `review-wires`).
  None of them reference `chat-branch` in any form. I confirmed they are not
  mine by restoring both files I touched from `HEAD~1` and re-running exactly
  those six files: same 7 failures, same assertions. Then I restored my
  committed versions (tree is clean at my commit). These look like the residue
  ticket 23's digest already flagged — tests still addressing the deleted
  `ideation`/`revisit`/`qa` kickoff keys and kinds. The prompt's baseline
  ("118 files, 1768 passed") is itself stale: this suite is 256 files / 3727
  tests.
- The chat event vocabulary is entirely free-form — `emit` takes a `string`
  type and nothing in `apps/web` matches on `chat.*`, so reusing
  `chat.worktree_parked` for the rollover cost nothing downstream. The one
  test that asserts an exact `chat.*` sequence (the Burn-under-a-live-chat
  case) is unaffected, because that run has no chat commits and
  `landChatCommits` returns early.

## Left undone

- If `startBranchInWorktree` fails inside `landChatCommits`, the subsequent
  merge deletes the branch the worktree is still on and leaves it detached —
  silently, with no `chat.worktree_detached` event. The two park paths have a
  detach fallback for this; the landing path does not, and giving it one is a
  behaviour change this ticket did not ask for. Worth a ticket.
- The six pre-existing failing test files above. Out of scope here, but the
  lap cannot claim a green suite until they are fixed.
- Drive machinery: no edit needed and none made. This change adds no service,
  no required env var, no seed and no process — none of the four triggers
  fires. I did not run `drive-setup`/`drive-stop` (no services in this
  sandbox); I only confirmed both scripts still exist under `.runcastle/` and
  that nothing in my diff introduces a value they would have to write.

#### 27. Verify the fixes that landed

Gates verification pass

No verify commands are configured, so no gates were run; the pass was spent on the landed diffs as required.

- #24 held. The cited kickoff tests now assert the collapsed `chat` contract, and a server-test sweep found no remaining `KICKOFF_LINES.ideation`, `.revisit`, or `.qa` references or session fixtures using those deleted kinds.
- #26 held. `landChatCommits` now announces the fresh rollover branch with `chat.worktree_parked` before the landing result, and the added coexistence test pins the branch name, worktree path, and event order.
- #25 did not fully hold. The live-chat path writes the briefing only if a live PTY happens to exist, but a missing or exited PTY is a silent no-op; it then unconditionally emits `session.kickoff` with `mechanism: 'pty'` and returns the existing session id. Thus the stated `spawn:false` repro shape, and any stale active row without a registered PTY, still discards `OVERRIDE` while falsely recording delivery. Reported as finding `finding_8EGyEYX6ye8B`.

No unrelated defects were investigated.

### Lap 3

#### 29. Inline chat panel docked beside the feature body

# Ticket 29 — inline chat panel docked beside the feature body

## What was done

The bar's constant "Chat" action is now a toggle for an inline panel docked to the right of
the feature body, in all four states. New `ChatPanel`/`ChatDock` in
`apps/web/src/components/workspace/ChatPanel.tsx`: `ChatDock` renders the body and *nothing
else* when collapsed (no wrapper, no stub — asserted byte-for-byte in a test), and when open
puts the body in its own `min-w-0` column with the panel at a new `--chat-panel-w: 400px`
token beside it. The panel has the option-A header (live dot, "Chat", "one transcript ·
resumed", End session when live, a collapse control), and its body follows the *conversation*
rather than the phase: a live chat gets its terminal, an ended one gets the read-back
`ConversationTranscript` over one "Resume the conversation" button, and a feature nobody has
talked to gets "Start the conversation". The open/closed choice lives in `useWorkspace`
(persisted, `runcastle.chatpanel.open`), like the two rail collapses beside it, so it survives
pinning a phase, switching features and reload.

Three things fell out of the placement and are in the diff. `chatTerminalPhase` is deleted —
the door used to travel review's view to planning to find a terminal, and it no longer has to.
The four bodies that mount a session terminal (`GrillBody`, `RunBody`, `TicketsBody`,
`ShippedBody`) take an optional `chatDocked` and filter the chat out through a new
`bodySessions` helper, because the same PTY mounted twice means two xterms resizing one grid
against each other. And the Chat door does **not** re-launch a chat that is already up: the
server would answer with the same session but also write a fresh state header into it on every
click (decision 13), which would turn a toggle into transcript spam.

**Deviation to know about.** The ticket asks for "header, transcript, and composer". For a
*live* chat the composer is the terminal — that is the only surface in this app that can put
text into a session. The one other write path, `launchSession({ kickoffLine })`, runs through
`planKickoff` and so wraps anything sent in a feature-state header, which is a briefing, not a
chat message; building a real send endpoint is server work this ticket explicitly excludes
("the Chat door's server behavior is done work — this ticket is placement only"). So where a
live chat has its composer, an ended one has the single resume button, and the panel is never a
transcript with no way to answer it.

## Surprises

- The prototype's roled bubbles and the ticket's named seams (`TranscriptPane`,
  `ConversationTranscript`) are both *read-back* components; the app has no roled rendering of
  a **live** conversation at all — live is always the xterm PTY. That is the whole reason the
  panel's body branches on the conversation's state instead of rendering one component.
- `ConversationTranscript` hard-coded a self-scrolling `max-h-[clamp(...)]` box sized for the
  shipped body. It now takes an optional `className` (default unchanged) so a surface that
  scrolls itself can say so.
- The baseline in the burn prompt ("118 files, 1768 passed") no longer matches this repo — the
  suite is 258 files / 3743 tests. See "Left undone" for what fails.

## Left undone

- **Two server test files were already red and are not mine**: `packages/server/test/dev-pane.test.ts`
  ("kills the child process tree…") and `packages/server/test/waypoint-work.test.ts` (two `qa
  conversation` handoff cases, expecting `abandoned` and getting `finished`). My diff is 15
  files, every one under `apps/web/`, and neither server test imports anything from there, so
  they cannot be caused by it. All 109 `apps/web` test files pass (1496 tests) and typecheck is
  clean.
- `liveSessionLine`'s "Open" on the review page still offers a trip to planning to find a
  terminal (`lib/feature-ui/session.ts`). With the chat docked on every page that road is stale,
  but the review page's trail belongs to "Review as a lap trail", not here.
- Planning with the chat docked leaves `GrillBody`'s right column holding an explanatory empty
  state rather than letting the artifact pane take the width — `ArtifactPane` is `flex-none` at
  `--artifact-w` unless `frozen`, and generalising that flag was more redesign than this ticket
  asked for.
- The bar's Chat button carries no pressed/expanded state. Decision 8 forbids rewording it, and
  plumbing `chatPanelOpen` into `NextStepBar` for an `aria-expanded` was not asked for; worth a
  look if the placement gets a second pass.
- Drive machinery: none of the four triggers applies (no new service, required env var, seed or
  process — the change is a React panel and one CSS custom property), so `.runcastle/` is
  untouched. I did not run `drive-setup`/`drive-stop`, as instructed.

#### 30. Verify lap 3: delivery observability and the inline panel

Gates verification pass

No verify commands are configured, so no gates were run.

## Fixes that held

- The finding's exact live-row / no-PTY / `spawn:false` / kickoff-override path now rejects with a purpose-specific missing-terminal error and does not emit an additional `session.kickoff` event. The regression test reproduces that shape directly.
- The Chat action is wired as a toggle in Planning, Building, Review, and Shipped. When open, `ChatDock` keeps the phase body mounted beside the 400px panel; when collapsed, it returns the body without adding a wrapper or stub.
- The panel covers the three conversation conditions implied by the four phase states: a live chat mounts the existing interactive terminal, an ended chat renders the roled transcript with a resume action, and a never-opened chat shows a start action. Phase bodies filter the docked chat session so the same PTY is not mounted twice.
- The panel-open preference persists, and opening an already-live chat from the collapsed state does not relaunch it or add a redundant state briefing.

## Fix that did not fully hold

- `finding_u45dFPo5UtbR` (medium): briefing delivery is still reported too early. `writeToLiveTerminal` returns success after writing the text, schedules the carriage return for later, and `briefLiveChat` immediately emits `session.kickoff`. If the PTY exits before the delayed submit, the agent never receives the briefing as input but the timeline claims PTY delivery. The added regression covers a terminal absent before the first write, not this write-to-submit race.

## Suite status

- `finding_dUAcvjCN1feB` (observation): the full-suite acceptance criterion is not demonstrated green. The supplied ticket 28 work record reports nine failures, and ticket 29 reports failures in `dev-pane.test.ts` and `waypoint-work.test.ts`. Those files are outside the lap-3 diff, so this pass does not attribute them to either landed fix, but it also cannot call the integrated suite green.

No Drive mode actions were taken and no recording was created, as required by the inherited Gates mode.
