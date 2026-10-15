# One drive slot per project

## Problem

The server holds exactly one drive slot for the whole machine. Every kind of drive — a human's feature test drive, a review agent's drive, a project drive, a preparation dry run — from every project occupies it. So a drive in one project disables drives in every other project. Observed live: jewellery-system's project-page Test drive button was disabled with "The review agent's drive of feature/whole-cuts-plan-themselves is running" — a drive of the *runcastle* repo, which has nothing to do with jewellery-system's checkout.

That was never decided. The decisions that set up the single slot (`preparation-proves-its-findings` #9, `project-level-test-drive` #9) justify it by collisions inside one repo — the same checkout, dev pane, drive env file, ports and database server. Across projects all of those are distinct (projects are unique by canonical repo path, so one project is one checkout). Cross-project blocking is an accident of the slot being one variable. `merge-is-not-blocked-by-another-project-s-drive` already fixed the same accident for merges alone; this feature finishes the job for drives.

## Approach

**What the human sees.** With a drive running in project A, the human opens project B and starts a test drive (feature, project, or a preparation dry run); it starts, and both run side by side. Project B's pages show nothing about A's drive at all — not the Test drive card, not the feature page's Test drive button or its tooltip, not the titlebar pill, not the review body, not preparation (decision 2). Inside one project nothing changes: one drive at a time across all four kinds, the same refusals in the same words, a blocking drive named and stoppable, a review agent never preempting a human drive, the human's Stop still able to reclaim the slot from a review agent that died holding it (decision 6). That is the acceptance test: the original repro, with a drive running in project A, a test drive started in project B, and both run.

**The slot becomes keyed by project.** The single in-memory `DriveState` becomes a map from project id to that project's drive. Every drive kind already carries `projectId`, so the drive's own shape does not change. Every place that reads or writes the slot names the project it is asking about:

- the start and stop paths of all four drive kinds (`testDrive` for human and review purposes, `dryRunDrive`, `projectDrive`) check and occupy only their own project's entry; every same-project refusal stays as written;
- the "is this still the same drive?" checks — the readiness poll's late-answer guard, `holdSetupJob`, and the three sniffed-URL recorders — compare against their own project's entry, so a drive starting in another project never makes a live poll or setup job think its drive has gone;
- the review drive's releaser (today one global variable) becomes one per project, so two review agents in two projects each release their own drive and never overwrite each other's releaser; the burner's release-on-every-exit path releases the drive of the project its run belongs to;
- `mergeFeature`'s guard reads its own project's entry — the same rule the precedent shipped, now true by construction;
- `prepView`'s `dryRun` reports only this project's dry run (today it reports any project's dry run as this one's);
- the test-only reset clears every project's drive.

**The API is asked per project; there is no global view** (decision 3). `feature.driveInfo` takes a required `{ projectId }` and answers with that project's drive, or null. `activeDriveInfo` and `activeTestDriveFeatureId` each take a project id. Nothing answers "what is driving anywhere". The web callers already know their project (the project shell, the feature workspace, the review body, the project-drive hook, preparation, the drive parts and the project-drive blocking banner) and pass it; client-side "is this my project's drive" filtering becomes redundant and may go. The MCP drive tools (`review_drive`, `dry_run_drive`, `retry_drive`) and the drive-fix launch keep their inputs — each already resolves a project from its session's feature or project — and read that project's entry. The review agent's slot-held wait/retry therefore only ever waits on its own project's slot, with no change to the agent's prompt.

Dev panes are already keyed by feature id or project id, so two can be live at once; only the comment claiming "at most one drive is ever live" is wrong after this. A server restart still forgets every drive, as today: the slot was in-memory and there is no boot reconciliation of drives to change.

**Drive identity stays as it is; the recipes stop sharing names across projects** (decision 5). `RUNCASTLE_ID` is unchanged — `project_drive` for every project drive, `prep_dry_run` for every dry run, the feature slug for a feature drive — so two projects' concurrent drives can now carry the same id. The prepare skill's recipe reference is amended so every recipe names anything shared across projects with the app prefix: the Redis recipe derives its index and key prefix from `myapp_$RUNCASTLE_ID` rather than the bare id (as written, B's stop would `FLUSHDB` the index A's live drive is using), and the schema-per-drive recipe prefixes its schema name the same way. The Postgres, compose and branch-per-drive recipes already use the prefix or are scoped per vendor project; check them and leave them be. The prepare SKILL.md's prose that describes `RUNCASTLE_ID` should say it is unique within a project only.

**ADR-0014 records the amendment** (decision 4). A new `docs/adr/0014-one-drive-slot-per-project.md`, shaped like ADR-0013 (Status, Deciders, an **Amends:** line naming `preparation-proves-its-findings` decision 9 and `project-level-test-drive` decision 9; Context; Decision; Consequences). Context: the brief's argument. Decision: one slot per project; within a project every rule those decisions set still holds; no cross-project collision detection, by design (contention for a port or database server surfaces as any failed dev server does). Consequences include the identity rule: `RUNCASTLE_ID` is unique within a project only, so a drive script naming anything shared across projects must prefix it; already-prepared projects keep their scripts and are not checked. The two shipped `decisions.md` files are not edited.

## Seams

- **The drive service functions, called directly with two projects** (existing). `testDrive`, `reviewDrive`, `dryRunDrive`, `projectDrive`, `mergeFeature`, `activeDriveInfo(projectId)`, `activeTestDriveFeatureId(projectId)`, `releaseReviewDrive`. The server test suite already builds two real repos as two projects (the merge suite's "another project's drive" block); this is the primary seam. It lets you observe: a start in B succeeding while every kind of drive holds A; each project's info reporting only its own drive; same-project refusals unchanged in kind and wording; stopping one project's drive leaving the other's untouched (still live, dev URL and readiness intact); a readiness poll in A still landing its `ready` answer after B started and stopped a drive; two review drives in two projects each released by their own releaser.
- **`feature.driveInfo({ projectId })`** (existing procedure, new required input). Observe that the answer for B is null while A drives, and that a call without a project id is rejected.
- **`prepView`** (existing). Observe that `dryRun` is null for B while A runs a dry run.
- **The web derivations** (existing). The project-drive card's state and the feature page's Test drive state, given B's drive info while A drives, are `ready`, not `blocked`.
- **The review agent's MCP `review_drive`** (existing). Observe a review start in B succeeding while a human drive holds A, and `status` reporting only B's drive.
- **Docs** (new files / edits): ADR-0014 exists with the Amends line; the recipes reference uses the app prefix in the Redis and schema recipes.

## Out of scope

- Any surface showing other projects' drives (a titlebar hint, a banner, a global list) — decision 2.
- Per-drive ports (`{{port}}`, E2E-FINDINGS F7) — its own feature.
- Cross-project collision detection for ports or database servers — decided at intake; no warning, no pre-flight check, no new refusal.
- Changing `RUNCASTLE_ID`, or adding a project discriminator variable — decision 5.
- Keeping drives alive across a server restart.
- Any change to same-project drive behaviour, refusal wording, or review-agent preemption rules — decision 6.
- Editing the two shipped decision #9s — decision 4.

## Open questions

None. Every question the brief left open is answered by decisions 2 (visibility), 3 (API shape) and 6 (restart: there is no boot reconciliation of drives).
