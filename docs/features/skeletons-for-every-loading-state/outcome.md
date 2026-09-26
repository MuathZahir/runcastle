# Outcome — Skeletons for every loading state

Replace the remaining content-area loading states with skeletons shaped like the content they're loading, reusing the Skeleton primitive the triage batch introduced for the feature page (batch 'Triage batch — loading states, icons, and the sidebar and note-box polish'; start this only after that batch merges). The sites are the other six <Loading> callers in apps/web/src: components/Sidebar.tsx ('Loading features…', skeleton rows shaped like feature rows), components/Shell.tsx, components/settings/GeneralPage.tsx, components/inspector/Inspector.tsx, components/bodies/grill/ArtifactPane.tsx, and components/PreparationWorkspace.tsx. Keep the 300ms delay so fast loads show nothing. Out of scope: inline busy states (button pending spinners, dialogs, the first-run wizard, the next-step bar). Those keep the Spinner, because a skeleton can't say 'this button is working'. Once no content area uses the old spinner-plus-word Loading component, delete it, or narrow it to whatever caller still legitimately needs it, and say which in your digest.

- Shipped: 2026-09-26
- Laps run: 1

## What shipped

9 commits · 21 files

### Lap 1
- 3 tickets landed: #1 Replace the remaining content-area loading states with skeletons shaped…; #3 Five content areas still load as a bare "Loading…" word with no 300ms wait; the Settings dialog now loads two different ways; #4 ProjectsSkeleton draws single-line project rows, but real project rows are two-line (name + repo path)
- 0 waived
- 0 failed

## Review record

### Lap 1 · review

- Reviewed commit: d2329d5031be88ed61f7461f74a933c06f4d9d0d
- Landed since: 2
- Outcome: done

### Lap 1 · verification

- Reviewed commit: f6ebb9bbb95d1df4ba5c86cc1aba00403f3db3e8
- Landed since: 0
- Outcome: done

- No findings

## Notes record

- No human notes

## Per-ticket digests

### Lap 1

#### 1. Replace the remaining content-area loading states with skeletons shaped…

# Ticket 1 — Skeletons for every loading state

**What was done.** I moved FeatureSkeleton's private placeholder bar and its 300ms fade-in into a shared primitive, `apps/web/src/ui/skeleton.tsx`, which `ui.tsx` re-exports:
- `Skeleton` keeps the 300ms wait and a breathing wrapper marked `data-progress`. With a `label` it is a `role="status"` region with a screen-reader-only label. Without one it is decorative.
- `SkeletonBar` is a single placeholder bar.

FeatureSkeleton now uses it (its markup and existing test are unchanged). Each of the six sites got a skeleton shaped like its content, defined and exported in its own file:
- Sidebar: `FeatureRowsSkeleton`, a lane heading and 4 rows the height of a feature row.
- Shell: `ProjectsSkeleton`, the portfolio title, meta line and 3 project rows.
- GeneralPage: `SettingsSkeleton`, the Server and Sessions groups as setting rows.
- Inspector: `DetailsSkeleton`, the Knowledge tab's doc rows.
- ArtifactPane: `ProseSkeleton`, a heading and two paragraphs.
- PreparationWorkspace: `PreparationSkeleton`, the call-to-action header.

**`Loading` is deleted outright, not narrowed.** Those six were its only callers. Inline busy states keep `Spinner`. STYLE.md (catalogue plus the list of files under `src/ui/`) and DESIGN.md (the reduced-motion note) now describe `Skeleton`. The consistency-pass test now checks that `Loading` no longer exists. New tests: `test/skeleton.test.ts` covers the primitive; `test/content-skeletons.test.ts` covers each site's shape and label, and fails if `<Loading` appears anywhere in `src`.

**One behaviour change beyond the swap:** ArtifactPane used to show its "No decisions yet / No spec yet" empty state *under* the loading line while the first read was in flight. The skeleton now replaces the empty state until the read lands.

**Surprises.** In this sandbox, `packages/server/test/dev-pane.test.ts > kills the child process tree…` fails, both in the full suite and when run alone. The baseline says the suite is fully green, but my diff touches only `apps/web`. The test checks that a PTY process group gets reaped, so this looks like an environment problem in the container. Apart from that test, the full suite passed (4185 tests) and typecheck is clean.

**Left undone.** The drive machinery needed no change: no new service, environment variable, seed or process, so I did not run or edit anything under `.runcastle/`. Other surfaces that still show a spinner (ProjectCard's `loading`, DocPeek, WalkthroughPlayer, MapRail, TicketsBody and so on) were not `<Loading>` callers, so they were out of scope. Some of them may deserve skeletons in a later pass.

#### 5. Verify the fixes that landed

Gates verification pass — both landed fixes hold

This pass verified lap 2 by reading the fix commits on `feature/skeletons-for-every-loading-state`, not by running the app. The mode is Gates, inherited from the pass under review. This project has no verify commands configured, so no gates ran and the whole pass went on the diff.

**#3 (five content areas still loaded as a bare "Loading…" word): held.** I re-ran the repro, `git grep -nE "<DimLine>Loading" feature/skeletons-for-every-loading-state -- apps/web/src`. It now lists only `DocPeek.tsx:52`, a popover line the finding allowed to stay. Commits `03350df7` and `29b6bc0e` changed the following:
- `SettingsSkeleton` moved into `settings/SettingRow.tsx` and now takes a per-page `groups` shape. General, Burns, Models and Project all render it, so the Settings dialog loads the same way on every page.
- `TicketsBody` renders `TicketsSkeleton`.
- `MapRail` renders `MapDocSkeleton` where the map document will go, and no longer shows "Nothing written yet" during the first read.

All of these go through the shared `Skeleton` primitive, which applies the 300ms fade-in delay and a `role="status"` label. Two approximations are acceptable and not defects: Models is drawn as setting rows although its real content is tables, and the skeletons copy their components' metrics by hand, a judgement call the lap already recorded.

**#4 (ProjectsSkeleton rows were one line, real rows are two): held.** Commit `0cf8289d` draws each `project-row` in `ListRow`'s two-line form: `py-2`, the icon at `mt-0.5 self-start`, and a 20px name bar over a 16px `data-skeleton="repo-path"` bar. That matches `ListRow`'s multiline branch in `ui/list.tsx` (`multiline && 'py-2'`, `mt-0.5 self-start`), which `ProjectCard` uses because it passes `repoPath` as `description`. A test was added: 3 rows, 3 repo-path lines.

**Nothing plainly broken** in the surfaces these fixes touched. Nothing was seen in a browser.

REVIEW-MODE: gates
REVIEW-VERDICT: verified
REVIEW-REASON: no verify commands configured; both fixes confirmed by diff read and re-run repro
