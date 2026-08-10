# Draft features — decisions

## 1. One lap, whole spec, no map
**Decision:** The feature is one-session-sized and low-uncertainty: spec the whole thing in one lap, no waypoint map.
**Why:** The design tree is narrow — one new status value, a deferred branch cut, a Start action, guards, and UI affordances. Nothing needs research or prototyping before decisions can lock.

## 2. Draft is a FeatureStatus value; the branch name is recorded but not cut
**Decision:** Add `draft` to `FeatureStatus` (`draft | active | shipped | archived`). The `branch` column keeps storing the computed `feature/<slug>` name at creation — `status: 'draft'` alone means the branch does not exist yet. No nullable-column migration.
**Why:** Phase describes pipeline position; a draft is not in the pipeline at all, and status is already the "is this thing live" axis. Keeping `branch` notNull avoids `string | null` rippling through every consumer, and there is precedent: pre-B2 features recorded a branch name with no real branch behind it.

## 3. Base branch is chosen at Start, not at draft creation
**Decision:** Drafts take no base branch at creation — `baseBranch` stays null while parked. The Start action accepts an optional `baseBranch`, defaulting to the same current-checkout-falling-back-to-main logic the New Feature form uses today, resolved at Start time.
**Why:** A draft can sit parked for weeks; a base resolved at creation could be stale or deleted by Start. And draft creation should stay cheap idea capture — no picker for a value that is usually the default anyway.

## 4. The brief lives in a nullable `brief` column while parked
**Decision:** A draft is a DB row and nothing else: the brief text is stored in a new nullable `brief` column on `features`. No repo writes, no commits, until Start — where the existing `scaffoldDocs` verbatim-brief path writes `brief.md` from the stored text. After Start the file on the branch is the source of truth; the column value stays as a harmless historical artifact.
**Why:** Writing `brief.md` at draft creation would auto-commit draft scribbles to the current branch (main). A DB-only draft keeps the repo untouched for ideas that may never happen, makes delete-a-draft trivial row deletion, and reuses the scaffold machinery at Start with zero new concepts.

## 5. Which creation doors produce drafts
**Decision:** New Feature form: "Create without starting" becomes "Save as draft" (park it) beside "Start grill session" (full create: branch + session) — no third button, and no UI path to an active-but-unstarted feature with a branch. `create_feature` MCP: gains optional `draft: boolean` (default false); the project skill asks the human per feature whether to start now or park. Quick change: never a draft.
**Why:** "Create without starting" already meant "not working on this now" — cutting a branch there bought nothing and is the stale-branch problem drafts solve. Active-but-unstarted-with-branch was an accident of the old mechanics. Quick change is born at implementation about to burn; parking is antithetical to it.

## 6. Feature sessions may create drafts — and only drafts
**Decision:** `create_feature` becomes callable from feature-scoped talk sessions (ideation, revisit, waypoint, converge), but there it requires `draft: true` — a full create or the quick-change `ticket` shape gets a legible refusal pointing at the project session. The draft's project is derived via `projectForFeature`; the agent passes `brief` with the deferral reasoning. `qa` sessions stay excluded (read-only contract).
**Why:** "Park this for later" is the legitimate mid-grill move — scope creep deflects into a draft instead of swallowing the current feature. Full feature creation stays the project session's job; a grill that can spawn live features becomes an orchestrator. Per-kind gating on one tool follows the `dry_run_drive` precedent.

## 7. Start = branch + docs + activate + grill session, one click
**Decision:** Start on a draft: (1) resolve base (explicit pick or default logic, at that moment) and cut `feature/<slug>` via the existing `ensureFeatureBranch` path; (2) scaffold `brief.md` from the stored `brief` column and auto-commit, like today's create; (3) flip status `draft → active`, emit `feature.started` with branch + base; (4) open the grill session in the same click. Phase stays `ideation` throughout (drafts are created at phase `ideation`).
**Why:** Clicking Start on a parked idea means "I'm working on this now" — a dead ideation screen plus a second button is friction with no upside. No rollback machinery needed: branch-cut failure leaves the draft intact; a launch failure after activation leaves an active session-less feature, a legitimate state the ideation screen already invites you back from.

## 8. A draft's verb set is Start and delete; archive is refused
**Decision:** Everything that treats the feature as live — launchSession (any kind), burn, advance, testDrive, merge, rethink, workWaypoint, converge — refuses drafts with an explicit status check and one consistent message ("`<slug>` is a draft — click Start to cut its branch and begin"). Delete works via the existing `deleteFeature` (all git steps no-op; pure row deletion). Archive is refused for drafts.
**Why:** Explicit checks at the mutation doors beat misleading incidental failures. Archive is refused because `unarchiveFeature` derives restored status from phase and would resurrect a draft as active-without-a-branch (corrupt); fixing that needs a `prevStatus` column just to hide something already parked — a draft IS the shelf, and delete covers dead ideas.

## 9. UI presentation: drafts are a rail band below active, and Start is the next step
**Decision:** Rail: drafts sort as their own band below active work, above shipped; row chip says "Draft" (replacing the age chip) with a dimmed `◌` glyph instead of a phase glyph. Feature screen: the draft body shows title, one-liner, and the brief rendered from the DB column; the next-step bar shows Start as the one next step, with the base-branch picker (same component as the New Feature form's) behind an Advanced disclosure; Delete in the usual overflow spot. No pipeline stepper progress.
**Why:** Parked ideas should not interleave with things in motion but are more alive than shipped history. "Last activity 3w ago" on a parked idea is noise. A draft has no meaningful pipeline position, so no phase glyph and no stepper — and the pipeline-first next-step bar already knows how to say "here is the one thing to do next."

## 10. Draft editing is deferred to a later lap
**Decision:** No edit surface for parked drafts in lap 1 — title, one-liner, and brief stay write-once at creation, as everywhere else in the app. Parked in `## Later laps`.
**Why:** The brief becomes a versioned file the moment Start is clicked, and the grill session is exactly where you would correct it anyway. An edit UI (title edits implying slug/branch-name recomputation) is real surface area for a marginal pre-Start convenience; if drafts rot without it, lap 2 adds it with evidence in hand.
