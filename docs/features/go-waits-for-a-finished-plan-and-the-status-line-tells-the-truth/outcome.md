# Outcome — Go waits for a finished plan, and the status line tells the truth

Plan it yourself must show that it is running. Observed 2026-10-19 on a freshly started feature: clicking Plan it yourself (the "⋯" menu on the planning status row) launched a headless self-planning chat session (events `session.launching` 'launching a self-planning run' then `session.started`) that worked for about 2.5 minutes, but the feature page showed nothing, and the human concluded the click did nothing and pressed Go. While a self-planning run is live, the status line must say so (e.g. "Planning by itself"), offer its Stop, and the row must not look idle. Find where `featureStatus` (`apps/web/src/lib/feature-ui/status-line.ts`) and `leadActions` decide the planning row, and feed them the live headless self-plan session. Cover it with a status-line unit test and a tier-2 component test of the row.

- Shipped: 2026-10-20
- Laps run: 1

## What shipped

13 commits · 24 files

### Lap 1
- 4 tickets landed: #1 Status line: say "Planning by itself" while a self-planning run is live; #2 Go: refuse it while self-planning, gate it until the plan is finished; #3 Sessions: find the unrequested endSession, and record a failed lead wake; #4 Status line: "Working" only with evidence; say when the agent stopped
- 0 waived
- 0 failed

## Review record

### Lap 1 · review

- Reviewed commit: unknown
- Landed since: 0
- Outcome: cancelled

### Lap 1 · review

- Reviewed commit: 950722a7e72757f7921714be66abc5529b1aa15d
- Landed since: 0
- Outcome: done

### Lap 1 · review

- Reviewed commit: 86c6c953b9bea60258230c0873102f6bcd11b519
- Landed since: 0
- Outcome: done

- **After End session on a headless lead wake, the row still reads "Working · Round 1" until 60s after Go** — fixed
- **Plan it yourself: row still reads "Planning with you" for ~2.5s before "Planning by itself" (Go anyway is now disabled)** — fixed
- **Confirmed in the app: wake failure now shows at once, launch errors don't stick, Start is unaffected, End session on a lead wake is not logged as wake_failed** — open
- **Server gates passed at 86c6c95** — open
- **Another review run's finish tore down this review's drive and killed its browser daemon mid-walk (review machinery, not this lap)** — open

## Notes record

- No human notes

## Per-ticket digests

### Lap 1

#### 2. Go: refuse it while self-planning, gate it until the plan is finished

# Ticket 2 — Go: refuse it while self-planning, gate it until the plan is finished

## What was done
- Server `go()` (`packages/server/src/services/features.ts`) now takes `opts.overrideReason`. While a stoppable headless run is live on the feature (core `isStoppableHeadlessRun`, so a self-plan run counts), it throws a GateError that names the run; no override gets past this. When `ticketsReadyLap !== lap` it throws a GateError starting "the plan is not finished" unless a non-blank reason is given. With a reason, it emits `gate.overridden` `{ gate: 'go', reason }` into the feature's history and goes ahead. A finished plan with zero tickets still goes, and there is no ticket-count check.
- Core `pipeline.ts` got `planFinished(feature)` and `PLAN_UNFINISHED`, shared by the server and the web. The tRPC `feature.go` input now accepts an optional `overrideReason`.
- Web `status-line.ts` has a new primary, `goGated`, which `primaryOf` picks in planning while the plan is unfinished. Its `PRIMARY_ACTION` is Go, disabled with "the plan is not finished", plus a "Go anyway…" escape (the existing decision-20 `escape` slot) that opens Go's confirmation. When the row's primary is `goGated`, `GoFeatureDialog` gets a `gate` prop: it shows a one-line reason field, keeps Go disabled until the field is non-blank, and sends the reason as `overrideReason`. While self-planning, the primary stays `stopSelfPlan` (from ticket 1), so Go never appears there.
- Tests: new `go()` service tests in `feature-lead-rounds.test.ts` (self-plan refusal, gate refusal, override records the event, zero-ticket finished plan goes). Status-line units for go / goGated / never-Go-while-self-planning. A new tier-2 test, `apps/web/test/go-gate.test.tsx`, covers the row and the dialog. Existing tests that called `go()` now seed `ticketsReadyLap: 1`.

## Surprises
- The ticket asked me to reuse `services/gates.ts` `overrideGate`, but that file and all the gate-override machinery (the `gateOverrides` table and the `feature.overrideGate` route) were retired in 94b75e65. There is nothing left to reuse. The override is therefore a reason passed to `go()` plus a `gate.overridden` event, which uses the old event's type and data shape.
- There is no keyboard entry point for Go. Every Go goes through the row's 'burn' kind or the orchestrator's `go_feature` MCP tool.

## Left undone
- The orchestrator's `go_feature` MCP tool (`orchestrator-tools.ts`) has no override parameter, so it is now refused on an unfinished plan and reports the reason as a tool error. Whether the orchestrator should be allowed to override is a separate decision.
- `statusOf` still compares `ticketsReadyLap === lap` inline for "plan ready for Go". I didn't switch it to `planFinished`, to avoid a hunk that conflicts with ticket 4's edits to the same function.
- The web history feed has no specific rendering for `gate.overridden`; it shows the event's message.
- No new infrastructure, so the drive machinery was not edited.

#### 3. Sessions: find the unrequested endSession, and record a failed lead wake

# Ticket 3 — the unrequested endSession, and a failed lead wake

**What was done.** The 2026-10-19 transcript (`~/.claude/projects/C--Users-user--…/1a978196-….jsonl`) is not reachable from the sandbox, so I traced the cause from the code instead. Only `endSession` (`packages/server/src/pty/end-session.ts:23`, message at :36) emits 'session ended by user'. These are all of its callers:
- `feature.endSession` over tRPC (`trpc/routers/feature.ts:117`)
- archive and delete (`services/features.ts:1326`, `:1398`). The feature lived on afterwards, so neither applies.
- the orchestrator's `stop_feature_run` (`mcp/orchestrator-tools.ts:171`). It refuses a feature the orchestrator does not own, so it rules out a human's feature.

That leaves the web's `feature.endSession`. The only caller with no terminal involved is the headless Stop: `stopSelfPlan` → `endLiveSession` (`apps/web/src/components/Workspace.tsx:717`, `:641`).

The most likely story, which I could not confirm without the transcript:
- `resolveHeadlessRun` offers Stop for any live headless chat. `leadActions` keeps Go as the primary and moves that Stop into the row's "⋯" menu, the same menu where "Plan it yourself" had been. The click carries no confirmation and nothing on the row said a run was going (that is ticket 1).
- **14:17:19 (end of the self-plan):** a "⋯" click that landed on Stop.
- **14:17:31 (end of the lead wake):** the lead wake is `headless`, so the bar showed it as "Planning itself" with that same Stop. The orchestrator's `stop_feature_run` also matched any headless chat, so on an orchestrated feature it could kill the lead that `go_feature` had just woken.

**The fix.** A new core predicate, `isStoppableHeadlessRun`, accepts self-plan, relay and headless lap runs and never `lead-wake`. Three places now use it:
- `toolStopFeatureRun`
- the web's `resolveHeadlessRun`, so a lead wake no longer shows "Planning itself" or a Stop
- the `stopSelfPlan` dispatch in `Workspace.tsx`

The human halts the lead with the status row's Stop (`feature.stop`), and the Chat tab's explicit End session still works. Test: `orchestrator-acting-tools.test.ts`, "a lead message while it plans itself…".

**`lead.wake_failed`.**
- `session.pty_exited` now carries `tail` on a non-zero exit: the last 20 lines of the PTY output, at most 2000 characters, control codes stripped (`exitTail` in `launcher.ts`).
- The lead waker now emits `lead.wake_failed` with `{ sessionId, exitCode, tail, messages }` when a wake that had checked in exits non-zero. A headless run is one `claude -p` turn. This case used to be silent and was exactly the 14:17:31 case. The messages are not re-queued, because the agent had them.
- The launch-refused and died-before-check-in reports now also carry `exitCode` and `tail`.
- Core had no list of event types, so I added `LEAD_WAKE_FAILED` and the `LeadWakeFailedData` schema to `schemas.ts` for ticket 4 to read.

**Surprises.**
- `lead.wake_failed` already existed, but only for wakes that died before checking in.
- One existing test asserted that a check-in followed by an exit code of 1 stays silent. I changed it to exit 0 and added a new test for the exit-1 case.
- The bar's "Planning itself" copy was the fallback for any headless purpose, so lead wakes were mislabelled.

**Left undone.**
- An explicit End session on a lead wake is also reported as `lead.wake_failed` (exit 1). `endSession` doesn't record that it was asked for, so the two can't be told apart.
- The new server test deliberately avoids calling `go()` mid-plan, because ticket 2 makes it refuse there.
- Drive machinery: no change needed (no new service, env var, seed or process). Nothing in it was run.
- Full typecheck and full test suite passed: 364 files, 0 failed.
