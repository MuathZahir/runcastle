# Outcome — Expandable review stage with persistent side notes

The test-drive/walkthrough stage on the review page can expand to near-fullscreen with annotation tools intact, and the notes panel lives in a permanent side rail instead of below the fold.

- Shipped: 2026-09-14
- Laps run: 1

## What shipped

10 commits · 24 files

### Lap 1
- 2 tickets landed: #1 Two-pane layout with permanent notes rail; #2 Shared stage expand: CSS overlay owned by EvidenceStage, F retargeted
- 0 waived
- 0 failed

## Review record

### Lap 1 · review

- Reviewed commit: 61ecf2e4751292a7d37840a3163947745d21c2cc
- Landed since: 0
- Outcome: done

- **Managed drive contains no reviewable feature** — open

## Notes record

- No human notes

## Per-ticket digests

### Lap 1

#### 1. Two-pane layout with permanent notes rail

# ticket(1) — Two-pane layout with permanent notes rail

## What was done

The review page is now two panes. `Workspace`'s existing `twoPane` mode was
extended to cover `review`, so the page stops being the centered `.ws-body`
scroller; `ReviewBody`'s root is a flex row holding a main column
(`flex-1`, its own `overflow-y-auto`, padding `px-7 pt-5 pb-8` standing in for
the old `ws-body`/`ws-body-inner` 18/28/32px) and a new
`components/review/NotesRail.tsx`. The rail is the frame only — width, hairline,
`bg-panel-2`, drag handle — and `OpenWork` is its content, restructured into the
rail anatomy the prototype pins: heading fixed at the top, rows in a scroll
region of their own, composer pinned at the bottom behind a `border-t`. The
open-work band is gone from the column; the rest of decision 18's band order is
untouched.

Three pieces of machinery came out of this rather than being copied. The
features rail's width clamp/persist moved to `lib/rail-width.ts`
(`useRailWidth(spec)`), with `lib/sidebar-width.ts` and the new
`lib/notes-rail-width.ts` as its two specs; the drag handle moved to
`components/RailResizeHandle.tsx` with a `side` prop, since the notes rail is on
the right and so widens as the pointer travels *left*. `SidebarResizeHandle`
survives as a three-line wrapper holding the features rail's own label and
clamp, which keeps `sidebar-resize.test.tsx` and the shell untouched.
`--notes-rail-w: 360px` is in `theme.css` beside `--artifact-w`; the rail
overrides it inline as you drag, clamped 260–560 and persisted under
`runcastle.notesrail.w`.

The marker-to-note spotlight no longer calls `scrollIntoView` — that walks every
scrollable ancestor, which is the habit the rail exists to end. `WorkList` takes
an optional `scroller` ref and moves that box by a `getBoundingClientRect`
delta. The note-to-stage jump was **kept**, not dropped as the ticket floated:
`scrollIntoView` on `#evidence-stage` now has only the main column to move, so
it is correct where it stands and still saves a stage scrolled below the alerts
band. Only the comment changed.

## Surprises

- One existing assertion in `review-bands.test.ts` encoded the very band order
  this ticket revises (`Carried, still open` must follow `What still needs
  attention`). Since the open work is now the *last* element in the markup, that
  ordering inverted. It was re-anchored to the lap-account line, which is the
  band that genuinely precedes the carried one in the column.
- `--artifact-w` and `--maprail-w` look like resizable-rail tokens but are not:
  the only drag/persist machinery in the app was the features rail's. So "the
  same machinery the other rails use" meant extracting it first.
- `packages/server/test/dev-pane.test.ts > kills the child process tree` fails
  in this sandbox, confirmed on a targeted single-file run and identical before
  and after every change here. It asserts a process *group* is reaped, which no
  `apps/web` change can touch — an environment fault, not this ticket's. The
  rest is green: typecheck 0 errors, 3667 passed / 4 skipped.
- The baseline quoted in the prompt (118 files, 1768 tests) does not match this
  repo, which runs 251 files / 3672 tests. Worth correcting for later tickets.

## Left undone

- `StatusStrip`'s open-work chip is still `<a href="#open-work">`. The id still
  resolves — it is on the rail's section now — so the link is harmless, but it
  is a no-op: the rail is always on screen, so there is nothing to jump to. It
  probably wants to become a plain chip, or to spotlight the rail. Out of this
  ticket (the strip and the note-row anatomy were both explicitly unchanged) and
  `status-strip.test.ts` asserts the href.
- The duplicated 16:9 wrapper (same `aspect-video` / max-height string on both
  the walkthrough frame and the drive wrapper) is untouched — the spec parks
  that unification with the expand work, which owns `EvidenceStage`.
- No responsive behaviour was added, per decision 2. Below roughly 900px the
  main column is squeezed hard by a 360px rail; the human can drag the rail down
  to 260px, and that is the whole answer this lap.
- Drive machinery: nothing to update. This ticket adds no service, no required
  env var, no seed and no process — only `apps/web` markup plus one CSS token —
  and `.runcastle/drive-setup.ts` already ships the web bundle via
  `RUNCASTLE_WEB_DIST`. I verified both `.runcastle/drive-setup.ts` and
  `drive-stop.ts` are present and that the `drive.env` channel is unchanged; I
  did **not** run them (this sandbox has no services, as instructed).

#### 2. Shared stage expand: CSS overlay owned by EvidenceStage, F retargeted

# ticket(2) — Shared stage expand: CSS overlay, F retargeted

## What was done

The evidence stage can take the window. `ReviewBody` holds the expanded flag and
hands the stage a small `StageExpand` value (`{ expanded, set }`, from the new
`lib/stage-expand.ts`); expanded, the page's two-pane root becomes
`fixed inset-0 z-[100] flex bg-bg`, the main column drops its scroller and its
padding shrinks, and every band but the stage — alerts, status strip, drive
instructions, lap account, carried findings, the disclosure — stands down. The
notes rail is untouched in both states, which is the point: the rail and the
stage are what the overlay holds. The stage element itself is built once into a
`stage` const and rendered from either branch, so a drive ↔ walkthrough swap
happens under an expand without disturbing it.

The duplicated 16:9 wrapper is now `stageFrame(expanded, 'screen' | 'prose')` in
`EvidenceStage`, and the walkthrough player takes the result as a
`frameClassName` prop rather than spelling the string out for itself — collapsed
it is `aspect-video` + the viewport clamp, expanded `min-h-0 flex-1` with
neither. The player's `requestFullscreen`/`exitFullscreen` path and its
`stageRef` are deleted; `F` and `Escape` now run through `useStageExpandKeys`,
which is mounted **twice, deliberately**: by the player while a recording is on
the stage (disabled while annotating, so a drawing keeps Escape) and by
`EvidenceStage` while the drive is. That is the one place I deviated from the
ticket's literal shape — it says F lives in the player's own keydown handler.
Binding the same hook on whichever side owns the stage was the only way I found
to keep the annotating guard without plumbing the player's `annotating` state
upward, and it is what makes the drive side work at all.

Coverage: `evidence-stage.test.ts` gained the control and the two frame sizings
(tier 1); `walkthrough-player.test.tsx`'s fullscreen test became three — F asks
the stage, F/Escape collapse, and neither does anything mid-annotation;
`stage-expand.test.tsx` is new and tier 2, measuring the overlay at the review
page: bands away, rail and annotation tools kept, Escape and F, and the
drive/walkthrough swap under an expand.

## Surprises

- **`ShippedBody` mounts the same stage.** It is not two-pane and has nowhere to
  expand into, so `expand` is optional on both `EvidenceStage` and the player:
  handed none, the stage renders no control and binds no keys. The side effect
  is real and worth knowing — the shipped record's walkthrough had an F
  (native fullscreen) and now has no expand at all. The ticket's "delete the
  native path entirely" leaves no other option inside this scope.
- **`view.rerender(sameElement)` does not re-render.** React bails on identical
  element identity, so the drive↔walkthrough test had to rebuild its element to
  let the mocked query answer differently. Worth knowing for any later test that
  drives this page through a state change.
- **The baseline in the prompt is still wrong** (as ticket 1 reported): this repo
  runs 252 files / 3685 tests, not 118 / 1768.
- `packages/server/test/dev-pane.test.ts > kills the child process tree` fails
  here, identically before and after this ticket — it asserts a process *group*
  is reaped, which no `apps/web` change can touch. Everything else is green:
  typecheck 0 errors, 3680 passed / 4 skipped / 1 failed.

## Left undone

- `StatusStrip`'s `<a href="#open-work">` chip is still a no-op (ticket 1 noted
  it); it is now also hidden while expanded, which changes nothing about it.
- The expanded column keeps the stage's own `DriveFooter` (dev chip) when a
  drive is up. It rides inside `#evidence-stage`, like the walkthrough transport
  bar, so I read it as stage chrome rather than a band — if the human disagrees
  it is a one-line change in `EvidenceStage`.
- Nothing responsive: at a narrow window the 360px rail squeezes the expanded
  stage exactly as it squeezes the collapsed one (decision 2 rules breakpoints
  out).
- Drive machinery: nothing to update — this ticket adds no service, no required
  env var, no seed, no process; it is `apps/web` markup, one new lib module and
  one new test. I confirmed `.runcastle/drive-setup.ts` and
  `.runcastle/drive-stop.ts` are both present and unchanged by this branch, and
  did not run them (no services in this sandbox, as instructed).
