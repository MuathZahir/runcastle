## Purpose

The human, 2026-11-06: "there's not much grilling going on." After a cut is agreed, the orchestrator's working-agreement step asks how far it carries the work (autonomous / checkpoints / check-in after each feature) but never how each feature gets planned, so everything defaulted to `plan_feature` (self-planning, no human). "Some features need a full grill, no 'plan it yourself'. If the feature is important or big, I would usually like to get grilled so we're on the same page before implementing." The agent should recommend which features go through the grill.

## What changes

A prompt change in the project skill (`packages/skills/packs/runcastle/skills/project/`), in the working-agreement / cut-proposal part of Orchestrating:
- When proposing a cut, give each feature a recommended **planning mode** — "grill with you" or "plans itself" — with a one-line reason, and let the human confirm per feature.
- Recommend a grill when the feature shapes how the human works or what they see, is big or hard to undo, or has open questions its brief marks as the human's. Bug fixes and well-specified mechanical work plan themselves.
- Record the planning mode in each feature's brief, next to the working agreement, so it survives a compaction.
- For a "grill with you" feature, the orchestrator never calls `plan_feature`; when its turn comes it tells the human to open the feature's chat (and notifies them if they seem away). After the human's grill ends with a yes in that chat, the orchestrator carries on per the agreement.
- The three ways of running a cut stay unchanged.

## Must not swallow

- The feature lead's own grilling skill (unchanged).
- Any UI for choosing a planning mode — this is prompt-only.

## Ordering

Waits on `tools-and-skills-say-less`, which is splitting the project skill into a core file plus references right now; editing the same file in parallel would conflict. Up next: starts by itself when that merges.

## Working agreement (agreed 2026-11-06): autonomous

The orchestrator carries this to merged and shows the human the new wording in its report. Planning mode: plans itself (a small prompt change).
