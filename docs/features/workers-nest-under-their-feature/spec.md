# Workers nest under their feature

## Problem
A feature's workers live on a separate sidebar page, reached by the "›" arrow on the feature's row. To see a worker the human has to go down a level, and a worker that needs them sits on that hidden page instead of in the list they are looking at. The page's header and Lead card repeat what the feature row already does.

## Approach
From the human's side: the features list stays the only list. Under each feature row sit its live workers as indented two-line rows: needs you and failed first, then working, idle and queued (decisions 2, 11, 13). Under the feature that is open, a folded "N done" line holds its finished workers and its old side and drive chats (decisions 3, 4). A chevron on any feature row with workers under it folds and unfolds them. Rows start unfolded, and the choice is remembered per feature on this browser (decision 9). Hovering an in-progress feature row shows "+" to start a new worker (decision 5). Clicking a worker row opens its chat exactly as today. The "›" arrow and the drill-in page are gone (decision 1). The phone list is unchanged (decision 8).

The shape of it:

- **Server: one project-wide list of live workers.** A new `worker` router query takes a project id and returns every feature's workers whose status is not handed-back, landed or dropped, in the same `ListedWorker` shape `worker.list` returns, each carrying its `featureId`. The web groups them by feature. It refetches on every `worker.*` event, like the existing worker queries. The feature list's `workersPage` field, and the service function that fills it, only fed the arrow, so they go.
- **Web: nested rows in the sidebar.** The feature row (`SidebarFeatureRow`) gains its workers beneath it, drawn with the existing worker row (`SidebarWorkerItem`) at the nested indent. It also gains a fold chevron and a hover "+". This applies wherever a feature row is rendered: under epic cards, the "Other features" card, and the Backlog, Shipped and Archived shelves (`SidebarEpics`) (decision 11). While a feature is unfolded, a worker's need shows only on the worker's own row; folded, it rolls up to the feature row (decision 12). The open feature's done workers and old chats come from what its page already publishes (`worker.list` and its threads, merged as `featureWorkerEntries` does today), grouped by `workerGroups`. The drill-in components (`FeatureSidebar`, `FeatureSidebarPage`, `FeatureSidebarHeader`, `WorkersArrow`) and the sidebar's down/up state are removed. The lead chat's rename and export already sit in the open feature row's "…" menu. Each worker row keeps its own menu: rename, export, and copy the branch name while the worker is live.
- **Autopilot.** A feature locked to its epic's run passes its lock to its worker rows: they show the lock mark and never the amber dot (decision 7).
- **Look.** Existing rows, tokens and spacing only (`apps/web/STYLE.md`). The finish is the bar: aligned glyphs, a quiet indent guide if it reads better, hover and active states matching the feature rows, and fold motion at the app's own durations (decision 10).

## Seams
- **`worker` router, new project-wide live list** (new): given a project with features in each worker status, it returns exactly the live ones, with `featureId`. Server test.
- **The sidebar component** (existing, `Sidebar`/`SidebarParts`): given features and live workers, a feature row renders its live workers beneath it in the right order. Its "N done" line shows only when the feature is open. Unfolded, a worker's need shows on its own row only; folding hides the rows and rolls the need dot up to the feature row. "+" shows on in-progress rows only. Component tests at the project's existing tier (`apps/web/STYLE.md`).
- **The scenario "Feature with workers"** (existing, `.runcastle/scenarios/workers/`): the driven check that a worker needing you shows under its feature, and that clicking it opens its chat.

## Out of scope
- What workers are and how they run: this is sidebar placement only.
- The worker chat (`WorkerChat`), unchanged.
- The phone layout (decision 8).
- The project's own workers section ("Project workers"), unchanged.

## Open questions
None.
