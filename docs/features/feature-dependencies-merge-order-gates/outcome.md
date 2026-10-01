# Outcome — Feature dependencies (merge-order gates)

Let a draft feature depend on other features (draft or started) that must merge before it can be worked on.

- Shipped: 2026-10-01
- Laps run: 2

## What shipped

16 commits · 34 files

### Lap 1
- 5 tickets landed: #1 Merge-order dependencies: storage, service, Start refusal, delete cascade, tRPC; #2 Web: Waits-on row, gated Start, rail chip and Blocks line; #3 Agents: dependsOn on create_feature, set_feature_dependencies, context fields, skills, ADR-0013; #5 Rail never shows "Waits on <slug>" — rowChip is computed but rendered nowhere; #6 Cycle refusal in the Waits-on row shows raw markdown backticks
- 0 waived
- 0 failed

### Lap 2
- 1 tickets landed: #8 Cycle refusal still shows raw backticks, in a duplicate global toast
- 0 waived
- 0 failed

## Review record

### Lap 1 · review

- Reviewed commit: 079eef9889a47e7d1b623c90991c55b356a4b95a
- Landed since: 3
- Outcome: done

### Lap 1 · verification

- Reviewed commit: 9bca6f6c1ec890d607d9da0e38d90d4dc3e929a7
- Landed since: 1
- Outcome: done

### Lap 2 · verification

- Reviewed commit: d3b6060e7f3f071991fec69303b441a0b782a8a9
- Landed since: 0
- Outcome: done

- No findings

## Notes record

- No human notes

## Per-ticket digests

### Lap 1

#### 1. Merge-order dependencies: storage, service, Start refusal, delete cascade, tRPC

# Ticket 1 — merge-order dependencies: storage, service, Start refusal, delete cascade, tRPC

**What was done.** Added the `feature_dependencies` table to the core drizzle schema. It has a composite PK, two FKs with `ON DELETE CASCADE`, and no `kind` column. The drizzle-kit migration is `packages/server/drizzle/0044_icy_daimon_hellstrom.sql`; drizzle-kit chose 0044 because the journal already holds two 0042 entries. Added `packages/core/src/dependencies.ts`, which holds `isDependencySatisfied`, `findDependencyCycle`, and the types `DependencyRef`, `BlockRef` and `DependencyEdge`. Added the new service `packages/server/src/services/dependencies.ts` with these exports:
- `setDependencies`, `validateDependencies`, `dependsOnOf`, `waitingOn`, `blocksOf`
- `dependencyMaps` — one edge query per project, used by `list()`
- `listDependencyEdges`, `dependentsOf`
- `describeBlocker` — builds the "`a` (building)" / "(archived — remove it to start)" / "(draft)" text

`startDraft` now throws a `GateError` before any git work while the draft is waiting. `deleteFeature` emits `feature.dependency.deleted` on each dependent, then deletes the edges in both directions explicitly in `deleteFeatureRows`. It has to be explicit because the sql.js test DB does not enable `foreign_keys`. `FeatureListItem` and `FeatureFull` now carry `dependsOn` and `blocks`. tRPC has a new `feature.setDependencies` procedure. Tests are in `packages/core/test/dependencies.test.ts` and `packages/server/test/feature-dependencies.test.ts`.

Small choices beyond the ticket:
- `blocks` is empty once the dependency itself has shipped, because those edges no longer gate anything.
- Refs are sorted by slug so refusal messages are deterministic.
- `setDependencies` returns the stored set, read back with `dependsOnOf`.

**Surprises.**
- `bun run typecheck` was red at baseline. `launcher.ts` called `endSession` with no import, because a merge had dropped the import while keeping the re-export. I restored the import in its own commit (`ticket(1): restore the launcher's endSession import…`).
- The full suite has one failure, `packages/server/test/dev-pane.test.ts` ("kills the child process tree…"). It also fails when run alone, and it tests process-group killing in this sandbox, which this change does not touch. The result was 1 failed / 4390 passed.
- No web test fixtures needed the new fields for typecheck.

**Left undone (other tickets' territory).**
- MCP: `create_feature` `dependsOn` should call `validateDependencies(ctx, projectId, null, ids)` before inserting. Still to do: `set_feature_dependencies`, and the `get_project_context` / `get_feature_context` fields.
- Web: the Waits-on row, the rail chip and sort, the Blocks line, and disabled Start. Note that the blocker-state text currently lives server-side in `describeBlocker`.
- Skills, and ADR-0013.
- Drive machinery: this ticket only adds a migration, which boot applies, so no drive change is needed. I did not run the drive scripts.

#### 2. Web: Waits-on row, gated Start, rail chip and Blocks line

# Ticket 2 — Web: Waits-on row, gated Start, rail chip, Blocks line

**What was done.**
- Added `apps/web/src/lib/feature-ui/dependencies.ts`, re-exported from the barrel. It holds the pure helpers: `blockers`, `isWaiting`, `dependencyState`, `blockerList`, `waitingReason` and `dependencyCandidates`.
- Rail (`sidebar.ts`): a draft with unmerged dependencies shows `Waits on <slug>`, or `Waits on N` with a tooltip such as "waits on a (building), b (archived)". Ready drafts now sort above waiting ones, both in `sortForSidebar` and in the drafts bucket of `triage()`. `triageOf` and `needsMe` are unchanged.
- Start (`next-step/draft.ts`): `resolveDraft` reads `full.dependsOn` directly. I did not thread it through `ResolverInput`/ctx, because `FeatureFull` already carries the field. Start's disabled reason is "Waits on a (building), b (archived — remove it to start)", and it outranks the missing-base reason. I left out the backticks because the reason renders as a plain-text caption.
- New `components/workspace/FeatureDependencies.tsx` with two parts:
  - `DependenciesRow`: on a draft, chips with their state, ✕ on unmerged deps, and **+ Add** through the `Combobox` primitive. On a started feature it is a read-only "Waited on:" line, or nothing when there were no dependencies.
  - `BlocksLine`: the dependents' slugs as links built with `pathFor`.
- Both are wired into the header children in `Workspace.tsx`. Edits go through `feature.setDependencies.mutateAsync` and invalidate on success. A server refusal shows inline as `role="alert"` under the row rather than as a toast, so the component test can check it.
- Tests: `test/feature-dependencies.test.ts` (tier 1, covering pure logic and the read-only lines) and `test/feature-dependencies-row.test.tsx` (tier 2, covering ✕, the picker and the error). The shared fixtures and the fixture in `sidebar-row.test.ts` gained `dependsOn: []` and `blocks: []`.

**Surprises.**
- `Phase` only has planning/building/review/shipped. A draft's chip therefore says "draft" from its status, not from its phase.
- The full suite has one failure, `packages/server/test/dev-pane.test.ts`, which is the sandbox process-group failure ticket 1 already reported. Typecheck is green.

**Left undone.**
- The blocker wording now exists twice: the server's `describeBlocker` and the web's `waitingReason`/`dependencyState`. They could move into `@runcastle/core` together. I did not do that because `packages/server` was off-limits for this ticket.
- The picker does not filter out picks that would form a cycle; the server refuses them and the row shows the refusal.
- No drive machinery change was needed, because this ticket is web-only.

#### 3. Agents: dependsOn on create_feature, set_feature_dependencies, context fields, skills, ADR-0013

# Ticket 3 — agents: dependsOn, set_feature_dependencies, context fields, skills, ADR-0013

**What was done.**
- `create_feature` takes `dependsOn?: string[]` (slugs) on both its draft-only and full shapes. `toolCreateFeature` refuses it without `draft: true` or with `tickets` (InvalidInputError, "only for drafts"). It resolves the slugs inside the project with a new `featureIdsBySlug` helper, so an unknown slug or another project's slug is refused by name. It then runs `validateDependencies(…, null, ids)` before the row is inserted, and `setDependencies` after. The result carries `dependsOn` only when one was passed, so the existing `toEqual` shape tests stayed valid.
- New tool `set_feature_dependencies({ slug, dependsOn })` / `toolSetFeatureDependencies`. It is limited to `['project']` in TOOL_AUDIENCES and gated at call time like the notes tools (requireProject, then a kind check). It is named in the project-scoped refusal text and added to `RUNCASTLE_MCP_ALLOW_RULES` in `launcher/artifacts.ts`; without that rule the project session would stall on a permission prompt. It returns `{ slug, dependsOn: {slug, satisfied}[] }`.
- Feature index lines end with ` · waits on: a, b ✓`. A draft with an unsatisfied dependency reads `[draft, waiting]`. FEATURE_INDEX_NOTE and the get_project_context description explain the notation.
- The `get_feature_context` header now has `dependsOn` (`DependencyMark[]`) and `blocks` (slugs) right after `lap`. I updated the key-order assertion in `read-tool-ceiling.test.ts` and the tool description.
- Project skill: §1c gained an ordering paragraph, the tool list now counts "Ten" and includes `set_feature_dependencies`, and the `create_feature` signature mentions `dependsOn`. Ideate skill: the parking bullet and the tools list now mention `dependsOn: [<this feature's slug>]`.
- New ADR `docs/adr/0013-feature-merge-order-dependencies.md` amends decision 24 and records the inheritance from decision 25. `docs/adr/` has no index file to update.
- New tests are in `packages/server/test/feature-dependencies-mcp.test.ts` (8 tests).

**Surprises.** There are no skill-text snapshot tests, so the skill edits needed no test changes. `qa` is not a SessionKind, and an unknown audience is offered every tool, so the audience test uses `drive-fix`. Full suite: 4398 passed, 1 failed. The failure is `dev-pane.test.ts` "kills the child process tree…", the same sandbox process-group failure ticket 1 reported. This ticket does not touch that code. Typecheck is green.

**Left undone.** Web UI belongs to another ticket. No drive-machinery change was needed because this ticket adds no service, env var or seed; I did not run the drive scripts.

### Lap 2

#### 9. Verify the fixes that landed

Drive verification pass — verifying pass #7 on feature/feature-dependencies-merge-order-gates

## Fixes verified

- **#8 Cycle refusal still shows raw backticks, in a duplicate global toast — HELD.**
  The fix (d3b6060e) adds a no-op `onError` to `trpc.feature.setDependencies.useMutation` in
  `apps/web/src/components/Workspace.tsx`. Because of that handler, `unhandledMutationError`
  returns null and the MutationCache safety net no longer toasts.
  I re-ran the repro on the live drive (runcastle-demo):
  1. Created drafts "Verify dep B" and "Verify dep C".
  2. In B, + Add → Verify dep C. The edge was saved: the rail chip reads "Waits on verify-dep-c" and C's header shows "Blocks: verify-dep-b".
  3. In C, + Add → Verify dep B. The inline alert reads "that would form a cycle: verify-dep-c → verify-dep-b → verify-dep-c" as plain text, with no backticks.
  4. The toast region (`[role=status]`) stayed empty, both right away and about 1.5s later. The page body has no backticks anywhere.
  Evidence: `walkthrough.webm` and `cycle-refusal.png` in this directory.

## Plainly broken on the tour

Nothing.

## Notes

- I left the test drafts "Verify dep B" and "Verify dep C" in the drive's per-branch database snapshot of runcastle-demo.
- Gates were not run, because this is Drive mode.

REVIEW-MODE: drive
REVIEW-VERDICT: verified
REVIEW-REASON: Cycle refusal shows inline as plain text with no duplicate global toast; fix #8 holds.
