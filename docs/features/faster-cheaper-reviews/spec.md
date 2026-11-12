# Faster, cheaper reviews

## Problem

A review takes 4 to 4.5 minutes, and about 1.5 to 2 of them are the review sitting
idle while the project's full test suite finishes. That suite already ran when the
lead last landed or committed code, on the same commit, so the review's run tells
nobody anything new. And every review runs on the chat's model (Opus with the 1M
context), because the "Review" model row in Settings is ignored: the human can
neither save money on reviews nor try a cheaper model and compare.

## Approach

From the human's side: reviews run on Sonnet unless they choose otherwise in the
Settings "Review" row, and that row now actually decides. A review whose branch
has not moved since the lead's green checks runs only the typecheck, cites the
lead's pass, and finishes sooner. Nothing about a review's findings, package or
drive changes.

**The review model (decisions 1, 4, 5, 6).** A Review worker started with no
model resolves through the `review` model step, not the `chat` step. The chain
stays the existing one (a per-project model override, then the step's own
setting, then the default) with one change: an unset `review` step falls to a
per-runtime review default instead of the global model. The default sits beside
the existing per-runtime flagship and smoke defaults: Sonnet (`claude-sonnet-5`,
bare, not 1M) for Claude Code, `gpt-5.6-terra` for Codex, picked by the runtime
the global model runs on. It must apply even when the config file holds a
`stepModels` object without a `review` key (a zod default only fills an absent
object). The settings service reports that default on the Review row as its
`default` value, and the web Review row's description says it is the model the
Review worker runs on. Verify reviews use the same step. A model passed to
`start_review` still wins, and must still be an annotated model. The human's
stored value is never rewritten (decision 4). The `start_review` tool's `model`
description says omitting it means the Review setting. The stale comments that
call `review` the burn's review pass (config) or say it is never exposed (a test)
are corrected.

**Once-per-commit checks (decisions 3, 7, 8, 9).** `start_review` takes an
optional `checksPassed: { commit: string, commands: string[] }`, valid for both a
first review and a verify review. The server stores nothing and checks nothing;
`renderReviewAssignment` turns it into a block inside "The project's checks"
section of both the review and verify assignments. Without it, the section reads
as today. With it, the block tells the review, in order:

1. The lead ran these commands (listed) on commit `<sha>` on a clean tree, green
   apart from the known failures.
2. Run `git rev-parse HEAD` and `git status --porcelain --untracked-files=no`, and
   `git diff --quiet <sha> HEAD -- . ':!docs/features/<slug>/'`.
3. If the tree is clean and HEAD is `<sha>` or the diff is quiet, run only the
   typecheck among the checks (none if no check is a typecheck) and say in the
   hand-back that the rest were not run, citing the lead's pass on `<sha>`. Never
   call a cited check one you saw pass.
4. Otherwise run every check in full, as today, and say why the pass did not
   apply.

The feature lead's skill changes to match:

- Before `start_review` (first or verify): commit everything, run the project's
  full checks, fix until green apart from known failures, then pass
  `checksPassed` with the commit and the commands run. A red pass is never passed.
  This is normally the run the lead already makes after its last landing or code
  commit (decision 9).
- `start_review` names no `model` unless the human asked for one (decision 6).
- Before `declare_ready`: skip the checks when HEAD is the last green pass's
  commit, or differs from it only inside this feature's docs folder, on a clean
  tree; otherwise run them.

The lead skill's SKILL.md, its workers reference ("The review"), the review and
verify assignment files and the `start_review` tool description are the only
guidance that changes. No gate, no server-side record of check runs, no new
setting.

## Seams

- **Worker model resolution** (existing: the function that picks a worker's model,
  `workerModel`, through core's `resolveModelEntry`). Observe: a review with no
  model gets the `review` step value when set; the per-runtime review default when
  unset (including with a partial `stepModels`); a per-project model when set; an
  explicit annotated model when passed; ordinary workers still get the `chat`
  step.
- **Settings model fields** (existing: the settings service's step-model fields).
  Observe: the Review row's value and `default` source show the new default when
  unset, and the stored value when set.
- **Review assignment rendering** (existing: `renderReviewAssignment`, new input
  `checksPassed`). Observe: review and verify assignments with and without the
  field; the block names the commit, commands and the feature's docs path; no
  unfilled placeholder.
- **`start_review` MCP tool** (existing schema, new optional field). Observe: the
  field validates and reaches the assignment; the `model` description.
- **Feature skill text** (existing `feature-skill.test.ts` style). Observe: the
  skill tells the lead to pass `checksPassed`, to omit `model`, and when
  `declare_ready` may skip the checks.

## Out of scope

- Splitting a review into a cheap driver and a strong judge (decision 2; it went
  to "Agents test like owners").
- Per-feature scenarios and the lead's own drive-and-fix loop ("Each feature's own
  scenarios", "Agents test like owners"). All three features edit the feature
  lead's skill; expect small text conflicts at merge.
- Updating the curated model list to newer model generations.
- Any server-side record of check runs, or a gate on them.

## Open questions

- Plain Sonnet has a smaller context window than the 1M variants. Long drive-mode
  reviews full of screenshots may fill it and compact midway. Watch the first
  reviews after this lands; do not change the default up front.
- The human's own Review row is set to Opus 1M (decision 4). Until they change it,
  their reviews gain the shorter run but not the cheaper model.
- Skill and assignment changes reach live sessions only after a publish and
  reinstall of the global runcastle package.
