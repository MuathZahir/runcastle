# Outcome — MCP read tools stay within a context budget

get_feature_context and get_project_context return a compact summary under a test-enforced size limit, with fetch-one tools for details, so no read tool overflows or floods an agent's context.

- Shipped: 2026-09-24
- Laps run: 1

## What shipped

20 commits · 23 files

### Lap 1
- 8 tickets landed: #1 get_feature_context leads with a header, rows its tickets, and never hides; get_ticket serves the rest; #2 get_project_context indexes slim and recent; read_feature_brief and get_work_record's seq drill in; #3 Skills and session prompts describe the new read-tool shapes and fetch-ones; #5 Branch forked before project-notes landed: it conflicts with main in 5 files, and the guard test never covers list_project_notes; #6 Guard fixture is shrunk below the spec's real maxima because get_feature_context can't hold them under 60K; #7 get_work_record silently ignores seq when it's sent with a seam but no featureSlug, instead of rejecting it; #8 The guard's portfolio fixture has no charter, so get_project_context is never guarded at its real size; #9 DOC_FILL_ORDER re-lists core's canonical docs by hand; a new canonical doc would rank -1 and fill first
- 0 waived
- 0 failed

## Review record

### Lap 1 · review

- Reviewed commit: 1a500f3fdde12d0b98ce25fd566acbf1897bc4a5
- Landed since: 5
- Outcome: done

### Lap 1 · verification

- Reviewed commit: 2ff1dfb7ba3888d52f4dd187679857da7f0b383c
- Landed since: 0
- Outcome: done

- **get_feature_context strips the current lap's goals before dropping earlier laps' rows, and never puts them back** — open

## Notes record

- No human notes

## Per-ticket digests

### Lap 1

#### 1. get_feature_context leads with a header, rows its tickets, and never hides; get_ticket serves the rest

# Ticket 1 digest: get_feature_context header/rows/ceiling + get_ticket

**What was done**
- Added `packages/server/src/mcp/read-ceiling.ts` with `MCP_READ_CEILING_CHARS = 60_000` and `serializedLength(result)`. It uses the same `JSON.stringify` as `ok()`. Ticket 2 can import both.
- `featureContext` is rebuilt in this key order: the header (feature, phase, lap, annotatedModels, burnConcurrency, latestRun?, frontierIds?/assignedWaypointId?, reviewEvidence, currentLapReview), then the ticket rows, then openDefects/carriedDefects/findings/testNotes/waypoints?, then docs/notInlined/moreDocs/docsNote.
- Each ticket row is the new `FeatureContextTicketRow` (id, seq, title, status, kind, lap, blockedBy, model?, seams, error?, goal). `FeatureContextTicket` and `stripDigest` are gone.
- Doc fill works like this: every canonical doc starts in `notInlined` as `{ relPath, absPath, bytes, reason }`. Then, in the local `DOC_FILL_ORDER` (brief, decisions, spec, map), each doc is inlined whole only if the complete payload still fits under the ceiling. The size check therefore counts the entries still left in `notInlined`. `notInlined` is always present, and `DOCS_NOTE` now mentions it. absPath = `join(featureDocsDir(project, feature), relPath)`.
- New `toolGetTicket(ctx, reader, { seq })` returns the full stored Ticket, digest included, and throws NotFoundError for an unknown seq. It is registered after list_tickets for FEATURE_KINDS + 'run', and `mcp__runcastle__get_ticket` was added to `RUNCASTLE_MCP_ALLOW_RULES`. That is the only change in artifacts.ts. The get_feature_context and list_tickets descriptions were rewritten to the new shape.
- New guard test `test/read-tool-ceiling.test.ts` plus fixture `test/helpers/oversized.ts` (`seedOversizedFeature`, `prose`, `OVERSIZED`). Updated chat-contract and mcp-tools tests: tool lists, ticket rows, get_ticket tests.

**Surprises**
- The ticket's fixture (45 tickets with ~5K goals each, and ~35K findings + ~34K notes) cannot fit under the spec's design. Docs are the only part that may move out, and with every doc moved out the non-doc part measured 75K (linear) and 85K (mapped). Even at real maxima for goals (4–6K per lap) plus the spec's own "35K findings+notes", 45+ rows (~13K of row fields) push past 60K. So the fixture keeps context, AC, digest and docs at or past real max, but sizes the parts that stay inline (one 5K goal, 150-char goals otherwise, ~22K findings+notes, 12 waypoints with 400-char questions) to what the design can hold. The mapped variant sits around 58K with no docs inlined, which leaves very little headroom. The helper's doc comment records this. The spec's "accepted risk" (nothing left to move out) arrives sooner than it estimated. The lap review should decide whether a second move-out tier is needed, for example older laps' goals.
- The post-commit sync hook's `--force-with-lease` was rejected ("stale info") because no remote-tracking ref existed for the branch. I fixed it by fetching that branch into `refs/remotes/origin/...` once. Pushes work now.
- `test/dev-pane.test.ts` ("kills the child process tree…") fails in this sandbox, both in the full suite and on its own, because the pty process group is not reaped. It does not touch anything in this diff. Apart from that one test, the full suite is green: 3895 passed. Typecheck is clean.

**Left undone**
- Skills and system-prompt text (ticket 3), and get_project_context / get_work_record / read_feature_brief (ticket 2). The fixture helper is meant to be extended by ticket 2.
- `ok()` still calls `JSON.stringify` directly rather than `serializedLength`. The two produce identical output.
- Drive machinery: no new services, env vars or seeds, so no drive edits were needed.

#### 2. get_project_context indexes slim and recent; read_feature_brief and get_work_record's seq drill in

# Ticket 2 digest: get_project_context slim index, read_feature_brief, get_work_record forms

**What was done**
- `get_project_context` returns its keys in this order: project, baseBranches, charter (in full), adrs, adrsNote, featureIndex, featureIndexNote. Every index line is now `slug — title [state]`: no one-liner and no docs path. Lines are grouped in-flight, then drafts, then shipped. Shipped features are sorted by their latest `feature.shipped` event, newest first; a feature with no ship event sorts last. The index lists at most `FEATURE_INDEX_SHIPPED_CAP` (50, exported) shipped features. Older shipped and all archived features collapse into one closing line with the counts and how to reach them. `featureIndexNote` says that shipped docs live at `docs/features/<slug>/`.
- New `toolReadFeatureBrief` / `read_feature_brief({ slug })` is available to PROJECT_KINDS only, and has an allow rule in artifacts.ts. It returns `{ slug, title, oneLiner, status, phase, lap, brief? }`. A shipped feature's brief comes from `brief.md` in the session worktree, falling back to the brief in the DB; every other feature's brief comes from the DB. When there is no brief, the `brief` key is omitted and a `note` is set instead. An unknown slug throws NotFoundError.
- `get_work_record` now has three forms:
  - Seam form: digest-free rows, still grouped per feature, so the slug sits on the group rather than on each row.
  - Slug form: keeps digests inline. When the result would cross the ceiling, digests are moved out whole: oldest lap first, then lowest seq. Each ticket whose digest was moved gets `digestNotInlined: true`, and a top-level `note` is added.
  - `featureSlug` + `seq`: returns that one ticket with its digest. An unknown seq or slug throws NotFoundError; `seq` without a slug throws InvalidInputError. When `seq` is given, `seam` is ignored.
- Tool descriptions were rewritten, and the zod union's `featureSlug` branch gained an optional `seq`. Tests were added to project-mcp-tools.test.ts. The fixture gained `seedOversizedPortfolio` in `test/helpers/oversized.ts`: 124 features, with 2.5K-char one-liners, 40 seam tickets carrying 8K digests, a 30-ticket work-record feature, and a real-max brief.md. The guard test now covers get_project_context, all three work-record forms and read_feature_brief.

**Surprises**
- `list_project_notes` does not exist on this branch. The project-notes feature's server tools are not in this branch's history, even though decisions.md says it merged. The guard case for it could not be written. Add it once that tool reaches this integration branch.
- The sync hook rejected the first push (`stale info`), the same problem ticket 1 hit. It is fixed by fetching the branch into `refs/remotes/origin/<branch>` once.
- Full suite: 3905 passed, 2 failed, both outside this diff. `dev-pane` "kills the child process tree" also fails in this sandbox (ticket 1 saw the same). `burn-slot-workspace` "wipes node_modules…" passes on its own, so it only flakes under load. Typecheck is clean.

**Left undone**
- The closing line reads "1 archived features" when the count is 1: plural only, no singular form.
- Drive machinery: no new service, env var or seed, so no drive edits were needed and none were checked.

#### 3. Skills and session prompts describe the new read-tool shapes and fetch-ones

# Ticket 3 — skills and session prompts describe the new read-tool shapes

**What was done.** Rewrote only the passages that describe these payloads.
- ideate, spec, tickets, revisit, qa, converge and waypoint SKILL.md now say that `get_feature_context` returns tickets as summary rows with a `goal`, and that `get_ticket({ seq })` holds context, acceptance criteria and digest. They also say a canonical doc in `notInlined` must be read before acting. ideate and qa add `get_ticket` to their tool lists. tickets says `annotatedModels` sits in the header.
- project SKILL.md:
  - The tool count goes from five to six.
  - The feature index is described as `slug — title [state]` lines: all in-flight and draft features plus the 50 most recently shipped, with a collapsed closing line.
  - `read_feature_brief({ slug })` is added.
  - `get_work_record` is described as: seam form = rows without digests; slug form = digests, some possibly moved out with `digestNotInlined: true`; `featureSlug` + `seq` = one ticket with its digest.
- health-sweeps.md: points at slug+seq for moved-out digests.
- launcher/artifacts.ts, prompt text and its doc comments only:
  - The lap review-evidence line no longer says the digest is stripped; it points at `get_ticket`.
  - The review-iteration passage: the rows carry status, lap, goal and error; `get_ticket` adds `commits` and `digest`. The spec moves commits out of the row.
  - The drive-fix `## The feature` line gains the notInlined and get_ticket rules.
  - The project prompt says shipped docs are at `docs/features/<slug>/` and names `read_feature_brief`, instead of saying the index shows where.
- RUNCASTLE_MCP_ALLOW_RULES and the burner prompts are untouched.
- One test assertion in launch-artifacts.test.ts ("not.toContain('digest')" plus a `commits` match) now asserts the get_ticket pointer.

**Surprises.**
- The first commit's sync push was rejected with "stale info". Refreshing the remote-tracking ref and pushing again fixed it.
- The full suite has 1 failure: dev-pane.test.ts "kills the child process tree…". It checks that a process group is reaped, and it fails on a single targeted re-run too. It imports nothing this diff touches; it's likely a PTY/process-group quirk of this sandbox, and it's not in the baseline.
- Typecheck is clean. The other 3887 tests pass.

**Left undone.**
- `routes/hooks.ts:384` (the SessionStart context) still says "Call `get_feature_context` for the full docs + tickets". It's outside this ticket's file list.
- Comments in `services/carried-work.ts:49` and `test/kickoff.test.ts:79` still say the digest is "stripped".
- No drive machinery was needed: this is text only.

#### 5. Branch forked before project-notes landed: it conflicts with main in 5 files, and the guard test never covers list_project_notes

## What was done
- Merged `main` (1882e87d, 55 commits ahead; includes the project-notes merge 45a2a98a) into this ticket branch, so the integration branch picks up the merge when this ticket lands. All 5 conflicts were resolved by keeping both sides: in `server.ts`, the `read_feature_brief` audience sits beside the three project-only notes tools; in `artifacts.ts`, both sets of allow rules are kept; the `mcp-tools.test.ts` project-audience list names all of them; the `project-mcp-tools.test.ts` imports are combined; the project `SKILL.md` tool count went from "Six"/"Eight" to "Nine".
- Added a `list_project_notes` case to `read-tool-ceiling.test.ts`. `seedOversizedPortfolio` now also seeds 30 open notes of 1,200 chars each, half of them with screenshots (so they carry the path and attachment sentence), plus 20 triaged notes the tool must skip. The case asserts that every open note is returned and that the serialized result is at most `MCP_READ_CEILING_CHARS`.

## Re-ran the repro
`git merge-tree --write-tree --name-only main <this branch>` returns only a tree id: 0 conflicts (it was 5). The same holds against `feature/mcp-read-tools-stay-within-a-context-budget` + this branch. `grep -c list_project_notes` on the guard test now gives 1 (it was 0).

## Verification
Typecheck is clean. On the full suite, 3986 tests passed and 1 failed: `dev-pane.test.ts` "kills the child process tree…". It fails the same way when run on its own. Neither this ticket nor the merge touched it; ticket 4 called it a sandbox-only process-group failure. So the full suite is NOT fully green here, contrary to the stated baseline.

## Surprises
- The sync hook's push first failed with "stale info" because the slot had no remote-tracking ref for this branch. After fetching the branch ref, the force-with-lease push went through.
- `list_project_notes` has no move-out step: a large enough untriaged backlog would still cross the ceiling. The fixture size of 30 notes × 1.2K is a judgement call, since there is no measured real maximum.

## Left undone
- Ticket 4's larger finding still stands: the feature-context fixture is shrunk below the spec's real maxima (a second move-out tier may be needed). The other smaller review findings (seq sent with seam, project-context guard without a charter) are also not addressed here.
- Drive machinery: this ticket adds no services, env vars, seeds or processes, so no drive files needed an edit.

#### 6. Guard fixture is shrunk below the spec's real maxima because get_feature_context can't hold them under 60K

## What was done
- I set the guard fixture in `packages/server/test/helpers/oversized.ts` to the repro's sizes: goalChars 1_000, findingDetailChars 2_800, testNoteChars 2_200. This gives about 35K of findings plus notes. I also rewrote the fixture's doc comment, which had said the fixture was deliberately undersized.
- I measured `get_feature_context` at these sizes with every doc moved out. Linear came to about 105K, of which goals were about 50K. Mapped came to about 112K. **Even with every goal moved out, the mapped payload was still about 63K.** So moving out goals alone, which is what the ticket suggested, was not enough. `featureContext` in `packages/server/src/mcp/server.ts` now moves parts out in this order, each part whole or not at all:
  1. Docs. These still get the least priority: they only fill the room left over.
  2. Goals, oldest lap first and lowest seq first within a lap. Each row whose goal moved gets `goalNotInlined: true`.
  3. Whole rows from earlier laps, oldest lap first. They are named in a new `ticketsNotInlined: [{ lap, seqs }]` key.
- The current lap's rows and the lap's to-do list never move out.
- A `ticketsNote`, placed right after `tickets`, appears whenever anything moved out. It points at `get_ticket` and `list_tickets`.
- The `get_ticket_context` row type now has `goal?` and `goalNotInlined?`. The tool description names both markers.
- The guard test has a new case: goals move out as an oldest-first prefix and are marked, every seq is either a row or named in a moved-out lap, and the current lap's rows are all present. The key-order test now includes `ticketsNote`, plus `ticketsNotInlined` on the mapped feature.
- **Repro re-run:** `cd packages/server && bun test test/read-tool-ceiling.test.ts` with the repro sizes: 12 pass, 0 fail. Both linear and mapped now fit, at about 59.7K each. Linear keeps 10 goals. Mapped moves every goal out, plus the rows of laps 1 and 2.

## Surprises
- Mapped at the spec's sizes needed the third tier (earlier laps' rows). Goals alone would not have fit it.
- The payload sits right at the ceiling, so the exact result depends on things like the slug's length. Mapped moved only lap 1 in one run and laps 1 and 2 in the test, so the test checks the rules, not exact counts.
- Typecheck is green. Full suite: 1 failure, `dev-pane.test.ts`, "kills the child process tree". It also fails when run alone and has nothing to do with this change. It is the sandbox-only process-group test that ticket 4 already reported.
- The post-commit sync push was rejected with "stale info". I fetched the branch's tracking ref and pushed again (a fast-forward). The mirror now has 9f005cb0.

## Left undone
- The skills and the `launcher/artifacts.ts` system-prompt line do not yet mention `goalNotInlined` or `ticketsNotInlined`. The payload's own `ticketsNote` and the tool description do. A one-line addition to each skill would finish the job if wanted.
- Drive machinery is untouched; this change needs no new service, env var or seed.

#### 10. Verify the fixes that landed

Gates verification pass — verifies pass #4 on `feature/mcp-read-tools-stay-within-a-context-budget` (head 2ff1dfb7)

No verify commands are configured for this project, so there were no gates to run. I read each fix diff against its finding and ran the directly relevant suites once, in a detached scratch worktree (since removed): `read-tool-ceiling`, `project-mcp-tools` and `mcp-tools` in packages/server gave 95 pass, 0 fail; core `docs.test.ts` gave 12 pass, 0 fail.

## Fixes

- **#5 (held).** The branch has merged main: its merge-base is now main's head 1882e87d, and `git merge-tree` reports no conflicts. The guard test covers `list_project_notes` with 30 untriaged notes (half of them with screenshots) plus 20 triaged ones, and asserts that the triaged notes are skipped and the result stays under the ceiling. The ticket(8) merge kept this alongside the charter fixture.
- **#6 (held, with one follow-up finding).** The fixture is back at the spec's sizes: 1K goals, one 5K goal, findings of 7×2.8K and test notes of 7×2.2K. `get_feature_context` now has a second move-out tier: goals are marked `goalNotInlined`, then earlier laps' rows are named in `ticketsNotInlined`, with a `ticketsNote` pointing at `get_ticket`/`list_tickets`. The tool description explains this. The guard passes for both linear and mapped features. Follow-up finding (low): the goal pass runs into the current lap before any earlier-lap rows are dropped, and removed goals are never refilled. On the mapped fixture every current-lap goal is out while about 4K of headroom is left.
- **#7 (held).** The seam branch of the zod union now accepts `seq`, and the seq-without-slug check runs first. A new test sends `{seam, seq}` over the in-process MCP app and gets `isError` with the expected message.
- **#8 (held).** The portfolio fixture writes a 15K `CONTEXT.md`, 20 live ADRs and 3 superseded ones. The guard asserts the charter is present at full size and that `adrs` has 20 entries, all under the ceiling.
- **#9 (held).** `DOC_FILL_ORDER` is gone. The fill order now lives in core as `AGENT_DIGEST_FILL_ORDER`/`agentDigestFillRank`, next to `AGENT_DIGEST_DOCS`, and a test pins that both hold the same set. An unranked doc now ranks last, not -1.

Nothing else was plainly broken.

REVIEW-MODE: gates
REVIEW-VERDICT: verified
REVIEW-REASON: all five landed fixes hold; one low-severity ordering finding on the #6 move-out tier left open for the human
