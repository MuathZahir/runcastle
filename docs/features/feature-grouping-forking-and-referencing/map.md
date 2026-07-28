# Feature grouping, forking, and referencing — map

## Destination

runcastle gains project-level memory and project-level entry points — durable knowledge that outlives a feature, cross-feature access to it, a session that is not bound to any feature, explicit relations between features, and a way in for work too small to deserve one.

## Notes

**Where this came from.** The seed was "grouping, forking, referencing." Grilling resolved those into three symptoms of one gap: runcastle has feature-level memory but no project-level memory. See `decisions.md` 1–5 for what is already locked.

**Facts established (do not re-derive):**
- A *merged* feature's docs are already on disk in any later feature's worktree — verified: `docs/features/streamlining-user-experience/` is readable from this worktree because that branch merged. So the merged case needs discovery (pointer + index), not cross-branch reads.
- An *in-flight* feature's docs live only on its own branch and are genuinely unreadable across branches — but the human confirmed the driving case is merged work, so this is not the requirement.
- Git-level forking already exists: `feature.create` takes `baseBranch`, and the New Feature form has a "Branch from" picker. What is missing is a *knowledge* link, not a branch one.
- runcastle-the-repo already uses ADRs (`docs/adr/0001–0006`) and `docs/agents/domain.md`. runcastle-the-*product* does not: the shipped skill pack (`packages/skills/packs/runcastle/skills/ideate/SKILL.md`) and the injected system prompt (`renderSystemPrompt` in `packages/server/src/launcher/artifacts.ts`) name only brief/decisions/spec, never ADRs or `CONTEXT.md`.
- `sessions.feature_id` and `tickets.feature_id` are both `NOT NULL` (`packages/core/src/db-schema.ts`) — the schema currently assumes every session and every ticket belongs to a feature.
- `tickets.seams` is a stored JSON column, so cross-feature collision detection has the data it needs already.
- Mapped ideation (waypoints, ADR-0001) already solves decomposition *within* a feature. Every question on this map is about the space *between* features.
- Matt's `CONTEXT.md` (`~/.claude/skills/domain-modeling/CONTEXT-FORMAT.md`) is a *glossary* — `## Language`, tight term definitions, `_Avoid_` lists. runcastle's own root `CONTEXT.md` is a *charter* — vision, 14 locked decisions, design principles — with no glossary in it. Same filename, two documents; decision 6 merges them deliberately rather than inheriting the collision.
- **There is no agent at ship.** Session kinds are `ideation | qa | waypoint | converge | revisit` (`packages/core/src/schemas.ts`), and G5 (`human-merge`) is a UI button calling `mergeFeature` (`packages/server/src/services/git.ts`) — checkout base, `merge --no-ff`, restore. Nothing LLM-shaped runs at merge. Any behaviour a waypoint wants "at ship" is either a server-side mechanical step or a new session kind.
- `commitDocs` (`packages/server/src/services/git.ts`) stages **only** `docs/features` via `DOCS_PATHSPEC`, so nothing outside a feature's own directory currently rides a feature merge.
- **The main checkout is structurally contended.** `project.repoPath` normally holds `mainBranch`, and git refuses a second worktree on a checked-out branch — so *no* runcastle-owned worktree can be writable on the base branch. `testDrive` borrows that checkout (requires a clean tree, `DENY_DIRTY`, and flips its branch) and `mergeFeature` refuses outright while a drive is active. Any "writable on base" design is therefore either the main checkout itself or a transfer; decision 18 takes the transfer.
- `mergeTempBranch` (`packages/server/src/services/git.ts`) already handles all three landing cases: a checkout holding the target merges in place (fast-forwarding that working tree like a `git pull`), nobody holding it → `git fetch . <temp>:<target>` updates the ref with no checkout, non-fast-forward → a disposable temp worktree. Every AFK writer (burners, research runs) already lands this way on a `runcastle/*` branch.
- `mostRecentResumableSession` is keyed by `featureId`; a project-scoped session needs a project-keyed sibling (decision 19).
- Feature terminals launch `--permission-mode acceptEdits` with pre-approved `git add`/`git commit`, justified in code by talk worktrees being docs-only. That justification does not transfer to any session with whole-repo write access.
- `CLAUDE.md` in this repo already carries a hand-written spec-decay stamp ("Build-time document… some references describe build-era states the code has since moved past") — empirical proof for decision 8.

**Constraints carried in:**
- `CONTEXT.md` design principle: flexible guidance over brittle machinery — when in doubt, less mechanism. Prefer edges over new entities, presets over parallel systems.
- `CONTEXT.md` decision #7 already licenses a size-aware pipeline ("small features may collapse Spec+Tickets — explicit choice"), so the quick-change path has precedent and does not need a new entity.
- Doc types decay differently: `decisions.md` and ADRs record *why* (durable); `spec.md` records intent at a moment (decays against code). Proposed but NOT yet locked: cross-feature reads should carry decisions and briefs, never specs.
- Proposed but NOT yet locked: link, never copy — a copied doc is a second source of truth that starts drifting immediately.

**Ideas raised, parked for the waypoint that owns them:** ~~a question-shaped `why(...)` tool returning cited answers~~ (rejected, decision 14); ~~indexing burn outcomes as project knowledge~~ (settled as a facts-only work record, decision 15); recurring burner failures graduating into `CLAUDE.md` rules; cross-feature conflict detection on overlapping ticket `seams`; "main moved under you" drift warnings for long-running features; shipped features as a free changelog; the observation from `ask-matt` that Matt's flow has three on-ramps (grill / triage / diagnose) where runcastle has exactly one (New Feature).

**Converge criterion.** This map is unusual: decision 5 records that the scope is genuinely *several shippable features*, not one big one — it is a map only because runcastle cannot yet create features from anywhere but the New Feature form. Expect the converge session to cut this into a small first feature rather than one spec covering the whole destination. Decision 20 makes that call explicitly: **the project-level session ships first**, ahead of knowledge tiers + promotion.

**Handed to waypoint 8:** decision 18 leaves exactly one session in the system able to write the charter, and it is a singleton — so "what stops concurrent feature sessions clobbering the rewritten-in-place tier?" has a candidate answer (nothing else may touch it) that waypoint 8 may take or reject.

## Not yet specified

## Out of scope
