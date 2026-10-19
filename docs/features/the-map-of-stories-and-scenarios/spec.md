# The map of stories and scenarios

## Problem

Runcastle's sidebar answers "what needs me right now?", which is right for supervising agents. It cannot answer "what is my app?".

A developer's stories (UI states), scenarios (ways in) and `.http` calls already exist in their repo, but they are scattered:
- stories show only on a feature's review page, and only the ones that feature touched;
- scenarios show only in a drive's picker;
- calls show only in a live drive's API view.

Nothing shows the app as a whole, by the names the developer uses for it (Checkout, Auth). Nothing says which features shaped each part. Main's story catalogue isn't even built today: a feature's catalogue is built at review and deleted at merge.

Lap 1 has to answer one question honestly: does pulling stories, scenarios and calls together per product group, with feature history beside each entry, beat Storybook's own sidebar? If not, nothing more gets built.

## Approach

### What the developer sees

**The sidebar** (decisions 2, 9), top to bottom:
- the project switcher, Create menu and search, unchanged;
- the **Project** row, unchanged, with Prepare beneath it while owed;
- the **Inbox**, pinned in both views.
  - It is today's *Needs you* lane, lifted out of the lane list, showing the feature rows themselves.
  - When empty, it is one quiet row: "Nothing needs you".
  - Only features waiting on the human count. Notes never count; the open-note count stays on the Project row.
- a **Work | Map** switch, present in every project (decision 7).
  - **Work** shows the remaining lanes (Agent working, In progress, Drafts, Shipped, Archived on toggle), exactly as today.
  - **Map** shows the group tree.
- the foot, unchanged.

The project home's notes card stops saying "Inbox". It becomes "Notes", with "No open notes" as its empty state, so "Inbox" means one thing.

**Map mode is an explorer** (decision 3).
- **The sidebar tree:**
  - an **Overview** row;
  - the product groups, at most two levels deep (Checkout › Coupons), one 32px row each;
  - **Ungrouped** last, when it has anything.
- **The overview,** in the content panel when no group is selected: every group with a one-line tally ("4 UI states · 2 ways in · 1 call") and the catalogue's status line.
- **A group page,** when a group is selected, at a map location under the project (`/p/<id>/map/<group>`). It has three sections in fixed order, each left out when empty:
  - **UI states** (decision 10): one block per component, i.e. per story file.
    - The block's head is the component name and its history line.
    - Then every state of that component as a live frame. These are the review page's existing fixed-height frames with **Open larger**, reused rather than imitated.
    - Frames load as they scroll into view.
    - There are no changed or new marks.
    - The section heading carries "Built from main · <age> · commit <short sha>".
  - **Ways in:** each scenario with its history line and **Open in drive**.
  - **Calls:** each scenario's `.http` request, showing its method and path line and the scenario it sits beside, with **Try it**.
- **The map location and its group are in the URL.** The sidebar's Work | Map mode is a per-project preference: it is remembered in the browser, and opening a map address forces it to Map. Like an IDE's explorer toggle, switching the mode changes only the sidebar, never the content panel. So picking a feature from the Inbox while in Map opens it in the content panel, and the sidebar stays in Map.

**History** (decision 6). Every entry shows its latest change inline ("Changed by Coupons, Oct 12") and the earlier ones behind a disclosure ("3 earlier").
- **Credit:** a change credited to a feature names it by title and links to its feature page. A commit made straight to main reads "Changed on main" with the start of its subject.
- **A story entry's history** covers its story file plus the files it imports that aren't *shared*, per the import graph of main's catalogue build (lap 2, decision 12; see History below).
- **A scenario entry's history** covers the scenario file and its `.http` file.

**The buttons are doors into the existing project drive** (decision 8). There is no new drive UI.
- **Open in drive:**
  - no drive is running: starts a project drive with that scenario and opens the project drive view on its App side;
  - a project drive is live: runs the scenario on it and goes there;
  - another drive holds the one slot: does exactly what the project's Test drive picker does in that case today.
- **Try it:** the same, but lands on the drive view's **API** side with that call selected. The existing flow then runs the call's scenario and fills the request.

**Empty states** (decisions 5, 7). No group page nags.
- **Scenarios but no stories:** the overview carries "UI states aren't set up · Set up stories", which opens the prepare session at its stories step.
- **Stories but no scenarios:** "No ways in yet · New scenario", the existing scenario chat door.
- **Neither:** one empty state ("The map is built from your stories and scenarios") with both doors. The sidebar tree is empty.
- **Stories set up but main's catalogue never built:** one **Build the catalogue** action.
- **A catalogue that main has moved past:** stays shown, labelled "main has moved since", with **Rebuild**.
- **A failed build:** keeps the last good catalogue, with the failure and its log behind a disclosure and **Rebuild**. With no good build to fall back on, the failure takes the UI states place.

### Grouping (decision 4)

Grouping is a pure function of story titles and scenario paths. It reads no file contents and no manifest. The function, as pinned in ideation:

- **Story group** = the story's `title` minus its last segment, which is the component. `Checkout/CouponField` gives Checkout, and `Checkout/Coupons/CouponField` gives Checkout › Coupons. Segments past the second fold into the second level. A single-segment title goes to **Ungrouped**.
- **Scenario group** = its folders under `.runcastle/scenarios/`, up to two levels. A file at the top of `scenarios/` goes to **Ungrouped**. The `_`/`.` helper rule from the scenario listing still applies.
  - This map grouping is computed from the path. It does not change the scenario listing's own one-level `group`, which the drive picker keeps using.
- **Calls:** a call (`foo.http`) belongs to the group of its sibling scenario. Only scenarios with a call file produce a call entry.
  - Runcastle's own repo carries one read-only call beside a review scenario: a GET of `/api/trpc/system.version`, which needs no ids. Calls and Try it can then be driven on runcastle itself (lap 2, decision 14).
- **Name keys:** two names match when they are equal after lower-casing and treating every run of spaces, hyphens and underscores as one separator. Nothing fuzzier: no plurals, prefixes or stemming.
- **Display name:** the story title's spelling wins; otherwise the scenario folder's readable form ("expired-coupon" becomes "Expired coupon").
- **Mismatches** stay two groups. The map never guesses a merge.
- **Order:** groups alphabetically by display name, Ungrouped last. Within a group, components and scenarios go alphabetically.

**The guard against splits.** In this project, agents write almost every story and scenario, so the existing group names are put in front of them at the moment they choose a name:
- `get_feature_context` gains the map's group names, read from main;
- the tickets skill's ship-a-story and ship-a-scenario guidance tells the planner to pick `<group>` from those names when one fits, and to start a new group only on purpose;
- the scenario session's briefing carries the same list;
- the prepare session's stories recipe tells the agent that story title groups should match the scenario folders' names.

Burn agents need nothing new, because they follow the path the planner wrote into their acceptance criterion.

### Main's catalogue (decision 5)

**One catalogue per project, for its main branch.** That means the project's landing branch: the branch features merge into by default. It lives as a new namespace in the stories store beside `features/` and `base/`. The stories static server serves it read-only on the stories port, under the same refusals as the other builds. Beside the catalogue it keeps:
- the build's commit;
- its manifest;
- the import graph the map needs;
- the per-story history (see History below);
- the latest attempt's status and log.

**At merge.** Where the merge flow deletes the feature's build today, it now first asks whether that build can become main's.
- **The "depends on" set:**
  - the story files in the build's index;
  - every file in the build's import graph;
  - everything under `.runcastle/` that the stories set-up owns: the stories config, the Storybook config dir and the stories dir.
- **The test:** does any file in that set differ between the build's commit and the merge commit?
  - **No:** the feature's catalogue moves to main's slot instead of being deleted, replacing the previous main catalogue.
  - **Yes,** or the feature has no successful build: a build of main starts in the background, and the previous main catalogue stays shown until the new one lands.
  - A feature that merges into a branch other than the project's main changes nothing about the map.
- **Why not compare trees:** runcastle's own docs commits land after the last review (checkpoints) and after every merge (the outcome commit). Exact tree equality would almost never hold.

**Staleness.** "Main has moved since" uses the same test, between the catalogue's commit and main's current tip. It is evaluated when the map model is read, cached by main's tip.

**Building main.** A main build reuses the stories build: the same `stories.json` command, the same gate sandbox and throwaway-branch mechanics, the same index/import-graph outputs. It is refactored so it is no longer shaped around one feature and one ticket.
- **It must work in the real Docker sandbox** (lap 2, decision 13). Lap 1's drive found that pressing Build the catalogue failed there:
  - the build command ran in a burn-cache slot checkout;
  - `bunx storybook` fell through to an npx download;
  - `lightningcss` lacked its Linux binary.

  So the command didn't see a Linux install of the repo's dependencies. The build command has to run where the slot's setup installed them, exactly as a review pass's stories build does.
- **When it runs:** only after a merge whose test says yes, or on an explicit **Build the catalogue** / **Rebuild** click. Never on opening the map, and never on a push to main made outside runcastle; runcastle doesn't watch main.
- **Overlap:** builds of one project never overlap. A request while one is running is answered with the running one.
- **Ordering:** a newer main commit's build supersedes an older one; the older one's result is discarded if it lands later.
- **Concurrency:** a main build counts against the same sandbox capacity as burns. Whatever limit runs gate sandboxes today applies to it.
- **Sweep:** base builds and leftover attempt dirs are swept as today. Main's slot holds only the latest good catalogue plus at most one in-flight attempt.

**Events.** Every lifecycle step emits a project-scoped event: started, built, failed, promoted. The map refreshes live through the SSE stream when a build lands.

### History (decision 6)

**Attribution:** main's first-parent history.
- A `Merge branch 'feature/<slug>'` commit is credited to that feature. Its title is looked up from the slug in the project's features; an unknown slug shows the slug itself.
- Any other first-parent commit is "main" with its subject.
- A change counts against an entry when that commit's diff against its first parent touches a file in the entry's set.

**A story's set leaves shared files out** (lap 2, decision 12).
- **What counts as shared:** a file reached by more than a quarter of the catalogue's story files, and by at least 3 of them, both counted over the build's import graph. Primitives, the theme and API types are the usual cases.
- **What a story's set holds:** its own story file, which is never shared, plus the files it reaches that are not shared.
- **History only:** the catalogue's "depends on" set for staleness and promotion keeps the full graph, because a theme change does change every frame.
- **Why:** lap 1's drive found history over the whole graph credited 37–50 features to every runcastle component.

**Computed once per main commit, never live on opening the map:**
- **story history:** when main's catalogue is built or promoted, over each story file's set (shared files left out), stored beside the catalogue. A catalogue stored before lap 2 keeps its old history until its next build or promotion;
- **scenario history:** for main's tip when the map model is first read at that tip, over each scenario file and its call file, cached by main's tip.

**Display:** the latest change inline, the rest behind a disclosure, newest first.

### Server and web shape

- **Pure, in core** (IO-free): the grouping function and the name key, as pinned above, plus the "does this diff touch the catalogue" test over file lists.
- **Server:**
  - **a map service** that assembles the map model for a project from:
    - main's catalogue (index, status, commit, stored story history);
    - the scenario listing at main;
    - the scenario history.
  - **a main-catalogue service** that owns the slot: promote, build, status, staleness, sweep.
  - **the merge flow's** promote-or-build step.
  - **the stories static route's** new namespace.
- **tRPC, on the project router:**
  - a read of the map model;
  - a mutation that starts a main build (Build the catalogue / Rebuild), which emits.
- **Web:**
  - the sidebar triage split (Inbox lane out of the lane list) and the Work | Map switch;
  - a map location kind in the router-less navigation state, with its URL round-trip;
  - the overview and group pages;
  - the notes card rename;
  - Open in drive / Try it as navigation into the existing project drive view, with an intent for which side and which call.
- **Visual source:** the preview's screen blocks `map-sidebar-and-group-page` and `map-overview`. `apps/web/DESIGN.md` governs: no pills, sentence case, `NavItem` and `ListRow`, `EmptyState`, `Disclosure`, and one primary button per view.

## Seams

1. **The grouping function** (new, core, pure): story titles and scenario paths in, groups out. Observes:
   - every grouping rule: levels, folding, Ungrouped, name keys, display name, mismatches, order;
   - the calls-follow-their-scenario rule.
2. **The catalogue-dependency test** (new, core, pure): changed file list plus a catalogue's index and import graph in, "touches the catalogue" out. Observes promote-versus-build and staleness without git or a sandbox.
3. **The map model read** (new, the highest seam: the map service behind the project router's map query). Uses a fixture repo with real git history (feature merges, direct commits, docs-only commits), plus a fixture main catalogue (index, import graph). Observes:
   - groups, entries and history credits;
   - the catalogue status line: none, built, stale, failed with or without a fallback, building;
   - every empty state the UI branches on.
4. **The merge flow** (existing seam, extended): merging a fixture feature whose catalogue exists. Observes:
   - **promote** when nothing it depends on changed;
   - **a started main build** when something did;
   - **nothing** when the feature merges into a non-main branch;
   - the emitted events.
5. **The main build entry point** (new, via the project router's build mutation, with the sandbox injected as the stories build already allows). Observes:
   - the slot's contents and status after success and after failure (last good kept);
   - single-flight behaviour;
   - supersession by a newer commit.
6. **The stories static route** (existing seam, extended): serves the main namespace and keeps every existing refusal.
7. **`get_feature_context`** (existing seam, extended): carries the map's group names from main. The skill-text changes ride beside it and are checked by reading them.
8. **The sidebar triage** (existing pure seam in the web's feature-ui helpers): Needs you comes out as the Inbox, and the remaining lanes are unchanged.
9. **Navigation state** (existing seam): the map location and group round-trip through the URL. Picking a feature while in Map keeps Map.
10. **Web component tests** (the two tiers in `apps/web/STYLE.md`): the sidebar with the switch, the overview in each empty state, the group page (lazy frames, history disclosure, sections left out when empty), the notes card rename.

## Out of scope

- **Owned by the stories feature:** setting up stories, and stories on the feature page. The review build itself is untouched, apart from no longer being deleted when it is promoted.
- **Owned by *Drive scenarios*:** the scenario contract, the drive, its single slot, the picker and the App | API view. The map only opens them.
- **Watching main** for pushes made outside runcastle. **Rebuild** covers it.
- **Fuzzy name matching, tags, a manifest, or groups worked out from code.**
- **Calls without a sibling scenario.** The `.http` contract keeps calls beside scenarios.
- **Showing a feature branch's catalogue on the map.** The map is main only.

## Open questions

- **Dependency bumps:** a change to a project's dependencies (lockfile) can change the catalogue without touching a file in its import graph. Lap 1 doesn't count those as "moved"; **Rebuild** covers it. Revisit if it bites in use.
- **Map size:** a very large catalogue (hundreds of components) has not been tried on the map. Lazy frames bound the cost per page, but the tree's length is unbounded. Watch it in the test drive.

## Later laps

- **The project home rethink,** now that Work, Map and the Inbox exist. That includes renaming the Project row to "Talk to runcastle" once the page it opens is settled (decision 9).
- **In-flight markers** on map entries, e.g. "Coupons changes this, on its branch", from each live feature's branch diff against main (decision 1).
- **Further investment in the map,** beyond lap 2's build fix and history cut. The combination held up in lap 1's drive (decision 11), so this is open, not ruled out.
