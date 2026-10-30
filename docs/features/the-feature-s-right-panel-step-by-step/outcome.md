# Outcome — The feature's right panel, step by step

Rework how the feature page's right panel looks at each step: plan, tickets, the running round, review, shipped, and the docs.

- Shipped: 2026-10-30

## What shipped

24 commits · 117 files

- 3 tickets landed: #1 Tickets: wire the one-list Tickets view and retire the run lanes and ledger; #3 Frame and docs: docs read in place in every view, the dialog and grill pane retired, tab tooltips, the guide; #5 Panel: retire the Review view; its warnings become standing rows on the chat's notice strip; no human Retry
- 1 waived: #2 Panel: retire the Review view; its notices go atop the chat, notes into the drive
- 0 failed

## Review record

### Ticket 4 · review

- Reviewed commit: unknown
- Landed since: 3
- Outcome: cancelled

### Ticket 6 · review

- Reviewed commit: b0cc3845218926a224d967a5762c9a29f46db3e4
- Landed since: 0
- Outcome: done

- **The old /review address lands on Details, not Tickets, when Details was the last tab open** — fixed
- **Unverified: notes, composer and Send to agent in Details, because no demo feature could reach "agent declared ready" or "drive up"** — open
- **Unverified: earlier rounds folded to one line, because no demo feature has more than one round** — open
- **Docs list rows can't be told apart when two docs share a title, worse when the panel is narrow** — open
- **A failed review ticket's card says the same error three times** — open

## Notes record

- No human notes

## Per-ticket digests

### 1. Tickets: wire the one-list Tickets view and retire the run lanes and ledger

# Ticket 1 — Tickets view wired; run lanes and ledger retired

**What was done.** `bodies/tickets/TicketsView.tsx` now holds every read and mutation the old Work view had. All of it lives in `TicketsView` and reaches the rows through one `TicketControls` object:
- **Stop** (ticket.stop), shown as "Stopping…" while in flight, with RunBody's swept/no-agent/timeout toasts.
- **Retry** (ticket.retry). On a landing conflict it is labelled "Resolve with agent".
- **Retry on…** (ticket.edit, then ticket.retry). Only offered when no run is live (ADR-0006).
- **Retry fresh**, behind a confirm.
- **Set aside** (ticket.cancel with a reason; the server kills a live agent first).
- **Resolve in terminal** (feature.launchSession + ticketConflictKickoff). The conflict's files are listed in a "Merge conflict" part.
- **Model picker** (ModelMenu, ticket.edit), **Edit** (TicketEditor, kept open when a save fails) and **Cancel** behind TicketRow's confirm.
- **Copy SHA**, as a "Commits" part in a done ticket's card.
- **The "…" menu** sets every waiting ticket's model with sequential client edits, then one invalidate and one toast.

Boot events, the elapsed timer, duration and `hadOutput` (launch-failed vs failed) now come from each ticket's latest attempt (the last run whose events mention it), not from the run's start. A done review ticket's card lists its findings (matched on `reviewTicketId`, defects first, observations quieter). When a recording exists, "Watch the walkthrough" opens `EvidenceStage` in a full-size Dialog.

Deleted: RunBody, `components/run/*` except LaneTranscript, TicketsBody, TicketLedger, TicketRow, `RoundSections` (from ui.tsx and STYLE.md), and the lib derivations only those used (`laneBands`, `soloRetrySeq`, `unrunnableGates`, `roundNumberOf`). Their tests went too. The still-live cases moved: the laneFacts case to `tickets-view.test.tsx`, transcript hygiene to `transcript-hygiene.test.ts`, and eventWarns to `activity.test.ts`.

New test `test/tickets-view.test.tsx` (21 cases) covers:
- splitRounds: running, waiting-next, latest, and before any round.
- Each row's words per state, including a review's "Reviewed".
- A folded round's one line.
- A ticket's own timer and boot events.
- Every action reaching its tRPC call. Retry on a model is checked as edit-then-retry in that order.
- The confirms, findings, walkthrough and bulk model.

**Deviations / visible changes.**
- **Cancel and Set aside are one button.** For a pending ticket it is "Cancel"; for a failed or stopped one it is "Set aside". Both go through an inline confirm (TicketRow's strip), and both call ticket.cancel. The server treats them the same, and two buttons would have duplicated the action.
- **Retry fresh** uses the same inline confirm instead of the deleted ConfirmDialog.
- **Added parts in the opened card:** Merge conflict, Findings and Commits, plus a ModelMenu in the action row.
- **The row's model** still shows only an explicitly assigned model, as designed. The default model is used only to pick the live log's runtime.

**Surprises.**
- RunBody had already dropped Retry and Waive (commit cc2c827b: "a failed ticket is the agent's"). I restored them from that commit because the ticket asks for them.
- `land-on-chat.test.tsx` lists launch sites, so it now names TicketsView.
- `content-skeletons.test.ts` lost the TicketsSkeleton case: the designed view renders nothing while it loads.
- `preview/feature-page.tsx` (an old preview, not typechecked) imported TicketLedger. Its Work view is now a one-line pointer to feature-panel.html.

**Left undone.**
- The run timeline was the only place `eventWarns` (oversized digest, sandbox CLI drift) was emphasised. `eventWarns` is kept, and inspector/Activity could adopt it.
- "Verification unavailable" (gate_unrunnable) and the run digest disclosure no longer show anywhere.
- `verdictStrip`, `runHeadline` and `summaryCounts` in lib/feature-ui/run.ts are now used only by tests.
- `DocPeek` is still imported by ShippedBody, which another ticket owns.

**Drive machinery.** Untouched: this ticket adds no service, env var, seed or process.

**Verified.** `bun run typecheck` passes with 0 errors. These targeted test files pass (8 files, 115 tests): tickets-view, activity, transcript-hygiene, content-skeletons, land-on-chat, round-trail, flow-derivations, run-settle.

### 3. Frame and docs: docs read in place in every view, the dialog and grill pane retired, tab tooltips, the guide

# Ticket 3: the frame and docs

**What was done.**
- **Panel state.** `PanelState` has a new `doc` field (a relPath). There are two new reducer actions:
  - `openDoc` sets the doc and unfolds a folded panel. It does nothing when no view is open.
  - `closeDoc` is the reader's way back.
- **When the doc is dropped.** The doc goes away on `switch` (even to the view already open), `close`, `toggle`, and an `open` or `follow` of another view. An `open` of the view already on show keeps it.
- **usePanel.** `usePanel` in FeaturePanel.tsx remembers which view the doc was opened in. When the shell shows another view (address bar, history), it drops the doc for good, so coming back shows the view and not the stale doc. This is a small `useEffect`, covered in feature-panel.test.tsx.
- **The reader.** When `panel.state.doc` is set, Workspace renders `DocReader` in place of the open view, with "← <view label>". `DetailsView` lost its local `reading` state and now takes `onOpenDoc`. TicketsView takes `onOpenDoc`, and its `ListMenu` has a "Docs" group listing `full.docs` by title. Nothing else in that file changed.
- **Deleted:** GrillBody, ArtifactPane and DocsMenu. `ProseSkeleton` moved into DocReader.tsx. DocPeek is kept: only ShippedBody still uses it.
- **Tab tooltips.** `Tabs` items take an optional `tooltip`, which wraps the tab in `Tooltip`; the label stays its accessible name. FeaturePanel passes each view's label as the tooltip, but only for the inactive tabs, since those are the only ones whose word hides.
- **The guide.** DESIGN.md (§Frame's Page column and Aside notes, §"The feature page: chat-first") and STYLE.md (the Tabs row, plus the workspace and view tables) now describe the three views, the tabs, the 24px panel column, PanelViewBar, the reader, the Tickets row and one-column Details. Neither says where notes live.

**Tests:**
- `panel.test.ts`: Review is never offered, plus a block of five reducer cases for the doc.
- `feature-panel.test.tsx`: a tablist naming every view, a tooltip on focus, and the doc dropped when the shell changes view.
- `preview-panel*.test.*` and `preview-placement.test.ts`: rewritten for the PlanBody tabs with and without a preview or spec, the frame with no fixed height, and full window plus Open in design reached through PlanBody's bar.
- `design-view.test.tsx`: finds the tablist.
- `feature-page.test.ts`: new tab and Plan cases. The Review, shipped and old "run lanes above the ledger" cases are deleted, since ticket 1 had retired the lanes and that case was failing.
- `inspector.test.ts`: doc order, facts rows, Activity closed, and a row calling onOpenDoc.
- `tickets-view.test.tsx`: the menu's Docs item calls onOpenDoc.

**Verified.** `bun run typecheck` passes with 0 errors. 12 targeted test files pass (160 tests).

**Surprises.**
- The ticket said "DetailsView takes a `notes` node" only in the spec. That is not in this ticket's to-do list, so I did not add it.
- feature-page's run-lanes case was failing on the branch since ticket 1.

**Left undone.**
- The `'review'` view type, ReviewBody and ShippedBody are still there (a later ticket removes them).
- Comments in routes.ts and use-history-sync.ts still mention DocPeek.
- DESIGN.md's "Go is on the tickets view" bullet is stale; I left it.
- Drive machinery: untouched. No service, env var, seed or process was added, so there was nothing to check.

### 5. Panel: retire the Review view; its warnings become standing rows on the chat's notice strip; no human Retry

# Ticket 5 — retire Review; warnings on the chat's notice strip; no human Retry

**What was done**
- `PanelView` no longer has `review`. `RETIRED_VIEWS` maps `review → work`, so `/…/review`, a remembered tab and `show_panel({view:'review'})` all land on Tickets. `hasReview` and `reviewRan` are gone. The "Review ready" chat notice now opens Tickets.
- `NoticeStrip` takes a `standing` prop of `StandingNotice` rows (type in `lib/chat-notices.ts`). They render before event notices with the same 44px row, never fold, have an action and ✕ only when given, and put the tooltip in `title`. Event rows still go through `EventRow`, so they behave as before. The prop passes Workspace → FeatureChat → FeatureNoticeDeck.
- `lib/standing-notices.ts` (`standingNotices`, pure) builds the rows: Merge conflict, Conflict resolved, Review couldn't drive (dismissible), Nothing verified (no button) and the project drive holding the slot (Stop it). `workspace/use-standing-notices.ts` reads the inputs using ReviewBody's logic, reuses Workspace's `useResolveConflict` and `driveInfo`, and keeps the denial dismissal. Nothing shows once shipped. Review artifacts are fetched only when the feature has a review ticket.
- Details takes a `notes` prop. Workspace passes `DetailsNotes` (OpenWork with notes only) while a drive of this feature is up or the agent has declared ready, and never once shipped.
- TicketsView: Retry, Resolve with agent, Retry on…, Retry fresh, Set aside and `ticket.retry` are removed. A failed ticket shows Cancel with the same confirm as a pending one.
- Deleted: ReviewBody, ShippedBody, DocPeek, ConflictCard, ReviewDriveDeniedCard, NothingVerifiedAlert, ProjectDriveBlocking, FullAccounts, ReferenceTier, RoundTrail, StatusStrip, `lib/round-trail.ts`, `lib/use-success-settle.ts` (only ShippedBody used it), and `verdictStrip`/`runHeadline`/`summaryCounts`, plus their tests. `stage-expand.ts` stays because EvidenceStage and WalkthroughPlayer use it.
- Tests: `standing-notices.test.ts` (each row's condition, words and acts), standing-row cases in `notice-strip.test.tsx`, `panelViewOf`/`parsePath`/`panelShowRequest` for review, feature-page cases (notes appear only when declared or with a drive up; "Merged 3h ago" from the shipped event), and tickets-view (no Retry; failed → Cancel). Pure tests from the deleted card files were kept.

**Surprises**
- `Feature` has no shipped time, so "Merged" still relies on the `feature.shipped` event alone. There is no fallback.
- `panel-show.test.tsx` and `workspace-state.test.ts` used 'review' as a valid view, and typecheck did not catch it.
- `apps/web/preview/feature-page-data.ts` used 'review' too. It is not typechecked, but I fixed it.

**Left undone**
- `notes-rail-width.ts` was already imported only by its test before this ticket. NotesRail is kept as asked.
- The merge toast in Workspace still says "resolve below and retry", from the old card layout.
- `LaneTicketFigure` still has `kind`, `reviewFix` and `reviewVerdict`, used only by the deleted `runHeadline`.
- Drive machinery: no infra changed, so I made no edit and checked nothing.
