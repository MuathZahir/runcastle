## Why this exists

The human reports: runcastle always shows "main" in the titlebar and settings, and there is no way to make features branch from anything else — either project-wide or per feature at creation. Investigation confirmed three concrete gaps; the plumbing underneath is mostly already correct, which bounds this feature tightly.

## What is already true (verified against source — do not rebuild)

- **Per-feature base branches work end-to-end in the backend.** `createFeature`, `startDraft`, and the quick-change path all accept `baseBranch` (`packages/server/src/services/features.ts:117,236,289`), and a feature **merges back into its base branch**, not blindly into main (`packages/server/src/services/git.ts:201` — `feature.baseBranch ?? project.mainBranch` — and `:2523`, merge lands on the branch the feature was cut from). Git topology needs no changes.
- **Drafts already have a picker.** A parked draft's card shows a base-branch picker at Start (`DraftBody`, wired in `Workspace.tsx:578-583`), defaulting to the current checkout.
- **Quick changes default to the current checkout** (`QuickForm.tsx:62`, `defaultBaseBranch` in `apps/web/src/lib/feature-ui.ts:24` — current branch if selectable, else mainBranch).

## The three gaps

1. **Project level: detection clobbers everything.** `initProject` re-detects `mainBranch` on *every project open* and overwrites the DB row (`packages/server/src/services/projects.ts:80-89`; detection order in `git.ts:250`: origin/HEAD → local main/master → current branch → "main"). The settings entry is read-only by design ("git-detected", `SettingsOverlay.tsx:27`), and the global `RUNCASTLE_MAIN_BRANCH` config is only a fallback for when detection *throws*. Net: no way to say "this project's features default to branch X".
2. **The intake path — now the main door — has no branch affordance.** Since the ux-issues redesign (its decisions.md #12: "New talks it through, Quick types it in"), "New" opens the project conversation and features are created via the `create_feature` MCP tool, which defaults `baseBranch` to `project.mainBranch`. Nothing prompts the project-session agent to ask, and the human never sees the choice. A feature started straight from intake never passes through the draft picker.
3. **Inconsistent silent defaults.** Quick form defaults to *current checkout*; intake defaults to *mainBranch*. Two doors, two different silent answers to the same question.

## Design questions for the grill (unresolved — this is what ideation is for)

- Should the per-project setting be an *override* layered on detection? If so, when (if ever) may detection update the value again — e.g. the repo's actual default branch is renamed? A plausible shape: detection fills the value only when unset; an explicit setting wins forever until cleared. But "show me what detection currently thinks" may still be worth surfacing.
- What should the intake default be — mainBranch, current checkout (consistent with Quick), or should the project-session briefing tell the agent to ask when the human's checkout differs from the default? The agent-asks option is cheap here because intake is already a conversation.
- Where does the chosen base become *visible*? The feature card, the titlebar, the review/merge surface ("will land on X")? A silent default the human can at least see is half the fix.
- Does the settings mainBranch field become editable per project (it currently has no projectColumn — it is global-config-only, `packages/server/src/services/settings.ts:199-206`), and what does the titlebar show when the override differs from detection?

## What this must NOT swallow

- **Git topology.** Merge-target-follows-base already works (`git.ts:201`, `:2523`). No changes to merge, worktree, or branch-cut mechanics beyond where the *default* comes from.
- **The draft-Start picker.** It works; at most it inherits the new default.
- **A redesign of the intake conversation or the New door.** The ux-issues decision ("New talks it through") stands; this feature only gives that conversation a branch affordance, not a new shape.
- **Multi-remote / release-train branch management.** One default plus per-feature choice is the scope; anything like "track release branches" is a later feature.
