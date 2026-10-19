# The map shows every page and its states

## Problem

The map (shipped 2026-10-19 as *The map of stories and scenarios*) shows components, not the app. Opening Map › Burn shows `Lane / Failed ticket` and `UnrunnableGates / Missing runtime`: each one a component's state, cropped to a 240px strip, grouped by the code folder its story sits in. The human wants to see the structure of their website: the onboarding and every one of its screens, the project chooser, the project session screen, a feature at each phase. They want each one as a whole page, in the places they actually go.

Three things are wrong (brief):
- **the unit:** components, not pages;
- **the structure:** code areas, not places in the app;
- **the coverage:** accidental. Main has 11 stories, whatever recent features happened to write, and nothing ever mapped the existing app.

## Approach

### What the human sees

- **The map lists places, not components.** The sidebar's Map tree reads `Onboarding`, `Project chooser`, `Project`, `Feature` › `Planning` / `Building` / `Review` / `Shipped`, `Settings`, in the order you move through the app (decision 13).
- **A place's page** shows each of its states as a picture of the whole page: sidebar, topbar and body, rendered with fake data. There is one per row, in flow order, with numbered steps (`1 Welcome`, `2 Git identity`, …) and a step's variants kept together (decisions 4, 6). Clicking a picture opens it full size, where it can be clicked through. Ways in and Calls stay below, as today.
- **The overview** is the app's structure: a tree of places, one small picture each, with a tally (decision 7).
- **A history line per story file** reads "Stories updated by <feature>, <date>" (decision 8).
- **At review,** page stories in the feature page's "UI states" section are framed the same whole-page way, before and after side by side (decision 9).
- **Component stories are gone from the map** (decision 2) but stay in the catalogue and in review's UI states section.

Lap 1 maps **Onboarding** in full and one deep page, **Feature › Review › Findings open** (decision 1). Lap 2 maps the rest (see Later laps). The feature is meant to merge after lap 2.

### Page stories (decisions 2, 4, 5, 13)

- **What makes a story a page story:** its file lives under `.runcastle/stories/pages/`. Runcastle tells pages from components by the `importPath` in the build's `index.json` and nothing else. Every other story is a component story.
- **Naming:**
  - **The title is the place**, written the way you navigate to it (`Onboarding`, `Project chooser`, `Feature/Review`).
  - **Each exported story is one state.** Its name may start with a step number (`3 Coding agents`).
  - **A step's variant** shares its number and adds ` · <variant>` (`3 Coding agents · None installed`).
  - States sort by step number (numerically), then by index order. Unnumbered states keep index order, after numbered ones.
- **Folder order:** page story folders carry navigation-order numbers (`pages/1-onboarding/`, `pages/4-feature/3-review/`). The map orders places by their story files' paths, comparing numbers as numbers. Titles never carry those numbers.
- **Rendering:** a page story renders runcastle's real `App` inside the providers `.runcastle/storybook/preview.tsx` already stacks, which are the same ones `main.tsx` uses. The app has no router: `use-history-sync.ts` reads `window.location.pathname` once at mount, and the app's tests start it at an address with `history.replaceState`. So:
  - a small helper under `.runcastle/storybook/` sets the address with `history.replaceState`, clears browser storage, then renders `App`;
  - each page story names its path and its fakes through that helper.
- **Live things at the edge:**
  - `preview.tsx` installs a stand-in `EventSource` that opens and never sends. `useLiveSync` (`lib/live.ts`) then sees a live stream and polls slowly, and nothing reaches a server.
  - Terminals replaying recorded text (a stand-in at the terminal WebSocket edge) and a placeholder for the drive frame are lap 2 work, when pages that show them are mapped. Lap 1's pages show neither: the review state has no drive up.
- **Shell fakes:** one fixtures module under `.runcastle/storybook/` answers every query the shell makes on first render, reusing `apps/web/test/fixtures.ts`. The queries are:
  - `project.list`, `setup.doctor`, `system.checkUpdate`;
  - `feature.list`, `project.prep`, `feature.driveInfo`, `projectNotes.openCount`;
  - `project.projectSession`, `project.conversations`, `events.listByProject`;
  - `project.map` while the sidebar is in Map mode.

  A story spreads those defaults and overrides only what makes its state differ. Unfaked queries still answer NOT_FOUND (`fake-api.ts`), which is how a missing fake shows itself.
- **States with no address** are reached by a Storybook `play` step that clicks or types as a user would, then asserts that a landmark of the target state is on screen. A failed step shows Storybook's error display, never the starting screen under a wrong name. These states are the wizard's screens, the open-project dialog, Settings, ⌘K, the draft form and dialogs.
- **The viewport:** page stories render at 1440 × 900 with `layout: 'fullscreen'`.

### Today's stories (decisions 3, 12)

- **Ten stay where they are:** the files under `burn/`, `feature/`, `map/`, `review/` and `sidebar/` stay as component stories, untouched.
- **The review story moves:** `feature-page/Review.stories.tsx` moves under `pages/` as the place `Feature/Review` with the state `Findings open`. It renders the whole app at that feature's address, with its existing findings, rounds and declarations fakes plus the shell defaults.
- **The scenarios move with it:** runcastle's three scenarios in `.runcastle/scenarios/review/` move to `.runcastle/scenarios/feature/review/`, where they join `Feature › Review` by the existing name match. Their relative imports and the tests and comments that name those paths move too. The `map/` scenario stays and forms the `Map` group.

### The map model (decisions 2, 4, 8, 13)

**Grouping.** Core's `groupMap` changes:
- It skips stories that are not page stories.
- For a page story, the group is its **title** folded to two levels. A single-segment title is a top-level group of its own; pages never go to Ungrouped.
- Deeper title segments fold into level two and are prefixed to the state's display name (`Drive · Waiting`).
- Scenario grouping and the loose name match are unchanged.

**What a group carries.** Instead of `components`, each `MapGroup` carries **pages**: one per page story file, holding its states in step order. A state carries:
- its story id;
- its display name;
- its step number, when it has one;
- its frame URL.

The shape, from the planning discussion:

```ts
MapPage  = { importPath, history: MapHistoryEntry[], states: MapState[] }
MapState = { id, name, step: number | null, frameUrl }
MapGroup = { id, name, parentId?, pages: MapPage[], scenarios: MapScenario[] }
```

**Order.** Groups that have pages come first, in page-path order, each parent followed by its children. Scenario-only groups follow alphabetically, and Ungrouped is last.

**History** for a page story covers its story file alone: the first-parent git log of that one path, credited to features as today. Component story history is still computed but is not on the map.

**Group names for agents.** `mapGroupNames` (and so `mapGroups` in `get_feature_context` and the scenario brief) now come from place groups and scenario groups.

**Mapped places.** `get_feature_context`'s `stories` field gains `pages: string[] | null`: the places that have page stories in main's catalogue, as display names (`Feature › Review`). It is `null` when main's catalogue has never been built; planning then reads `.runcastle/stories/pages/` itself.

**Gap line.** With stories set up and a built catalogue that has no page stories, the overview's gap line reads "No pages on the map yet".

**Unchanged:** the catalogue's staleness and promotion tests (map decision 5) keep the full import graph. A whole-app page story makes most web changes count as "main has moved since"; that is accepted, and promotion at merge still covers the usual case.

### The page frame (decisions 6, 7, 9)

The shared `StoryFrame` (`components/review/StoryFrame.tsx`) gains a **page** variant:
- **Size:** an iframe sized 1440 × 900, scaled by CSS transform to its container's width (a ResizeObserver), in a container with that aspect ratio.
- **Behaviour:** `pointer-events: none`. Clicking the frame opens the existing `StoryLargerDialog`, where the page is interactive and shown as large as the dialog allows.
- **Loading:** it reuses `WhenVisible` lazy mounting. A small shared queue lets at most three page frames be loading at once, and the next starts when one fires `load`.
- **Theme:** it follows runcastle's current theme by adding Storybook's `globals=theme:<dark|light>` to the frame URL.

Where it is used:
- **The group page:** the variant at full column width, one state per row. Each row is captioned by its state name, and step variants sit under their step. A strip of step chips at the top jumps to each step. A parent group shows its own pages first, then each child group as a section in map order.
- **The overview:** a tree of places, each with its first state in a small page frame and a tally ("6 states · 1 way in · 1 call").
- **Review's UI states section:** the server's UI-states model marks each story `page: boolean` by path, and the section uses the page variant for those, before and after as today. Classification (changed / new / affected) is untouched.

### The page rule (decision 10)

**Where it binds:** places listed in `stories.pages`, plus brand-new pages in a project with any page stories. An existing unmapped page is not a ticket's job.

**Where it is carried:**
- **The tickets skill's `<ship-a-story>`:**
  - A ticket that adds a page, adds a state worth seeing, or changes what a mapped page shows gets a criterion naming the page stories to add or update, by place and state. The self-check gains an item for it.
  - Component stories stay optional.
  - The `mapGroups` guidance now covers page titles and scenario folders.
- **The burner prompt** (`implement-ticket.md`) gets one short paragraph: if your diff changes what a mapped page shows, update its page stories. It also gives the essentials of a page story: where it lives, how it is named, the address helper, data at the edge, and scripted steps that assert.
- **The review prompt's stories notes** (`buildStoriesNotes` in the review workflow): when the review build's index has page stories, the reviewer judges from the diff whether a mapped or new page changed. If so and its page stories were not added or updated, the reviewer files a **defect**. This is judgement; runcastle adds no parser.

**One page-stories guide** in the skill pack says how to write page stories and how to walk an app's navigation into places and states:
- the router or its equivalent, plus overlays;
- naming, numbering and variants;
- edge fakes and canned live content;
- scripted steps.

The tickets skill and prepare point at it, and the burner paragraph carries its essentials, since burn agents may not see the pack.

**Prepare's stories recipe:** the one proving page story becomes a page story in this shape, under `pages/`, and the evidence build must list it.

**`apps/web/STYLE.md`'s Stories section** gains a line on page stories.

### Seams of runcastle the feature must not swallow

- The catalogue build, promotion and serving stay as they are.
- The drive doors (Open in drive, Try it) stay.
- Design mode is untouched.

## Seams

- **Core `groupMap` and the map schemas** (existing; changed): story index entries plus scenario paths in, groups with pages and states out. This lets you observe page and component filtering, place grouping and folding, step order and variants, place order by path, and scenario joins. These are pure unit tests.
- **`project.map` / `mapModel`** (existing): over a fixture repo with a stored main catalogue. This lets you observe frame URLs, story-file-only history for pages and the "No pages on the map yet" gap.
- **`get_feature_context`** (existing; gains `stories.pages`) and **`mapGroupNames`** (existing): these let you observe mapped places and place-named groups.
- **Map web components** `MapView` / `MapOverview` / `MapGroupPage` (existing), driven by fixture `MapModel`s in the two `STYLE.md` test tiers. They let you observe the tree, one-per-row states with captions and step chips, child sections, and that frames open larger.
- **`StoryFrame` page variant** (new prop on an existing component): this lets you observe the scale, the aspect ratio, the lazy mount, the three-at-once queue and the theme parameter.
- **The UI-states model and `UiStatesSection`** (existing; gains `page`): this lets you observe page stories framed as pages at review.
- **The page stories themselves** (new files under `.runcastle/stories/pages/`): they are observed through the stories typecheck (an existing verify command) and the catalogue build's `index.json` (the existing build command), which must list every Onboarding state and `Feature/Review · Findings open`. Each scripted step's assertion is the runtime check, and the rendered frames are the human's check in the drive.
- **The `.runcastle/storybook/` app-at helper, shell fakes and silent `EventSource`** (new): they are observed only through the page stories that use them.
- **Skill and prompt text** (existing files): `buildStoriesNotes` has unit tests for the review prompt, and the launch-artifact tests cover rendered prompts. The tickets skill, prepare recipe and guide are checked by reading.

## Out of scope

- The catalogue build, promotion at merge, the stories port, and review's story classification. Only the `page` mark and its frame change at review.
- Scenarios and drives, beyond moving runcastle's review scenarios into `feature/review/`.
- Design mode (a parked draft), which will reuse page stories in its own dock.
- Narrow-screen layouts as states, and screens drawn as connected flows rather than a tree.
- Rewriting the ten component stories.

## Open questions

- **Setting the address inside Storybook's frame is unproven.** After `history.replaceState` the frame's path is no longer `iframe.html`, and that might break the catalogue's own relative asset loading or Storybook's URL handling. The harness ticket proves it first with a real catalogue build. If it fails, the smallest fallback is a single override point in the one module that reads the address (`use-history-sync.ts`'s `currentPath`). That fallback is code that exists for the catalogue (decision 5's rejected alternative), so the burner must record it in its digest for the human, and use it only if the URL route truly fails.
- **Desktop notifications and other browser APIs the shell touches on mount** (`use-notifications.ts`) may need an edge stand-in in the preview. The harness ticket settles it.

## Later laps

- **Lap 2: the rest of runcastle's mapping pass,** as ordinary rounds with one ticket per area. Each area walks its part of `AppLocation` (`apps/web/src/lib/routes.ts`) plus overlays, about 40–70 more stories:
  - Project chooser (portfolio home, open project, no projects);
  - Project (home, project session chat, notes, prepare);
  - Feature › Planning, Building, Review (beyond Findings open) and Shipped;
  - Map;
  - Settings and ⌘K and the draft form.
- **Canned live content:** a terminal stand-in at the WebSocket edge that replays recorded text, and a placeholder for the drive frame. They arrive with the first areas that show them (the project session, prepare, and review with a drive).
- **The "Map your app" door:** on a project with stories but no page stories, the map's empty state starts a feature whose planning walks the app's navigation with the guide and cards one ticket per area (decision 11).
- The lap-1 drive's verdict on the look, the naming and the one-per-row size feeds lap 2's planning, alongside the test notes.
