# Outcome — Retire mapped ideation (waypoints and converge)

Decide whether to remove maps, waypoints and converge sessions, since splitting big intent into several features already does their job.

- Shipped: 2026-09-30
- Laps run: 1

## What shipped

23 commits · 154 files

### Lap 1
- 8 tickets landed: #1 Web: remove the map UI and the mapped next-step branch; #2 Skills and record: shape-grilling project session, no escalation branch, ADR-0012; #3 Server: remove the map MCP tools and map docs from the feature context; #4 Server: remove waypoint/converge launching, claim lifecycle and the research workflow; #5 Contract: drop the waypoint/converge kinds, Feature.mapped and the waypoints table; #7 Migration keeps cc_session_id on rewritten waypoint/converge rows, so Chat on a formerly mapped feature resumes an old waypoint/converge transcript; #8 readDocsDigestFromDisk is dead code; its only caller was the deleted research workflow; #9 Source comments still cite the deleted SPEC §13.3 and name map.md / research runs as live
- 0 waived
- 0 failed

## Review record

### Lap 1 · review

- Reviewed commit: a98a2e349e93bd10d9017b268c60258a7fa5a910
- Landed since: 3
- Outcome: done

### Lap 1 · verification

- Reviewed commit: 8cb119b27de3f2d94ebb5dff23f704616ddb3330
- Landed since: 0
- Outcome: done

- No findings

## Notes record

- No human notes

## Per-ticket digests

### Lap 1

#### 2. Skills and record: shape-grilling project session, no escalation branch, ADR-0012

# Ticket 2 — skills and record for retiring mapped ideation

**What was done.** Rewrote `project/SKILL.md` so the project session is a "shape griller, not a design griller". §1b now has a breadth-first shape-grill step (pieces, core, uncertainty/test-drive-first, width incl. research/prototype), a "cut until every feature fits one ideation window" bullet, and a five-part brief checklist (purpose, must not swallow, understood, open, ordering as prose). The "not a grilling" paragraph and the Do-NOT bullet now forbid only design grilling. Removed the `mapped` tag from the index-line example. In ideate I deleted §3 (escalation), the escalate/emit tool line, the "Probe the size early" bullet and "Size and certainty are orthogonal", replacing the last with "a feature bigger than expected gets a thin lap 1". I also renamed §4 "Converge" to §3 "Complete ideation", renumbered the sections and changed "converge, don't compact" to "narrow, don't compact". In spec, tickets, revisit and qa I removed the converge, map, waypoint and research-deliverable mentions and the "Branching the map" section. For the record: added ADR-0012, stamped ADR-0001 `superseded by ADR-0012 (2026-09-30)`, reworded ADR-0009 and ADR-0010 (decision 5, and decision 9 became "Laps answer uncertainty, not size"), deleted SPEC §13 and its two cross-refs (§15 intro and §15.5), and rewrote CONTEXT.md principle 7.

**Deviations and surprises.**
- `packages/skills/packs/README.md` used ideate §3 and revisit's "escalate … §3, the map" as its convention examples. I changed only those two example lines to point at ideate §1 and left the skill listings alone.
- CONTEXT.md principle 15 also said "full ceremony and the map stay available as opt-in escalation". I rewrote that clause too ("defers into later laps"), for the same reason decision 8 gives for principle 7.
- `code-review/SKILL.md` said "convergence", which tripped the ticket's grep gate, so it now says "clean state".
- ADR-0012 must never contain the text `superseded by ADR-N`. `knowledge.ts` `SUPERSEDED_RE` would hide it from the live-ADR index, so it uses a `**Supersedes:** ADR-0001` line instead.
- CLAUDE.md had no mapped-ideation wording, so it is untouched.

**Verification.** The targeted vitest run (tickets-skill, kickoff, skills-root, plugin-dir) is green, and so is `bun run typecheck`. The full suite has 1 failure: `dev-pane.test.ts` "kills the child process tree…". It fails the same way when run on its own. It does not read any file this ticket touched (markdown only), so it looks like a sandbox process-tree issue, but it is not in the stated baseline. The skills grep gate is clean outside `waypoint/` and `converge/`. No drive machinery was affected, since the changes are markdown only.

**Left undone.**
- ADR-0002:21 still cites "ADR-0001 §7" when explaining the research workflow's concurrency. It is historical context and outside this ticket's list.
- The waypoint/converge skill dirs, the pack README/NOTICE/plugin.json listings and `burner/research-waypoint.md` belong to tickets #4 and #5.
- The server's system prompts and kickoff lines still mention waypoints and converge. That is ticket #3.

#### 3. Server: remove the map MCP tools and map docs from the feature context

# Ticket 3: map MCP tools and map docs removed from the feature context

## What was done
- **`mcp/server.ts`:** deleted `escalate_to_map`, `emit_waypoints` and `resolve_waypoint`, meaning their bodies, their registrations and their `TOOL_AUDIENCES` entries. `waypoint` and `converge` came out of `FEATURE_KINDS` and `DRAFTING_KINDS`.
- **`get_feature_context`:** `FeatureContext` no longer has `frontierIds`, `assignedWaypointId` or `waypoints`, and the tool description no longer mentions them. `featureIndexLine` no longer adds the "mapped" tag.
- **One deviation:** I removed `FeatureReader.sessionId`. Its only job was the waypoint assignment. The `mcp-tools` assertion that checked it went with it.
- **Other server files:** deleted `escalateToMap`/`EscalateResult` and `scaffoldMapDoc`/`MAP_SECTIONS`/`MapSeed`, plus the `feature.mapped` branch in `scaffoldDocs` that called them. Deleted the burner's `trimMapDoc`/`DROPPED_MAP_SECTIONS` and the map trim in the digest. Removed the three allow rules and the revisit prompt's `map.md` line from `artifacts.ts`, and the prototype exemption plus `prototypesRel` from the edit guard.
- **Core:** `map.md` left `AGENT_DIGEST_DOCS` and `AGENT_DIGEST_FILL_ORDER`, so an old `map.md` now shows up under `moreDocs` / withheld like any other doc.
- **Tests:** added three new assertions:
  - no audience, including `undefined`, is offered the three tools;
  - `get_feature_context` on a formerly mapped feature with a claimed waypoint has none of the mapped keys;
  - the burner digest lists `map.md` without inlining it.
- **`read-tool-ceiling` fixture:** its "mapped" variant was the only thing exercising the "earlier laps moved out" tier. I replaced it with a `backlogged` shape that adds 3 extra test notes. 2 to 4 notes pass; 5 overflows the ceiling, because to-do items never move out.
- **CLAUDE.md:** the note said 20 tools, but it was already stale (27 distinct before this change). It now says **24**. There are 25 `registerTool` calls because `create_feature` has two variants.

## Surprises
- `packages/server/test/dev-pane.test.ts` ("kills the child process tree…") fails every time in this sandbox, both on its own and in the full run. I didn't touch the dev-pane or pty code, so it looks like a container process-group reaping issue. Apart from that, the full suite is green: 4453 passed, 1 failed (that test). Typecheck is clean.
- `mapped-feature.test.ts` was mostly map-scaffold tests. I kept only the `mapped` flag round-trip test for ticket #5 to delete along with the column.

## Left undone
These belong to tickets #4 and #5:
- `packages/skills/.../waypoint/SKILL.md` still mentions `assignedWaypointId`.
- `getFeatureFull`'s waypoints/frontierIds, `mapped: false` on create/fork, and `renderWaypointPrompt`/`renderConvergePrompt` are still there.
- A comment in `docs.test.ts` still names `workflows/research.ts`.
- The `waypoint`/`converge` kinds still exist in core, but they now fall outside `FEATURE_KINDS`. A waypoint session launched before #4 lands would be offered no feature tools.

No drive machinery was touched (no new service, env var, seed or process), so `.runcastle/` needed no changes and I didn't check it.

#### 4. Server: remove waypoint/converge launching, claim lifecycle and the research workflow

# Ticket 4 — server: remove waypoint/converge launching, claim lifecycle, research workflow

## What was done
- launcher.ts: deleted `workWaypoint`, `converge`, `WorkRunResult`, `LaunchSessionInput.waypointId`, `SpawnMeta.waypoint`, and the waypoint claim/resume/`resume_unavailable` path inside `launchSession`. `sessionFinished` and `sweepActiveSessions` were deleted outright: `workWaypoint` was their only caller, so no chat path ran through them and chat launch behaves exactly as before. `session.resume_failed` now labels by `session.kind` and no longer carries `waypointId`. `session.launching` and `session.reconciled` no longer carry `waypointId`, and `run.reconciled` no longer carries `releasedWaypointIds`.
- Removed the `promoteLastSession`/`releaseForSession` calls from sessions.ts (`markSessionLive`), reconcile.ts, pty/end-session.ts, routes/hooks.ts, reconcile-runs.ts and the runner finalizer. The runner also lost `claimWaypointId` and the `resolveWaypoint` wiring. Core `WorkflowCtx` lost `resolveWaypoint`. `input` stays, with a neutral comment.
- Deleted workflows/research.ts, its registry entry, burner/research-waypoint.md, `RESEARCH_BRANCH_PREFIX`/`researchBranchName`, and the research prefix in `TEMP_BRANCH_PREFIXES`. That list feeds both the boot sweep and `deleteFeatureBranches`.
- Stubbed tRPC `feature.workWaypoint`/`feature.converge` with their input schemas unchanged. **Deviation:** the stubs throw `GateError('mapped ideation was retired (ADR-0012)')` instead of constructing a `TRPCError`. The repo convention (trpc/context.ts) is that routers never build TRPCError themselves, and `toTRPCError` maps GateError to PRECONDITION_FAILED, so callers get the same code and message. New test: `test/mapped-ideation-retired.test.ts`. The contract ticket (#5) should delete it together with the procedures.
- smoke.ts: removed `mappedFlow` and the `converge` import.
- Tests: deleted waypoint-work, research and converge tests. session-lifecycle, hooks-route, reconcile-runs, draft-features, git, delete, skills-root and ticket-burner-units were rewritten to be waypoint-free, using chat sessions and ticket/chat temp branches. git.test now also asserts that a leftover `runcastle/research/*` branch is left alone by the sweep.

## Surprises
- `dev-pane.test.ts > kills the child process tree` fails in this sandbox: after the kill, the process group still reports alive. It imports only pty/dev-pane code, which this diff does not touch, so it looks environmental. The rest of the full suite passed (4423 passed), and typecheck is clean.

## Left undone
- Still present for other tickets: `waypoint`/`converge` entries in launcher/runtimes/skills.ts (entry skills, kickoff lines) and `CONVERGE_KICKOFF_LINE` in runtimes/claude.ts. They are keyed by `SessionKind`, so #5 has to remove them.
- `packages/core/test/docs.test.ts:37` has a comment that points at the deleted `workflows/research.ts`.
- `services/waypoints.ts` is now only used by mcp/server.ts (#3) and waypoints.test.ts (#5).
- Drive machinery: no new service, env var, seed or process was added, so `.runcastle/` needed no change. I did not run it.

#### 5. Contract: drop the waypoint/converge kinds, Feature.mapped and the waypoints table

# Ticket 5 — contract: drop the waypoint/converge kinds, Feature.mapped and the waypoints table

**What was done.**
- **Core:** `SessionKind` is now chat | prepare | project | drive-fix. The `Waypoint*` schemas, `Feature.mapped`, the `waypoints` table and `features.mapped` are deleted. `ModelStep` lost waypoint/converge/research.
- **Stale config:** `foldLegacyModelConfig` now strips those three keys from `stepModels` before parsing, so an old config.json loads cleanly. Because the settings view's `readRawConfig` runs the same function, the keys are also dropped on the next settings write.
- **Migration:** the new migration `0042_retire_mapped_ideation.sql` was generated with drizzle-kit and renamed from its random name; the journal tag was updated to match. It first rewrites `waypoint`/`converge` sessions to `chat`, then drops the table and the column. The column drop is a plain `ALTER TABLE … DROP COLUMN`, not a table rebuild, and no table has foreign keys.
- **row-contracts.test.ts:** new test. It seeds a DB migrated only up to 0041 with a mapped feature, a waypoint, waypoint/converge/chat sessions and old `waypoint.resolved`/`feature.escalated` events. After migrating it asserts: the table and column are gone, all three sessions read back as `chat` through `SessionRow`, and the events are byte-identical.
- **Server:** deleted `services/waypoints.ts`, the waypoint/converge prompts, the entry skills, the kickoff lines, `CONVERGE_KICKOFF_LINE` and the tRPC stubs, along with `mapped-ideation-retired.test.ts`, the test that pinned those stubs.
- **Deviation:** `renderSystemPrompt` lost its positional `waypoint` parameter. Every caller that passed `undefined` in that slot was updated (kickoff, carry-channel and launch-artifacts tests).
- **Skills:** the `waypoint/` and `converge/` skill dirs are deleted. The pack README, NOTICE, skills README and plugin.json now list 8 skills: 6 forks, plus `revisit` and `prepare` as originals.
- **Web:** removed the retired switch cases and the three model rows. The settings tests now expect six steps.

**Surprises.**
- The skills README and NOTICE were already stale: they called `waypoint` the second original and left out `prepare`.
- Four migration-era tests inserted `mapped` into pre-0042 schemas. They now rely on the column's default instead.
- `finding-disposition`, `install-guard` and `resolve-conflict` all looped over the retired kinds.

**Grep gate survivors, all allowed:**
- drizzle SQL and snapshots;
- the `RETIRED_MODEL_STEPS` read-compat in core config.ts;
- tests that assert the retirement: the config/schemas tests, the launch-artifacts and mcp-tools "no retired tools or fields" tests, and the row-contracts migration fixture;
- tests of legacy data: `git.test.ts` checks that an old `runcastle/research/*` branch survives the sweep, and `chat-notices.test.ts` renders a past `waypoint.resolved` event (decision 9 keeps old events);
- ordinary English uses of "converges" and "mapped".

**Verification.** `bun run typecheck` passes with 0 errors. `bun run test`: 4330 passed, 1 failed. The failure is `dev-pane.test.ts` "kills the child process tree". It is the same sandbox process-group failure tickets 1–4 each reported, and it touches no code from this ticket. The drive machinery needed no change, since this ticket adds only a migration and no service, env var, seed or process. I confirmed that `.runcastle/drive-setup.ts` and `drive-stop.ts` exist and did not run them.

**Left undone.** The pack README skill table has never had a `prepare` row. ADR-0002:21 still cites ADR-0001 §7 as history.

#### 8. readDocsDigestFromDisk is dead code; its only caller was the deleted research workflow

# Ticket 8 — dead readDocsDigestFromDisk and stale research-run comments

**What was done.** Deleted `readDocsDigestFromDisk` from `packages/server/src/workflows/ticket-burner.ts`. Its only caller was the deleted research workflow. `readDocsDigest` itself stays, because the burner still uses it. Two comments were reworded so they no longer describe research runs as live:
- the parking comment in `packages/server/src/workflows/runner.ts` now says "a non-claiming workflow", and the `ADR-0001 §7` citation is gone;
- the `latestBurn` doc comment in `packages/server/src/services/runs.ts` now says "a run of a non-claiming workflow".

The `BRANCH_CLAIMING` mechanism itself is unchanged. Everything is in one commit.

**Repro re-run.** I re-ran the reviewer's repro on my branch after committing: `git grep -n readDocsDigestFromDisk -- packages apps scripts` and `git grep -n -E 'research: per-run|A research run' -- packages/server/src`. Neither found anything, so it no longer reproduces.

**Verification.** `bun run typecheck` passed with 0 errors. `env -u GIT_ASKPASS bun run test` gave 4330 passed and 1 failed. The failure is `packages/server/test/dev-pane.test.ts`, "kills the child process tree…". That is the process-tree failure ticket 6 already reported from this sandbox, and it is unrelated to this change, which only deletes an unused function and edits comments.

**Surprises.** None. The prompt's baseline figures (118 files, 1768 tests) don't match what this repo actually runs (304 files, 4368 tests).

**Left undone.** With only `ticket-burner` left in it, the non-claiming path in `BRANCH_CLAIMING`/`workflowClaimsFeatureBranch` is now purely speculative. It could be simplified in a follow-up, but that is outside this ticket. No drive machinery was touched, and none was needed.

#### 9. Source comments still cite the deleted SPEC §13.3 and name map.md / research runs as live

## What was done
Rewrote four stale source comments in packages/server/src so they no longer describe retired mapped ideation:
- mcp/server.ts header: "(SPEC §6 + §13.3)" became "(SPEC §6)" because §13 no longer exists.
- services/docs-watch.ts: "flat (brief/decisions/spec/map.md)" became "flat (brief/decisions/spec.md)".
- util/contain-host.ts: "burn/review/research execs" became "burn/review execs".
- workflows/ticket-burner.ts burn-chokepoint doc: removed "research" from the list of headless agents.
Only comments changed; no code did. One commit: ticket(9).

I re-ran the review's repro step, `git grep -n -E '§13|map\.md\)|research execs|review tickets, research' -- packages/server/src`, on the ticket branch after committing. It printed nothing and exited 1, so the finding no longer reproduces.

## Surprises
The full test run had one failure: packages/server/test/dev-pane.test.ts, "kills the child process tree so the port-holder is not orphaned". Ticket 6's report already names this as the known process-tree failure in the sandbox, and this comment-only diff cannot affect it. Typecheck was clean. The run counted 304 files, not the 118 the prompt's baseline states.

## Left undone
Nothing else. The drive machinery was not touched, since this change adds no infrastructure.

#### 10. Verify the fixes that landed

Gates verification pass — pass #6, feature/retire-mapped-ideation-waypoints-and-converge @ 8cb119b2

All three fixes landed in this run held. No new findings were reported.

## Fixes

- **#7 The migration kept cc_session_id: held.** `0042_retire_mapped_ideation.sql` now nulls `cc_session_id` in the same UPDATE that rewrites `waypoint`/`converge` sessions to `chat`. `mostRecentResumableSession` filters on `isNotNull(ccSessionId)`, so the rewritten rows can no longer be resumed. The retirement test in `row-contracts.test.ts` now seeds the review's exact repro: chat `cc_chat` first, then waypoint `cc_wp` and converge `cc_converge`, all ended. It asserts that Chat resumes `cc_chat`, and it passed in the gate run. The in-place amendment of 0042 is sound because 0042 never reached main. The caveat the implementer noted also stands: a dev DB that already applied the old 0042 keeps the stale ids.
- **#8 Dead readDocsDigestFromDisk: held.** The function is deleted. `git grep readDocsDigestFromDisk` on the branch across packages/apps/scripts finds nothing. `git grep -E 'research: per-run|A research run'` in packages/server/src finds nothing. The reworded comments in runner.ts and runs.ts are accurate, and nothing else in the diff changed behaviour.
- **#9 Stale §13.3 / map.md / research comments: held.** The four comments are rewritten. The repro grep `'§13|map\.md\)|research execs|review tickets, research'` over packages/server/src exits 1 with no matches. The diff is comment-only.

## Gates (run once each, on the branch tip)

The gates ran in a detached scratch worktree at 8cb119b2 so they would exercise the branch itself and not main. The worktree has been removed. The inherited `RUNCASTLE_*` asset env vars were unset so that the tests used the branch's own migrations, including 0042.

- `bun run typecheck`: 0 errors (core, server, web, scripts).
- `env -u GIT_ASKPASS bun run test`: 304 files, 4308 passed, 57 skipped, **3 failed**. Vitest also reported one unhandled EPIPE.

The stated baseline (118 files, 1768 tests, fully green) is stale; this repo now runs 304 files and 4368 tests. None of the 3 failures come from this lap:
- `project-drive.test.ts` fails because the identity reads `... topic %DB_NAME%`. That is cmd-style variable syntax left unexpanded on a Windows host. The branch does not touch this test or the drive code.
- `review-directory-preparation.test.ts` fails because it receives `\reviews\...` where it expects `/reviews/...`. That is a Windows path-separator issue, and the branch does not touch it.
- `review-ticket.test.ts` ("does not put review browser settings in implementation…") fails because the host implementation agent inherited `AGENT_BROWSER_SESSION=review-tkt_hXxg42D3Byz-` from this review session's own environment. The branch changes this file only by removing the `mapped`/`resolveWaypoint` fixture fields, which has no bearing on the assertion.

The known `dev-pane` process-tree failure from the implementers' sandbox did not show up on this host.

## Tour

Gates mode, so no drive was run.

REVIEW-MODE: gates
REVIEW-VERDICT: verified
REVIEW-REASON: all three fixes hold and typecheck is clean; the 3 test failures are host-environment issues (Windows paths/cmd expansion, inherited review browser env) in code this lap did not change
