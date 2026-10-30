# The feature's right panel, step by step

## Problem

The feature page is a chat on the left and one panel on the right. The panel
reads like full-window pages squeezed into half a window, and it says too much:

- Every view opens with the feature's title, branch and age as a 22px page
  header, though the page's header row already names the feature.
- The views sit in a centred page column with 48px of air on top.
- The plan preview is a bordered box inside a page that scrolls too: two
  scrollbars side by side.
- Decisions, spec and every other doc open in a dialog over the whole app,
  hiding the chat the human is talking to about that doc.
- The views hide behind a menu, so a view that appears goes unseen.
- Work shows a running round twice: as run lanes, then again as the ticket
  ledger, with a run timeline and a history picker besides.
- Review is a long page (notes composer, rounds trail, evidence, open work,
  ready declarations, accounts) that mostly repeats what the header, the
  tickets and the drive already say. Its notes are about what the human sees
  in the drive, but they live a view away from it.

## Approach

**For the human.** The panel has three views, as tabs: **Plan**, **Tickets**
and **Details**, plus **Design** and **Drive** while they run. No view repeats
the feature's title; each starts with its own content in a 24px column.

- **Plan**: one bar with Preview, Decisions (with its count) and Spec; the part
  on show fills the rest. The preview edge to edge with its own scrollbar;
  decisions and spec as prose.
- **Tickets**: one list. Earlier rounds folded to one line each at the top;
  below, the current round's tickets as sidebar-style rows: `#seq` and title at
  14px, then a 12px line saying the state in words and the model. Running
  words shimmer. A row opens in place into a card with its actions, goal,
  done-when criteria and the live log or what the worker said. A review
  ticket's card carries what the review found and its walkthrough.
- **Details**: one column: the feature's facts (branch, started or merged,
  what it waits on, what waits on it), its docs by title and age (the outcome
  first once merged), then Activity, closed.
- **Drive** is untouched here: "Test drive looks the part" makes it a full page
  of its own, with the notes in its rail (decision 23).
- **Review is gone.** Its notices sit atop the chat; its findings and
  recording are the review ticket's; the shipped record is Details. The notes
  for the agent go to the drive's rail.
- **Docs** are read in the panel, in the view they were opened from, with a
  way back, never in a dialog.

**Designed in design mode** (left uncommitted for the human's yes). The
preview page `apps/web/preview/feature-panel.html` (+ `feature-panel.tsx`,
`feature-panel-data.ts`) renders the real app on sample data at each step:
`?step=early|plan|docs|reader|tickets|round|ready|shipped`, with a theme
switch and a Tweaks menu (view tabs: icon and word, or icons only). The real
components behind it, changed in place:

- `workspace/FeaturePanel` (tabs in the header), new `workspace/PanelViewBar`;
- `bodies/PlanBody`, `PreviewPanel` (fills its view), new `DocReader`
  (`DocReader`, `DocProse`);
- `inspector/Inspector` (`DetailsView` one column), `inspector/Knowledge`,
  new `inspector/FeatureFacts`;
- new `bodies/tickets/TicketsView` (`TicketsView`, `splitRounds`, the row and
  the folded round);
- `lib/feature-ui/panel.ts` (Review never offered; Work labelled Tickets);
- `Workspace` (`documentView`: no repeated header, the panel column; Work
  renders `TicketsView`; Details gets `FeatureFacts`).

The designs carry the look; their actions are drawn but not all wired. The
build connects them without restyling.

**The shape of the build:**

- **Tickets** (decisions 17–19): `TicketsView` takes over every behaviour
  `RunBody` and `TicketsBody` had that the human still reaches: stop, resolve a
  landing conflict in a terminal, reassign the model, edit, cancel, copy a SHA,
  the live log
  (`LaneTranscript` with its boot events), each lane's elapsed and duration,
  and one model for every waiting ticket (the "…" menu). A done review
  ticket's card shows its findings (the feature's findings for that ticket)
  and plays its recorded walkthrough in the existing evidence stage, full
  window. `RunBody`, `components/run/*` that nothing else uses, `TicketsBody`,
  `TicketLedger`, `TicketRow` and the run timeline retire.
- **Review retired** (decisions 14, 15): the `review` panel view is never
  offered and an address naming it lands on Tickets. `ReviewBody`,
  `ShippedBody` and the review bands only they used retire. The conflict
  alert, the refused-drive card, the nothing-verified alert and the
  project-drive-blocking notice become standing rows on the chat's notice
  strip (decision 21): `NoticeStrip` takes rows that hold while their condition
  does, with an optional action. The shipped record's
  facts are Details': "Merged" from the shipped time, the outcome doc first.
- **Notes** (decision 23): not this feature's. `OpenWork`, `NoteComposer`,
  `SendToAgent`, `WorkList` and `NotesRail` stay for test drive to take; whatever
  it leaves unused goes when this branch merges its change.
- **The doc reader** (decision 7): `PanelState` gains the open doc (a
  relPath), cleared on a view switch or close; an open doc unfolds a folded
  panel. The view on show renders `DocReader` in its place with "← <view>".
  The docs list, the Tickets "…" menu's docs and Details all open docs this
  way. `DocPeek` and `DocsMenu` retire if nothing else uses them.
- **Plan** (decisions 5, 6): `GrillBody` and `ArtifactPane` retire;
  `ProseSkeleton` moves beside `DocProse`.
- **Tabs** (decision 3): `Tabs` gains a per-item `tooltip` so an icon-only tab
  names itself on hover and to a screen reader.
- **The design guide**: `DESIGN.md` §"The feature page: chat-first" and
  `STYLE.md` describe the three views, the tabs, the panel column, the view
  bar, the reader and the ticket row.

**Order** (the orchestrator's merge order, 2026-10-30): this feature lands last
of the four screen features. Round 1 builds Tickets and the frame and docs. The
retirement of Review waits for "The chat looks the part" to merge and this
branch to merge main, because its warnings go into that feature's notice strip
on the composer's top edge. The chat has merged and this branch has main. On
this branch Review is already not offered, so nothing ships until that round
has landed.

## Seams

- **`panelReducer` / `availableViews` / `PANEL_VIEW_LABEL`** (existing,
  `test/panel.test.ts`): Review never offered; Work labelled Tickets; the open
  doc set, cleared on switch and close, and opening a doc unfolds the panel.
- **`parsePath`** (existing, `test/routes.test.ts`): `/review` lands on Tickets.
- **`splitRounds`** (new, exported from `TicketsView`): which round is
  current (running; else the waiting tickets as the next round; else the
  latest), which fold.
- **`TicketsView` markup** (new, tier 1): a row's words per state, a review
  row's "Reviewed", folded rounds' one-line facts.
- **`TicketsView` actions** (tier 2, replacing `test/run-body-model.test.tsx`
  and friends): stop, retry, model, edit and cancel reach the same tRPC calls
  `RunBody` and `TicketsBody` made.
- **`PlanBody`, `DetailsView`, `DocReader`** (tier 1/2): tabs per existing
  doc; doc order and facts; reader back.

## Out of scope

- The chat column ("The chat looks the part") and the drive view ("Test drive
  looks the part"), including moving the notes into it.
- The shared theme and building blocks, beyond `Tabs`' tooltip.
- The activity feed's rows; the plan preview's own content.
- New behaviour: every action kept is one the panel already had.

## Open questions

- Test drive merges before this feature. This branch takes its change when it
  lands, and the panel's Drive tab follows whatever it decides. If it has not
  landed when the rest is done, the orchestrator is told; nothing is built
  around it.
