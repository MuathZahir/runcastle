# The feature's right panel, step by step

## Problem

The feature page is a chat on the left and one panel on the right. The panel is
where the human reads the plan, the docs and the work, and today it reads like
a full-window page squeezed into half a window:

- Every view opens with the feature's title, branch and age as a 22px page
  header, though the page's header row already names the feature. About 170px
  of every view goes to saying it twice.
- The views sit in a centred page column with 48px of air on top, made for a
  whole window.
- The plan preview is a bordered box, 60% of the screen tall, inside a page
  that scrolls too: two scrollbars side by side.
- Decisions, spec and every other doc open in a dialog over the whole app,
  hiding the chat the human is talking to about that doc. The Plan view
  reaches them through two monospace file-name buttons.
- The views hide behind a menu in the panel's header, so a view that appears
  (Review, once the feature is ready) goes unseen.
- The docs list labels every doc twice, by title and by file name in code type,
  and says nothing about what changed recently.

## Approach

**For the human.** The panel reads as one panel. Its header shows the views as
tabs. A view starts with its own content in a 24px panel column. The Plan view
is a bar with three small tabs (Preview, Decisions with its count, Spec) and
the part on show filling the rest: the preview edge to edge with its own
scrollbar, decisions and spec as prose at a reading width. Details is one
column: the feature's facts (branch, started, what it waits on and what waits
on it), then its docs by title and age, then the activity feed, closed. A doc
opened anywhere in the panel is read in place, in the view it was opened from,
with a way back, and the chat stays beside it. The round, review and shipped
views keep their insides; they lose the repeated header and sit in the same
column, and their redesign is the follow-on feature "The panel's round, review
and shipped views" (decision 1).

**Designed in design mode** (left uncommitted for the human's yes):

- `apps/web/preview/feature-panel.html` (+ `feature-panel.tsx`,
  `feature-panel-data.ts`): the real app on sample data, the panel standing at
  each step (`?step=early|plan|docs|reader|tickets|round|review|shipped`),
  with a theme switch and a Tweaks menu for the view tabs (icon and word, or
  icons only). The sample docs are the shipped feature "The whole app matches
  the sidebar"'s own, read as text.
- The real components behind it, changed in place: `FeaturePanel` (tabs in the
  header), the new `PanelViewBar`, `PlanBody`, `PreviewPanel` (fills its view),
  the new `DocReader` / `DocProse`, `inspector/Inspector` (`DetailsView` as one
  column), `inspector/Knowledge` (docs by title and age), the new
  `inspector/FeatureFacts`, and `Workspace`'s `documentView` (no repeated
  header, the panel column).

**The shape:**

- **The panel's header** (`FeaturePanel`, decision 3): `Tabs` over the offered
  views, each with its icon. The panel is a size container; under about 520px
  the tabs other than the open one show their icon only. `Tabs` gains a
  per-item tooltip so an icon-only tab still says its name on hover and to a
  screen reader. The design view's path stays after the tabs.
- **A view's frame** (`Workspace` `documentView`, decisions 2, 4, 10): Plan
  lays itself out to the view's full height; every other view is a
  `px-6 pt-5 pb-10` column that scrolls with the panel. `FeatureHeader` stays
  only on a draft's page, where it is the page.
- **The view bar** (`PanelViewBar`, decision 4): 40px, the view's own tabs or
  a way back on the left, facts and actions on the right, sticky at the top
  of the view. Used by Plan and by the doc reader.
- **Plan** (`PlanBody`, decisions 5, 6): tabs from what exists (Preview when
  `full.preview`; Decisions and Spec always), leading with the preview, else
  the spec, else the decisions. The aside carries the part's age, the
  Updating mark while the spec changes, and open-full-window for the preview.
  `PreviewPanel` drops its section, box and fixed height and fills the space
  below the bar; its full-window dialog is driven from the bar.
  `GrillBody` and `ArtifactPane` retire; `ProseSkeleton` moves beside
  `DocProse`.
- **The doc reader** (`DocReader`, decision 7): the view's body gives way to
  the reader. Its bar holds "← <view>", the doc's title and open-full-window;
  under it the path and age as one mono line, then `Markdown` at `base` in a
  680px column, timestamps humanized. The panel's state gains the open doc
  (`PanelState.doc`, a relPath, alongside the design view's `path`), so a doc
  can be opened from any view and a view switch closes it:
  the docs list in Details, the ticket ledger's Docs menu in Work, and the
  shipped record's outcome link in Review all open the reader in their own
  view. `DocPeek` retires (only those panel callers used it).
- **Details** (`DetailsView`, `Knowledge`, `FeatureFacts`; decisions 8, 9): one
  column. `FeatureFacts` is a `PropertyList` (Branch, a click copies it;
  Started or Merged; one row per feature it waits on, with its state; one per
  feature waiting on it). `Knowledge` is a `PageSection` "Docs" of `ListRow`s:
  title, age as meta, folder as the description, relPath as the tooltip,
  ordered brief, decisions, spec, then the rest by path. Activity is a
  `Disclosure` closed by default; its rows are unchanged.
- **Design and Drive** (decision 12): their tab only.
- **The design guide**: `DESIGN.md` §"The feature page: chat-first" and
  `STYLE.md`'s component table describe the panel's tabs, the panel column,
  the view bar and the reader instead of the switcher menu and `DocPeek`.

## Seams

- **`panelReducer` / `PanelState`** (existing, `lib/feature-ui/panel.ts`, tier
  1 in `test/panel.test.ts`): opening a doc sets `doc`; switching or closing
  clears it; opening a doc unfolds a folded panel.
- **The panel's markup** (existing, `test/feature-panel.test.tsx`): the header
  is a tablist naming every offered view; a narrow panel keeps every tab's
  accessible name.
- **`PlanBody`** (existing, replaces `test/preview-panel*.test.*`): which tabs
  show for a feature with and without a preview and spec; the preview frame
  carries no fixed height; Open in design still reaches `onOpenDesign` from
  the frame and from full window.
- **`DetailsView` / `Knowledge` / `FeatureFacts`** (existing,
  `test/inspector.test.ts`): order of docs, title and age per row, the facts'
  rows, Activity closed; a row opens the reader and its way back returns.
- **`DocReader`** (new): title on the bar, path and age line, the prose, back.
- **The preview page** `apps/web/preview/feature-panel.html`: every step
  renders in the real app (checked by eye in design mode, not by a test).

## Out of scope

- The insides of Work (the ticket ledger, the run lanes, the doubled ticket
  list while a round runs), Review and Shipped: the follow-on feature "The
  panel's round, review and shipped views", parked as a draft that waits on
  this one.
- The chat column ("The chat looks the part") and the test drive view ("Test
  drive looks the part").
- The shared theme and building blocks, beyond the tooltip `Tabs` gains.
- The activity feed's rows.
- The plan preview's own content (`preview.html` is each feature's page).
- New behaviour: no new view, action or data (decision 11).

## Open questions

- Which steps look worst to the human (the brief's open question). The docs
  view was named first; the split in decision 1 bets on it.
- Whether the human wants tabs back in the panel at all (decision 3's
  challenge), and with words or icons only (the Tweaks menu).
