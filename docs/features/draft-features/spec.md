# Draft features

## Problem

Capturing an idea in runcastle today costs a git branch. Every creation door — the New Feature form (even "Create without starting"), the project session's `create_feature` — cuts `feature/<slug>` off a base branch and commits a scaffolded `brief.md` the moment the feature exists. For ideas the human intends to work *later*, that is exactly wrong: the branch goes stale while the idea sits, the repo accumulates branches for features that may never happen, and draft scribbles get committed to whatever branch was checked out. Worse, there is no way to defer at all from inside a grill session — when scope creep surfaces mid-conversation ("that's its own feature"), the agent has nowhere to put it, so it either swallows the current feature or evaporates when the terminal closes.

The human wants a shelf: create a feature as a parked *draft* — title, one-liner, brief, no branch, no repo side effects — and cut the branch only at the moment they click **Start** and actually begin working it.

## Approach

From the human's perspective: the New Feature form's second button becomes **Save as draft** — title, optional one-liner, done; no base-branch picker on that path. The draft appears in the rail as its own band below active work (dimmed `◌` glyph, a "Draft" chip instead of an age chip). Opening it shows the brief, and the next-step bar offers the one next step: **Start**, with the base-branch picker behind an Advanced disclosure and Delete in the usual overflow spot. Clicking Start resolves the base *at that moment*, cuts the branch, writes and commits `brief.md`, activates the feature, and opens the grill session — one click from parked idea to live conversation. Agents get the same shelf: the project session can park intake features as drafts (asking the human per feature: start now or park?), and feature talk sessions can deflect mid-grill scope creep into a draft instead of swallowing it.

The shape underneath (decisions 2–4): **a draft is a DB row and nothing else.**

- `FeatureStatus` grows a fourth value: `draft | active | shipped | archived`. Phase is untouched — a draft is created at phase `ideation` like any feature; status alone says "not live yet." A new nullable `brief` text column on the features table holds the brief prose while parked. The `branch` column keeps storing the computed `feature/<slug>` name at creation (no nullable migration); `status: 'draft'` alone means the branch does not exist yet. `baseBranch` stays null while parked — the base is chosen and resolved at Start, defaulting to the same current-checkout-falling-back-to-main logic the form uses.
- **Draft creation** is the existing create path minus every side effect: no branch cut, no docs scaffold, no auto-commit — insert the row (status `draft`, brief in the column), emit the creation event marked as a draft. Slug uniqueness works exactly as today.
- **Start** is a new service verb + tRPC mutation: guard that the feature is a draft, resolve the requested-or-default base, cut the branch via the existing ensure-branch path, flip status to `active` and record the resolved base, scaffold `brief.md` from the stored column via the existing verbatim-brief scaffold path, auto-commit it (same best-effort semantics as create), and emit `feature.started` carrying branch + base. The client chains the grill-session launch after the Start mutation, mirroring the form's existing create-then-launch pattern. No rollback machinery: a branch-cut failure leaves the draft intact; a launch failure after activation leaves an active session-less feature, a state the ideation screen already handles. After Start, `brief.md` on the branch is the source of truth; the column value remains as a historical artifact.
- **Guards** (decision 8): a draft's verb set is Start and delete. Every door that treats a feature as live — session launch (any kind), burn, advance, test drive, merge, rethink, work-waypoint, converge — refuses drafts with an explicit status check and one consistent message: "`<slug>` is a draft — click Start to cut its branch and begin." Archive is also refused (unarchive's phase-based status derivation would resurrect a draft as active-without-a-branch). Delete works unchanged — with no branch, worktree, or sessions, the existing delete path degrades to pure row deletion.
- **MCP `create_feature`** (decisions 5–6): gains optional `draft: boolean` (default false). Project sessions keep full power, now with the option to park. Feature-scoped talk sessions (ideation, revisit, waypoint, converge) may now call the tool, but only with `draft: true` — a full create or the quick-change `ticket` shape from a feature session gets a legible refusal pointing at the project session; `qa` stays excluded entirely (read-only contract). The draft's project is derived from the session's feature. The project skill's intake step asks the human per feature: start now or park as draft. Quick change never drafts.
- **Web** (decision 9): rail sort gains a draft band (needs-me → active → **drafts** → shipped); drafts claim no attention (no needs-me, no age chip). The wire `Feature` shape exposes `brief` so the draft body can render it. The New Feature form's draft path sends no base branch; its full-create path is unchanged.

## Seams

Existing, service layer (where the server's tests already sit):

- **Feature service create/start** — create-with-draft observable as: row status `draft`, brief column set, no branch in the repo, no docs on disk, no commit. Start observable as: branch exists off the resolved base, `brief.md` scaffolded and committed, status `active`, `feature.started` emitted. Failure cases: Start on a non-draft refuses; branch-cut failure leaves the draft row unchanged.
- **Feature service guards** — each live-feature verb (burn, advance, rethink, archive, test drive, merge, waypoint/converge doors, session launch) refuses a draft with the canonical message; delete succeeds on a draft.
- **MCP tool functions** (`toolCreateFeature` and its session-kind gating) — project session full power ± draft; feature talk session draft-only (full create and `ticket` shape refused); qa refused. Pure over ctx + session row, unit-testable exactly like today.
- **tRPC feature router** — thin delegation; the new Start mutation and the extended create input are exercised through the service seams.
- **`feature-ui` pure functions** (web, already unit-tested) — sidebar sort places drafts below active and above shipped; row chip says "Draft"; needs-me is null for drafts; glyph is the draft glyph.

New:

- **`feature.start` mutation / `startDraft` service function** — the one genuinely new public boundary; everything above observes through it plus the existing seams.

## Out of scope

- Editing a parked draft (title, one-liner, brief) — see Later laps.
- Drafts for quick changes — a quick change is born at `implementation` about to burn; parking is antithetical.
- Archiving drafts, and any `prevStatus` machinery to support it.
- Reordering / prioritizing drafts in the rail.
- Any change to phases, gates, laps, or the pipeline itself — drafts live entirely on the status axis.
- Draft creation from `qa` sessions.

## Later laps

- **Draft editing** (decision 10): an edit surface for parked drafts — title edits implying slug/branch-name recomputation, one-liner and brief edits. Add if test-driving shows drafts rotting for want of it.

## Open questions

- None blocking. One behavior accepted as-is: a draft parked for a long time can find its recorded branch name taken at Start (someone cut it manually, or a same-slug feature existed historically); Start surfaces the git error and the draft stays intact — retry after resolving. Rare enough to not deserve machinery on lap 1.
