# Outcome — Sidebar refresh: less clutter, more character

Rework the project sidebar's look and layout so it reads calmer and feels more alive, within the existing design rules.

- Shipped: 2026-10-23
- Laps run: 1

## What shipped

9 commits · 49 files

### Lap 1
- 2 tickets landed: #1 Wire the project sidebar onto the committed design pieces; #2 Say Backlog for Draft in web copy, server messages and the runcastle skills
- 0 waived
- 0 failed

## Review record

### Lap 1 · review

- Reviewed commit: da51241e72d28a3aa8f83f880da18402ce53920e
- Landed since: 0
- Outcome: done

- **On an unprepared project with no features, "No features yet…" sits above the "Prepare this project" row** — open
- **Unverified: "Stopped" rows with a grey dot after the waiting ones** — open
- **The design preview page isn't served in a drive, so "matches the preview" was judged from the criteria and decisions** — open
- **Shipped shelf order doesn't follow the ages it shows** — open
- **Backlog wording holds where checked; the feature page still says "Parked just now"** — open

## Notes record

- No human notes

## Per-ticket digests

### Lap 1

#### 1. Wire the project sidebar onto the committed design pieces

# Ticket 1 — Wire the project sidebar onto the committed design pieces

## What was done
- `Sidebar.tsx` now builds the sidebar from the `SidebarParts` pieces, following `preview/sidebar.tsx`'s `Design()`. Top to bottom: the film grain; a head with the switcher, a Search icon button (⌘/Ctrl K), Create ("Add to backlog") and Close; the `OrchestratorCard`; an unheaded "Needs you" section (PrepRow while owed, then the waiting rows, then the stopped `inProgress` rows); `WorkingShelf`; then Backlog / Shipped (cap 5) / Archived shelves in a `divide-y` column; then the foot.
- Removed: `SearchLauncher`, the one-line `FeatureRow`, the Project and Preparation nav rows, the "running elsewhere" row with its `useQueries`, the foot's Re-prepare row, `SidebarLanes.tsx`, `runsElsewhere` (lib/projects.ts) and `capLane` (now dead; the Shipped shelf caps itself), plus their tests.
- Orchestrator waiting: the project session row does carry `awaitingInput`, so `waiting = talk.state === 'live' && talk.session?.awaitingInput`. While that is set the status reads "Waiting on you", plus " · N notes" when there are notes. Re-prepare lives in its "…" menu when prep is done.
- The Archived shelf reads its features from `list.data` whether or not it is open. Its open state persists under the existing `runcastle.sidebar.showArchived` key.
- `SidebarFootChrome` keeps its contract. It renders the rows, then `SidebarStatusLine`, whose tooltip carries the health words and origin. Drive cards show the feature title for a test drive (the branch if the title is missing) and the branch in mono for a project drive. `PortfolioHome.tsx` was not edited; its foot changes through the shared chrome.
- Lane label "Backlog"; the draft chip text is now "In the backlog" (`featureStateWords` just returns `rowChip(f).text`). The skeleton is two-line: h-13 (52px), rounded-lg, title bar over a shorter bar.
- Tests rewritten: sidebar-inbox (whole Sidebar over faked tRPC), sidebar-row (SidebarParts: `featureStateWords` across lanes, row anatomy, Shelf cap, Orchestrator dot), sidebar-foot, sidebar-lanes, project-note-badge, consistency-pass, content-skeletons, intake-copy, feature-ui, feature-dependencies and projects.

## Surprises
- Visible changes the committed `SidebarFeatureRow` brings with it:
  - The orchestrated glyph ring ("Orchestrated") is gone from sidebar rows.
  - A waiting draft's tooltip no longer lists its blockers; the words still say "Waits on X".
- Once the drafts lane was renamed, `intake-copy.test.ts` (outside the listed files) pinned "Draft an idea", so I updated it.
- "Nothing in motion" (from the preview) shows only when features exist and none of them is waiting, stopped or working. With no features at all, "No features yet…" shows instead.

## Left undone
- The PortfolioHome sidebar head is still h-9 (the project sidebar's is h-10). I didn't touch it because the contract was the only ask.
- `triage`'s `showArchived` option and `sidebarLanes`' pass-through are now only used by tests.
- Drive machinery: no new service, env var, seed or process, so `.runcastle/` needed no edit and wasn't run.
- Verification: full `bun run typecheck` was green, and `env -u GIT_ASKPASS bun run test` passed 372 files / 5194 tests with 0 failures. `preview/sidebar.tsx` compiled clean under a temporary tsconfig, which I then deleted.
