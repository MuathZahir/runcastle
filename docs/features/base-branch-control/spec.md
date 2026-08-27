# Base branch control

## Problem

Every feature silently cuts from — and merges back to — a stored "main branch" the human never chose. The chat intake ("New") omits `baseBranch` entirely, so agent-created features always fork off `project.mainBranch`; the quick-change overlay picks a base with no visible control; and the stored `mainBranch` itself is re-detected and overwritten on every project open, so even a corrected value doesn't stick. The same hidden column also decides where the project session's charter commits land and which line the review workflow diffs against — two behaviors nobody would guess it controls. The human should always see, and be able to change, the branch a feature cuts from; the review of a feature should diff against the branch it actually forked off; and where the project chat's work lands should be an explicit, visible, per-project choice.

## Approach

From the user's perspective: when they ask the intake chat for a feature, the agent *tells them* which branch it will cut from — their current checkout branch, by default — and they change it just by saying so. The quick-change overlay shows a base select, prefilled with the current branch. The project page shows, next to the project chat, which branch that chat's work lands on, as a picker they can set once and have respected forever. Nothing that cuts a branch ever falls back silently, and the wrongly-detected "main branch" that could never be corrected no longer exists.

The shape of it:

**`project.mainBranch` is deleted** — the column, its detection at project open, the `RUNCASTLE_MAIN_BRANCH` config/env/settings key, and the `mainBranch` field of the branch-list payload (decision 4). The `detectMainBranch` heuristic itself survives in the git service as an on-demand measuring stick: findings staleness and dry-run verification stamps call it when they need "the repo's main line" instead of reading a stored column, and it supplies the pre-filled/suggested values below. Project open no longer detects or stores anything branch-related.

**Feature paths read only the feature's own recorded base.** The merge target becomes `feature.baseBranch` with no project-level fallback; talk-worktree branch recreation likewise. A migration backfills `baseBranch` for existing non-draft rows from the old `mainBranch` value before the column drops (drafts stay null — they pick at Start). The service-level fallback when `baseBranch` is omitted on create/quick-change/start — which no longer happens from any shipped caller — is the checkout's current branch, never a stored default (decision 2). The review-ticket workflow's fork-point ref becomes `feature.baseBranch`, fixing the latent bug where a feature cut from a non-main line was diffed against main (decision 3).

**Chat intake states the base** (decisions 1, 2, 7). `get_project_context` grows the checkout's current branch and the selectable base list (local non-`feature/*` branches plus remote-only lines), same vocabulary as the existing branch-list query. The project-session skill text gains the convention: assume the current branch, mention it in the create proposal ("cutting `feature/foo` from `develop` — say so if it should fork elsewhere"), pass it explicitly as `baseBranch`; object when the current branch looks wrong; ask only on a real signal — or when the current branch is unselectable (`feature/*` mid-drive, detached HEAD), where the agent must ask and offers the detected main line as its suggestion.

**The project session's landing branch becomes its own per-project setting** (decisions 5, 6) — a nullable column, human-owned, exposed through the project settings surface and rendered as a picker at the project-session surface itself, labeled for what it does (where this chat's work lands), not as a generic "main branch". Resolution is: stored value if set, else `detectMainBranch` at read time. Only an explicit pick writes it; detection never does. Project-session worktree cut, end-of-session landing, and the session's injected prompt text all read the resolved value. A pick while a session is live applies at the next launch. If a stored pick names a branch that no longer exists, the session launch fails loudly with a message pointing at the picker — no silent re-detection.

**Every cutting surface shows its base, mandatorily** (decision 8). The quick-change overlay gains a visible base select, prefilled with the current branch; the draft Start picker keeps its place but loses the main fallback. In both, an unselectable checkout yields an empty, mandatory input that blocks submit until the human picks. The shared client-side default helper becomes "current branch if selectable, else empty" — no fallback branch.

## Seams

- **`create_feature` MCP tool / features service** *(existing)* — observe that an explicit `baseBranch` is resolved, recorded, and the branch cut from it; that omission falls back to the checkout's current branch; that drafts record null and resolve at Start.
- **`get_project_context` MCP tool** *(existing, extended)* — observe the new current-branch and selectable-branches fields the intake agent depends on.
- **Merge / `mergeTarget` in the git service** *(existing)* — observe that a feature lands on its recorded base with no project fallback, including backfilled legacy rows.
- **Branch-list tRPC query (`project.branches`)** *(existing, shape change)* — observe `mainBranch` gone; `current`, `branches`, `remoteBranches` unchanged.
- **Project settings surface (tRPC settings get/set)** *(existing, new key)* — observe the session-branch setting: null until picked, explicit pick stored, detection never writing it.
- **Session-branch resolution + project worktree lifecycle** *(new resolution point over existing functions)* — observe stored-else-detected resolution feeding worktree cut, landing, and prompt text; the loud failure on a vanished stored branch.
- **Review-ticket workflow env** *(existing)* — observe `BASE_BRANCH` = the feature's recorded base.
- **Findings list / dry-run stop** *(existing)* — observe staleness and verification stamps computed against on-demand detection, unchanged numbers on a main-line repo.
- **Drizzle migration** *(new)* — observe the backfill (non-draft null bases ← old `mainBranch`) then column drop; new nullable session-branch column.
- **Web UI: quick-change form, Start picker, session-branch picker** *(existing components, one new)* — observe mandatory base select behavior and the empty-and-blocking unselectable state.

## Out of scope

- No per-project *feature-base* default and no precedence machinery — the base is agent-selected in chat and human-selected in forms, per creation (explicitly rejected during ideation).
- No retargeting of a live project session when the session-branch pick changes; next launch only.
- No rebase/retarget of an existing feature's recorded base after creation.
- No multi-remote or remote-HEAD management beyond what `resolveBaseBranch` already does.

## Open questions

None — remaining choices (exact setting/column name, picker placement within the session surface, copy) are implementation detail bounded by the decisions above.
