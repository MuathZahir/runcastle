# Decisions — base-branch-control

## 1. Intake states the base; it does not ask for it
**Decision:** The project-session (intake) agent never adds a routine "which branch?" question. When proposing a `create_feature`, it **states** the base it will cut from as part of the confirmation ("cutting `feature/foo` from `develop` — say so if it should fork elsewhere"); the human overrides conversationally and the agent passes the override as `baseBranch`. The agent asks explicitly only when there is a signal the default is wrong (release line, hotfix, stacking on another feature — or its own objection, see #2).
**Why:** Intake already asks start-vs-park per feature; a second obligatory question per feature turns the chat into a form. A stated base is still a visible choice — the brief's requirement — at zero friction on the happy path.

## 2. The base is agent-selected: assume the current branch, say so, pass it explicitly
**Decision:** No new mechanical default on the server. The intake agent **assumes the feature branches off the project checkout's current branch**, mentions that assumption when proposing the create, and passes it explicitly as `baseBranch`. The agent may object to its own assumption when the current branch looks wrong (unrelated line, stale, another feature's branch) and propose a better base. If `baseBranch` is somehow omitted (which shouldn't happen), the server falls back to the current checkout branch — never a stored main-branch column (see #4).
**Why:** The branch the human is checked out on is the branch they chose to work on; "always main" was silent only because the agent never passed anything. Fixing the convention (skill text) fixes the behavior without adding resolution machinery to the service.

## 3. Review-ticket workflow diffs against the feature's own base
**Decision:** `review-ticket.ts` stops passing `project.mainBranch` as `BASE_BRANCH` and passes `feature.baseBranch` instead.
**Why:** For a feature cut from `develop` (or another feature), reviewing its diff against main reviews commits that aren't the feature's. This is a latent bug the base-branch work exposes; it rides along here.

## 4. `project.mainBranch` is deleted
**Decision:** The `mainBranch` column, its detection-at-open, the `RUNCASTLE_MAIN_BRANCH` config/settings key, and `BranchList.mainBranch` all go. No feature path reads it (base is always explicit/recorded); the few project-level consumers that need "the repo's main line" as a measuring stick (findings staleness, dry-run verification stamps) detect it on demand instead of reading a stored column.
**Why:** A stored, detection-refreshed column is exactly the silent state this feature exists to remove, and every consumer either has a better source (the feature's recorded base, the project session's own setting) or only needs a cheap on-demand detection.

## 5. The project session's landing branch is its own visible, per-project setting
**Decision:** Where the project session's work lands (charter, ADRs — today `project.mainBranch`) becomes a dedicated setting, presented as a picker placed at the project session surface itself — visible where it applies, named for what it does ("this chat's work lands on: X") — not a general "main branch" field buried in settings. Detection may pre-fill it; it never overwrites a human's pick.
**Why:** Nobody would guess that "main branch" controls where the New-chat's commits land. A control is only a control if you can see it next to the thing it controls.

## 6. Session-branch setting: null until picked, effective value shown, next-launch effect
**Decision:** The stored session-branch value is null until a human explicitly picks; the picker displays the effective value (stored if set, else detection run at display time), so a zero-config project needs no setup step. Only an explicit pick writes the column. A pick made while a project session is open takes effect at the next session launch — the live session's branch was already cut.
**Why:** Keeps "detection never overwrites a human's pick" without forcing every project through a mandatory setup click; retargeting a live session mid-flight would move commits underneath it.

## 7. Unselectable checkout = the one case the agent must ask
**Decision:** When the project checkout's current branch is not a selectable base (a `feature/*` branch, e.g. mid test drive, or detached HEAD), the intake agent does not guess: it asks the human where to cut from, explaining why the default is unavailable and offering the detected main line as its suggestion. To make this work, `get_project_context` grows the current branch and the selectable branch list (local non-`feature/*` branches plus remote-only lines), so the agent can state its assumption, spot the unselectable case, and validate a conversational override without a failed `create_feature` round-trip.
**Why:** Mid-drive the checkout is parked on something unrelated — every silent substitution is wrong there. Asking is reserved for exactly the case where the default has no answer.

## 8. Quick form shows a mandatory base select; no surface cuts silently
**Decision:** The Quick door's quick-change mode gains a visible base select, prefilled with the current checkout branch, mandatory — when the checkout is not a selectable base it starts empty and blocks submit until the human picks. Park-a-draft stays baseless (base is chosen at Start, as today); the Start picker's default likewise becomes current-branch-else-empty-and-mandatory, with no main fallback. The rule across all surfaces: anything that cuts a branch shows the base it will use; nothing falls back silently.
**Why:** The quick-change base was the last silently-chosen one. Prefill keeps the happy path at zero extra clicks; the empty-and-mandatory state surfaces the one situation where any default would be a guess.
