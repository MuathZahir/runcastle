# Project model overrides global step models

Model resolution today (packages/core/src/config.ts:328-338) is `runOverride ?? config.stepModels[step] ?? project.model ?? config.model`. That means a global per-step model (Settings → Advanced — per-step models) silently beats a project's own `model` setting — backwards from the intended semantics, confirmed by the human: the global step models are the machine-wide default setup, and anything set in a project's settings should override them for that project. 

Fix: reorder to `runOverride ?? project.model ?? config.stepModels[step] ?? config.model` in `resolveModel`. Per-project *per-step* overrides are deliberately NOT being added — the single per-project `model` is the whole override surface; a per-project step matrix was considered and rejected as a 10-cell grid nobody fills (add later only if a real project demands it). 

Update the doc comment above `resolveModel` (it states the old precedence chain) and any settings-UI copy that describes the order, and adjust/extend the existing tests that pin the resolution order (packages/core/test/config.test.ts covers config; grep for resolveModel tests). 

Acceptance: with global stepModels.ideation set and a project `model` set, launching an ideation session on that project uses the project's model; on a project with no `model`, the global stepModels.ideation still applies; runOverride (per-run override, e.g. the burner's) still beats everything; typecheck + vitest green.
