# Decisions

## 1. A thin lap 1 that tests whether the map holds up
**Decision:** Lap 1 builds:
- the sidebar restructure: the Inbox pinned, plus the Work | Map switch;
- the Map view: product-name groups, each with its stories, scenarios and calls;
- git history on every entry;
- the build of main's story catalogue, which the stories part needs.

Two things are parked under the spec's `## Later laps`:
- the project home page rethink;
- markers on entries for in-flight features ("Coupons changes this, on its branch").

**Why:** The brief names the risk: the map earns its place only if stories, scenarios and calls together, with history, beat Storybook's own sidebar. Lap 1 is the smallest thing that can be test-driven to answer that. The switch and the pinned Inbox ship together, because a Map view that hides what needs you would make the sidebar's attention grouping worse.

## 2. The pinned Inbox is today's Needs you lane, and "Inbox" means only that
**Decision:**
- **What it holds:** the sidebar's Inbox is the Needs you lane, lifted out of Work and pinned above the Work | Map switch. It shows the feature rows themselves, in whichever view is open.
- **When it is empty:** it shrinks to one quiet row, "Nothing needs you".
- **What Work keeps:** the other lanes (Agent working, In progress, Drafts, Shipped).
- **What counts:** only features waiting on the human. Jotted notes do not count, and their open count stays on the Project row.
- **The notes card is renamed:** it drops the word "Inbox" and becomes "Notes", with "No open notes" as its empty state.

**Why:** Rows rather than a count keep attention as visible as it is today, as the brief requires, whichever view is open. A single "Inbox · N" row would hide what's waiting behind a click. Notes are the human's own backlog, not work an agent is blocked on. Renaming the notes card gives "Inbox" one meaning.

## 3. Map mode is an explorer: a group tree in the sidebar, a group page in the content panel
**Decision:**
- **Sidebar (Map mode):** under the pinned Inbox, a tree of the product groups, at most two levels deep, with one 32px row per group.
- **Group page:** selecting a group opens its page at `/p/<id>/map/<group>`, with three sections in a fixed order:
  - **UI states:** the group's stories as live frames;
  - **Ways in:** its scenarios, each with *Open in drive*;
  - **Calls:** its `.http` requests, each with *Try it*.

  A section is left out when the group has nothing of that kind, and every entry carries its history line.
- **Map with no group selected:** an overview of every group, with a one-line tally each ("4 UI states · 2 ways in · 1 call").

**Why:** The explorer is the IDE pattern the brief reaches for. One group at a time keeps the number of live iframes bounded, where a single long page would load every group's frames at once. The overview gives Map a landing page without touching the project home, which is parked.

## 4. Groups come from names, matched loosely, and agents reuse existing names
**Decision:**
- **Story group:** a story's title minus its last segment, which is the component. `Checkout/CouponField` → Checkout; `Checkout/Coupons/CouponField` → Checkout › Coupons. Anything deeper folds into the second level.
- **Scenario group:** its folders under `.runcastle/scenarios/`, up to two levels (`checkout/coupons/` → Checkout › Coupons).
- **Calls:** a call (`foo.http`) belongs to the group of the scenario it sits beside.
- **How names match:** case is ignored, and spaces, hyphens and underscores count as the same character. There is no fuzzier matching (no plurals or prefixes).
- **Display name:** the story title's spelling wins; otherwise the scenario folder's readable form is used.
- **Leftovers:** single-segment story titles and top-level scenario files go into a last group, **Ungrouped**.
- **Mismatches stay visible as two groups.** The map never guesses a merge.
- **The guard:** whenever an agent adds a story or a scenario, it is shown the map's existing group names and told to reuse one, or to start a new group only on purpose. Agents here are burn agents and the stories set-up recipe.

**Why:** The human asked whether name matching is risky. Its likely failure is two half-groups, through a mismatch or a later rename. That failure is visible and costs only completeness: history stays exact, because it comes from git per file. Tagging and manifests were rejected in the project session. Working groups out from code would break "language-agnostic by construction" and the rule that runcastle never reads a scenario's contents. In this project, agents write almost every story and scenario, so the guard stops splits where they start.

## 5. Main's catalogue: promoted at merge when it can be, built in the background when it can't
**Decision:**
- **What the map shows:** main's latest *successful* catalogue build, labelled "Built from main · <age>".
- **At merge:** if the merge commit's tree equals the tree the feature's last review build ran on, that build is promoted to be main's catalogue instead of being deleted.
- **When the trees differ:** a build of main runs in the background after the merge. The map keeps showing the previous good build until the new one lands.
- **When main moved outside runcastle, or a build failed:** the map keeps the last good build and says "main has moved since", with a **Rebuild** button. Runcastle does not watch main for pushes.
- **When no build exists yet:** the UI states sections offer one **Build the catalogue** action. Opening the map never starts a build.

**Why:** A build takes minutes of sandbox time, though it never starts the app. Under `--no-ff` merges, the merged tree is usually exactly the reviewed tree, so promotion gives main's catalogue at no cost, and the tree comparison is exact. Rebuilding after every merge would compete with live burns for a result that usually exists already. Starting builds only on an explicit click keeps "the map never starts the app to show itself" honest and cheap.

## 6. History follows what an entry depends on, credited to features from main's merges
**Decision:**
- **Story entries:** one per component, i.e. per story file. Its history covers the story file plus every file it imports, taken from the import graph of main's catalogue build.
- **Scenario entries:** history covers the scenario file and its `.http` file.
- **Attribution:** main's first-parent history is walked. A `Merge branch 'feature/<slug>'` commit is credited to that feature by its title ("Coupons, Oct 12"). A commit made straight to main shows as "main" plus the start of its subject.
- **Display:** the latest change inline, with earlier ones behind a disclosure. Each feature name links to its feature page.
- **When it's computed:** story history with main's catalogue build or promotion; scenario history by `git log`, cached by main's commit. Opening the map never walks history live.

**Why:** A story file rarely changes when its component does, so history over the story file alone would quietly say "unchanged" about UI that changed yesterday. The import graph already exists in every build; the review page uses it for changed, new and affected stories. Scenario contents are never read, so files are the honest limit there. Linking feature names is where the two decoupled views, features and the map, meet.

## 7. The Map is always there, and an empty part says what fills it
**Decision:** The Work | Map switch shows in every project. Then:
- **Scenarios but no stories:** the map is built from scenarios and calls alone. The overview carries one quiet line, "UI states aren't set up", with a **Set up stories** link to the prepare session's stories step.
- **Backend-only projects:** no special case; they get the same treatment as the case above.
- **Stories but no scenarios:** the overview line reads "No ways in yet", with a **New scenario** link (the existing scenario chat door).
- **Neither:** the content panel shows one empty state explaining that the map is built from stories and scenarios, with both doors. The sidebar tree is empty apart from the pinned Inbox.
- **Stories set up but main's catalogue not yet built:** decision 5's **Build the catalogue**.

No group page nags about a missing part.

**Why:** A switch that appears and disappears per project would make the sidebar shift shape. An empty map is the best place to say what fills it, and hiding the Map would hide those doors too.

## 8. Open in drive and Try it are doors into the existing project drive
**Decision:**
- **Open in drive:**
  - **no drive running:** starts a project drive with that scenario and opens the project drive view on the App side;
  - **a project drive already live:** runs the scenario on it and goes there;
  - **another kind of drive holds the slot:** behaves exactly as the project's Test drive picker does today.
- **Try it:** opens the project drive view on the API side with that call selected, starting the drive first if none is running.
- **No new drive UI:** the map adds no drive interface of its own.
- **Branch caveat, accepted:** the map lists main's scenarios, while the drive runs whatever is checked out. The drive view already names its branch.

**Why:** The drive, its single slot (ADR-0014), the scenario picker and the App | API view already exist and are owned by *Drive scenarios*. The map must not swallow or fork them. A disabled "start a drive first" button would make the human do by hand what one click can do.

## 9. The Project row stays as it is in lap 1, and "Talk to runcastle" waits for the home rethink
**Decision:** Lap 1's sidebar, top to bottom:
- the project switcher, Create menu and search;
- **Project** (unchanged), with Prepare beneath it while owed;
- **Inbox**, pinned (decision 2);
- the **Work | Map** switch;
- the Work lanes or the Map tree;
- the foot, unchanged.

Renaming the Project row to "Talk to runcastle" moves to the later lap that rethinks the project home.

**Why:** A row's label should say what it opens. The Project row still opens a page of chats, notes and drive doors, and that page is the one being rethought. Lap 1 tests the map, and this name doesn't affect that test.

## 10. A group's UI states show every state of each component, framed as on the review page
**Decision:**
- **Layout:** one block per component (story file), headed by its name and history line, then every state as a live frame.
- **Frames:** the review page's existing fixed-height frame and its **Open larger** dialog, reused rather than imitated.
- **Loading:** frames load as they scroll into view.
- **No marks:** no "changed" or "new" marks; the map shows main as it is.

**Why:** Seeing every state of a component at a glance is what Storybook's sidebar makes you click through, and it is where the map can beat it. Lazy frames keep a big group from opening dozens of iframes at once. Changed and new are a feature's review question; on the map, the history line carries change.
