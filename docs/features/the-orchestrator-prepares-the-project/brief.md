## Purpose

The human wants onboarding to be as smooth as possible, and wants one fewer kind of session. Today a new project with code lands on a separate Preparation workspace with its own `kind=prepare` session. Preparation goes away as a separate thing: the project orchestrator (the `kind=project` session) does it itself, at the start and at any later time it notices a setting is wrong.

## What the human gets

- **First run of a project:** a new project lands on one clear, symbolic call to action, "Start the project" (exact words and look are the feature's design call). Clicking it opens the orchestrator chat. On a project that is not yet prepared, the orchestrator reads the repo, tells the human in a few lines what it understood, then walks the preparation with them (the eight prepared keys in `PREPARED_KEYS`, `packages/core/src/schemas.ts`, proven by running them, closing with the dry-run drive). Only after that does it ask what we are building. The human chose **prepare first** over "ask first, prepare lazily", because features built before preparation have no working drive.
- **An empty repo (born-empty project)** has nothing to prepare: the orchestrator skips straight to "what are we building?".
- **Preparation tools live with the orchestrator for good.** Whenever it sees that a prepared setting is wrong or missing, it fixes it then and there.
- **The preparation session and its UI are deleted**: the `prepare` session kind, `PreparationWorkspace`, the "Prepare / Re-prepare this project" rail row and palette row, the prep-specific hook digest and guard special cases, and the "a prepare session has ended" notion of prepared. Prefer deleting machinery over carrying it.
- **An onboarding scenario starting from a brand-new install** (the human's pick over "new project only"): no runcastle config, so the drive shows the setup wizard (git identity, pick a coding agent, …), then opening a throwaway sample repo with some real code, then "Start the project" and the orchestrator's preparation. This is the drive the human uses to judge the feature.

## Understood (from the intake look at the code, 2026-11-05 — verify, don't trust)

- The orchestrator already has `record_finding` (shared via `PROJECT_KINDS` in `packages/server/src/mcp/server.ts`), so it can already write prepared settings with provenance. What only `prepare` has: the `dry_run_drive` tool, the `runcastle:prepare` skill's procedure (`packages/skills/packs/runcastle/skills/prepare/`), and the "still unestablished: …" digest at session start (`routes/hooks.ts`, which deliberately excludes project sessions today).
- Nothing on the server gates work on `isPrepared`; the only push is the UI's view selection (`apps/web/src/lib/project-workspace.ts`) landing a featureless, unprepared, non-empty project on Preparation.
- The `runcastle:project` skill currently says "open by asking, orient lazily". The first-start-on-an-unprepared-project path is a deliberate exception to that, not a reversal of it for every chat.
- **The real design problem:** the prepare session works in the human's real checkout and `dry_run_drive` drives the current branch; the orchestrator works in its own worktree on `runcastle/project`, whose commits land on main only when its chat closes. Drive machinery the orchestrator authors under `.runcastle/` is therefore not in the checkout when it wants to rehearse a drive. Solve this in the design; the checkout guard does not cover `project` today.
- Every drive of runcastle today copies the owner's real database and config into the drive's data dir (`.runcastle/drive-setup.ts`, unconditional `VACUUM INTO`). The onboarding scenario needs a "start empty" path that skips that copy, and a sample repo to open. Scenarios run after boot against the seeded DB, so the switch likely has to reach drive setup, not just the scenario file. Runcastle's machinery for running the chosen scenario may need to carry it.

## Must not swallow

- The setup wizard's own design: it stays as is unless the drive shows it is rough, in which case the human sends that back as more rounds.
- The other drive-adjacent session kinds: `scenario` (writes scenarios) and `drive-fix` (repairs a broken drive) stay.
- The project settings page that lists prepared settings with their provenance stays, as a read-only view.

## Open (for this feature's own grill)

- What the "Start the project" moment looks like and says, and what the project home shows before and after it.
- How the worktree-vs-checkout problem above is solved for the dry-run drive and `.runcastle/` authoring.
- How the orchestrator knows a project is unprepared (which keys are unset) without the old session-ended rule.
- What happens to existing `prepare` threads in the database and to old links into the Preparation view.

## Ordering

A single-feature cut; nothing waits on it and it waits on nothing.

## Working agreement (the human's, 2026-11-05)

**One checkpoint at the onboarding drive.** The orchestrator plans, starts and carries the feature without the human until its agent declares it ready. Then the orchestrator starts the onboarding drive (the brand-new-install scenario) and tells the human what to try. The feature merges only after the human passes it there. Everything before the checkpoint is the orchestrator's call.
