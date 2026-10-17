## Purpose

Today the server holds exactly one drive slot for the whole machine: a single `testDriveState` variable in `packages/server/src/services/git.ts` (~line 2175). Every kind of drive — a human's feature test drive, a review agent's drive, a project drive, a preparation dry run — from every project occupies that one slot. So a drive in project B disables the Test drive button in project A. Observed live: jewellery-system's project-page Test drive button was disabled with "The review agent's drive of feature/whole-cuts-plan-themselves is running" — a drive of the *runcastle* repo.

That was never a decision. The decisions that established the single slot (`docs/features/preparation-proves-its-findings/decisions.md` #9, `docs/features/project-level-test-drive/decisions.md` #9) justify it by collisions inside ONE repo: same checkout, same dev pane, same drive env file, same ports and database server. Across projects the checkout, repo, dev pane and `.runcastle` drive env file are all distinct. Cross-project blocking is an accident of the slot being one variable. This feature makes it one slot per project. It amends those two #9 decisions, so it should record the reason (likely as an ADR, since it changes a decision two shipped features relied on).

## Precedent

`merge-is-not-blocked-by-another-project-s-drive` (shipped 2026-09-26) fixed the same accident for merges only. It made `mergeFeature` deny only when the slot-holder belongs to the same project, added `projectId` to the `feature` DriveState variant (`dryRun` and `project` already had it), and explicitly kept the single shared slot. This feature finishes the job. Its merge guard and tests should keep holding, and some of it collapses naturally once the slot is per project.

## Must not swallow

- **Concurrent drives inside one project.** Same-project behaviour stays exactly as it is: one drive per project, same refusals, same "named and stoppable" blocking (project-level-test-drive #9), and a review agent never preempts a human drive.
- **Per-drive ports.** The missing `{{port}}` drive-env variable (`E2E-FINDINGS.md` F7) is a separate feature.
- **Cross-project collision detection.** Decided at intake: no warning when two projects' drives would contend for the same port or database server. If project B's dev server can't bind because project A holds the port, that shows up the way any failed dev server does (dev pane output / readiness timeout), the same as running two apps by hand. No pre-flight check and no new refusal.

## Understood

- The single slot is read and written in many places, not just one guard: the start and stop paths for feature drives, dry runs and project drives; `activeDriveInfo()` and `holderLabel()`; `activeTestDriveFeatureId()`; `activeProjectDriveStamp()`; `recordDriveUrl()` and the readiness poll (`watchAppReadiness`), which uses "the drive is still `testDriveState`" to decide whether a late answer still counts; `holdSetupJob`; `reviewDriveRelease`; reconciling orphaned drives at server boot; `__resetTestDriveState`. Expect the variable to become something keyed by project id, with every one of those taking a project.
- The UI surfaces that show or depend on "the active drive": the project page's Test drive row, the feature page's Test drive button and its disabled tooltip, the titlebar drive pill, the review-drive denial banner, and preparation's dry-run refusal. Each should see only its own project's drive. Whether anything should also show drives running in *other* projects (e.g. the pill) is an open design question for ideation.
- The review agent's slot-held wait/retry (`denied-review-drives-classify-wait-surface-retry`) should only ever wait on its own project's slot.

## Open

- Whether any surface should show other projects' live drives at all, or each project page is fully blind to them.
- How orphan reconciliation at boot and the tRPC/MCP drive APIs change shape once more than one drive can be live.
- Nothing the human flagged as wanting to test-drive first. The acceptance test is the original repro: with a drive running in project A, start a test drive in project B and both run.

## Ordering

Standalone. Nothing waits on it, and it waits on nothing.
