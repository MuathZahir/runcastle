# Outcome — Designs and the plan get their own place

Designs and the plan show up as cards in the chat like Review Packages, and the Design tab always lists every design for the feature, so nobody digs through the plan to find them.

- Shipped: 2026-11-03

## What shipped

25 commits · 83 files

- 4 tickets landed: #1 Designs: the record, the agent's tools and the cards' events; #2 Designs: the cards, the Design tab and the dots on the desktop; #3 Designs: the cards on the phone; #4 Skills: the plan and designs in the agent's words
- 0 waived
- 0 failed

## Review record

### Ticket 5 · review

- Reviewed commit: 42aae0b3b0fd1bb1ddb814fcd65806d89abb6fd5
- Landed since: 0
- Outcome: done

- **Test gate red at 42aae0b: the terminal kill-tree test saw the grandchild still alive** — dismissed
- **Phone "…" menu now offers Design on every feature, labelled "Running now", with no design to open** — fixed
- **If telling the lead fails on the last Approve, the one "all approved" message is lost for good** — dismissed
- **The skill says show_design refuses with no server running; the tool never refuses** — fixed
- **Desktop shows "Approve & next" before the design has loaded, even when its server is down or the port is unreachable** — fixed
- **Design card hover veil uses raw colours (black color-mix, text-white), against STYLE.md** — dismissed
- **Duplicated rules between web and server, and two unused exports** — open
- **Procedure named design.planSeen where the spec names plan.seen** — open
- **Not driven: every on-screen criterion is unverified in a running app** — open

## Notes record

- No human notes

## Per-ticket digests

### 1. Designs: the record, the agent's tools and the cards' events

# Ticket 1 — Designs: the record, the agent's tools and the cards' events

## What was done
- **Core.** `packages/core/src/designs.ts` holds the wire type (`DesignEntry`, `DesignState`, `DesignApprover`), exported from the core index. The web lib `apps/web/src/lib/feature-ui/designs.ts` now imports and re-exports those types, and keeps its helpers. A new `designs` table (unique on featureId + path) and the `features.plan_shown_at` / `plan_seen_at` columns were added, with migration `0058_milky_black_knight.sql`. The table is also registered in `server/src/db/schema.ts`. A new path helper, `designPicturesDir(featureId)`, gives `~/.runcastle/designs/<featureId>/`.
- **Thread fold.** There are two new events, `plan_shown` and `design_shown { designId }`, and two new items, `plan_card { older? }` and `design_cards { designIds, older[] }`. Cards are placed the same way as a review package (that code is now one shared `placeCard` helper). Consecutive designs in one turn join a single group. A pass at the end (`markOlderCards`) marks older cards. `ChatThread.tsx` returns null for both new kinds.
- **Service** `server/src/services/designs.ts`:
  - It provides recordDesign (upsert by path), setDesignState, approveDesign, markDesignSeen, markPlanShown/markPlanSeen, planIsNew, listDesigns, leadDesigns and designsWaiting. Every write emits an event: `design.shown`, `design.state`, `design.approved`, `design.seen`, `plan.shown` or `plan.seen`.
  - Showing a design again resets it to waiting, sets `approvedBy` to null and sets `seenAt` to null. Showing the plan sets `planSeenAt` to null. Resetting the seen time to null, rather than comparing timestamps, keeps "new again" correct even when the show and the seen happen in the same millisecond.
- **Pictures.** I pulled `showFile`'s reach and size checks out into an exported `showableFile(ctx, session, path, tool)` in `threads/shown.ts`. `show_design` copies a picture with it, and only accepts image files. Pictures are served by the new `routes/designs.ts`, mounted at `/api/designs/:featureId/pictures/:file`.
- **MCP tools.** `show_design`, `show_plan` and `set_design_state` are offered to chat only and added to the allowlist in `artifacts.ts`. `show_panel` now only offers `work | review | details | drive`; its zod error names show_plan and show_design. The panel-open helper still accepts plan and design internally. `start_design_server` and its parameter text now say "design page". `get_feature_context` gains `designs[]` and its description explains it.
- **tRPC** (all on the design router): `design.list` returns `{ designs, plan: { isNew } }`, so the plan's seen state is checked through the list. The plan-seen procedure is **`design.planSeen({ featureId })`**. There are also `design.approve` and `design.seen`. Approve delivers one `[runcastle]` line through `deliverToLead`, with source 'runcastle', and only when no design is left waiting. A design that is not waiting returns `{ approved: false }` and delivers nothing.
- **Need.** `NeedFacts` gains `designsWaiting` and `oldestDesignWaitingSince`. They are gathered in `services/feature-need.ts`.
- **Tests:**
  - New `server/test/designs.test.ts` covers show_design (upsert/reset/cards/panel only when someone is watching/picture copy plus route), show_plan (refusal, card, plan isNew), set_design_state plus lead context, approve's single delivery and double-click no-op, seen, and the need.
  - The fold tests are in `core/test/thread.test.ts`; the need tests are in `core/test/feature-need.test.ts`.
  - I updated the show_panel tests in `lead-mcp-tools` and `chat-contract`, and removed the three design-view show_panel tests from `design-server.test.ts` because that behaviour now lives in show_design.

## Surprises
- If the lead shows a design again without a picture or width, the stored picture and width are cleared, so a card never shows a picture of an older version.
- The approve line names every approved design, including ones the lead approved, and asks the lead to commit only "each one not yet committed".

## Left undone
- The skills (`feature/references/planning-alone.md`, `design.md`, `preview.md`) still tell agents to call `show_panel({view:'plan'|'design'})`. That call is now refused, and the skill rewrite belongs to a later ticket. The web's `panel.ts`, `Workspace.tsx` and the design views still handle `panel.show` plan/design events; the server still emits those through show_plan and show_design.
- Drive machinery: this ticket adds no service, env var, seed or process, only a migration that runs at boot. Nothing under `.runcastle/` needed changing. I did not run it.

### 2. Designs: the cards, the Design tab and the dots on the desktop

# Ticket 2 — Designs on the desktop: cards, Design tab, dots, pass-through

## What was done
- **Server.** `design.planFigures({ featureId })` returns the plan card's figures: the `## n.` headings in decisions.md, the count of numbers on its `Check first:` line (0 when there is no such line), the implementation tickets (null when there are none) and the designs. The logic is `planFigures` / `decisionFigures` in `services/designs.ts`. `design.status` now also returns `passPort` (serverPort + 2, from config, and not tied to the phone link). The design pass-through answers `GET /__runcastle/ping` with 204 and `Access-Control-Allow-Origin: *`. The pass-through already bound `SERVE_HOSTNAME` (127.0.0.1), the same as the app, so I did not widen it.
- **One design address.** `apps/web/src/lib/design-address.ts` provides `designAddress`, `designPingAddress` and the `usePassReachable` probe (3s timeout). `components/design/PassUnreachable.tsx` shows the "forward port N" message with the ssh line and a Retry button.
  - The desktop `DesignView` frame and its pop-out both use `useDesignServer().address`, and so does the phone's `phoneDesignSrc`. The phone no longer falls back to localhost.
  - I removed `designFrameUrl` and `useDesignPath`.
- **Web wiring:**
  - `ChatThread` renders `plan_card` and `design_cards` through `design/ThreadCards.tsx` (`PlanCardItem`, `DesignCardsItem`). Workspace supplies a `ThreadCardsContext` provider; outside a feature page the cards render nothing.
  - The new `design/DesignTab.tsx` shows the list, or the bar over `DesignView`. Approve & next works out where to go next before approving, waits for the approval, then opens the next design or returns to the list.
  - `availableViews` now offers Design whenever the feature is not shipped (I dropped `designRunning`). There is a new panel action `designList`, used by All designs, the "Design tab" link, "Design to approve" and the Design tab's own click.
  - Seen marks: `useMarkSeen` in `lib/use-designs.ts` marks the open design and the shown Plan view as seen. The dots come from `design.list` and appear on the toggle and on the tabs.
  - The merge dialog names designs still waiting and says they will not ship.
  - `live.ts` invalidates `design.list` and `design.planFigures`.
- **Bridge removed.** I removed `PREVIEW_OPEN_DESIGN_MESSAGE`, `openDesignPath`, the PreviewFrame listener (the Escape relay is kept), `PlanBody.onOpenDesign`, and their tests.
- **Tests:**
  - New: `design-tab.test.tsx`, `thread-design-cards.test.tsx`, `designs.test.ts` (`nextWaiting` / `approvalProgress`), `design-address.test.ts` (address builder and unreachable message), a merge-dialog line test, a planFigures test in `designs.test.ts`, and a ping test in `design-pass.test.ts`.
  - Updated: panel, design-view, phone-shell, feature-page, preview-* and design-server.
- **Checks.** `bun run typecheck` is clean. `preview/designs.tsx` still bundles (`bun build`); it is not covered by any tsconfig.

## Visible changes (deviations)
- In the Plan view, the "Preview" tab is now "Overview" and the full-window dialog title is now "Plan" (decision 13).
- The panel header no longer shows the design path; `FeaturePanel` lost its `path` prop. The DesignBar names the open design instead.
- A path that matches no recorded design (an older server opened from the empty state) shows the live page under a bar with only "← All designs".

## Surprises
- `usePanel` never keeps `width`, so an agent's width never reached the view. DesignTab passes the recorded design's width directly.
- The pass-through's cookie is `Secure` (ticket 1 / phone code). That is fine on localhost, over an SSH tunnel and over Tailscale https, but a plain-http non-localhost origin would drop it. The pass-through also routes by one cookie per origin, so two features' designs open in two tabs share it, and the last one opened wins.

## Left undone
- The skills still tell agents to use `data-open-design` and `show_panel` for the plan and design (ticket 4).
- The rest of the phone side (ticket 3). DrivePanel's iframe title still reads "the design preview" (I did not touch DrivePanel).
- Drive machinery: no new service, env var or seed, so nothing under `.runcastle/` changed.

### 3. Designs: the cards on the phone

# Ticket 3 — Designs: the cards on the phone

## What was done
- **Phone Design screen** (`components/phone/PhoneDesignView.tsx`): it reads the design record. When the open page (the panel's path, or the server's last page) is a recorded design, the screen:
  - uses the design's title in its bar and lays the frame out at the design's recorded width;
  - marks the design seen (`design.seen` via `useMarkSeen`);
  - while the design waits, offers **Approve & next** (other designs still wait) or **Approve** (the last one) in the bar, beside the Desktop/Phone toggle. Approve & next moves to `nextWaiting`, which is computed before the mutation. The last Approve goes back to the chat.
  - Approve shows only once the frame can actually load, so nothing is approved unseen. The new prop `onOpen(path)` is how the screen moves to the next design.
- **Shared Approve & next:** I pulled DesignTab's approve logic into `useApproveAndNext` in `lib/use-designs.ts`. DesignTab and the phone both use it, so the order (read next, approve, invalidate, move) lives in one place.
- **Phone "Design to approve"** (Workspace `runAction('openDesign')`): on a phone it opens the oldest waiting design. That is the new pure `oldestWaiting` in `feature-ui/designs.ts` (smallest `shownAt` among waiting designs). If none waits, it falls back to the old `designList` dispatch. The desktop is unchanged.
- **Cards on the phone:** they already rendered through `ThreadCardsContext`. A card tap already dispatched `open design <path>`, which on the phone is the phone's Design screen. `ThreadCardsTarget.onOpenDesignList` is now optional, and the phone leaves it out, so the design group shows no "Design tab" link (the phone has no list).
- **Phone width:** I kept the cards' two-column grid. It is `grid-cols-2` (minmax(0,1fr)), and every title and label truncates under `min-w-0`, so tiles are about 165px at 390px and nothing overflows. I checked this by reading the classes; happy-dom does no layout, so no test measures it.
- **Pass-through:** it was already the shared builder plus probe (ticket 2), and that is unchanged.

## Tests
- New `test/phone-design.test.tsx`, with the page host set to `desk.tail1234.ts.net` through happy-dom `setURL`. It covers:
  - the frame and probe going only to `https://desk.tail1234.ts.net:4514/...`;
  - the recorded width;
  - the seen mark;
  - Approve & next followed by the last Approve going back;
  - no Approve on an approved design;
  - the unreachable port message, then Retry loading the frame.
- `phone-shell.test.tsx` gains app-level tests: a main thread with `design_shown` events shows the cards with no Design tab link, and tapping a card opens the Design screen on that design and marks it seen. The need's "Open design" opens the oldest waiting design.
- `designs.test.ts` gains tests for `oldestWaiting`.
- `bun run typecheck` is clean, and 80 tests across the 7 touched or adjacent files pass.

## Surprises
- The phone's need button is only the chat's waiting line. It needs a main thread with items; with an empty chat there is no button at all.
- On a phone the header button reads "Open design" (`PRIMARY_ACTION`), not "Design to approve".

## Left undone
- `phone-views.ts` still describes the Design choice in the "…" sheet as "Running now", which is stale now that Design is always offered. I left it alone because it is outside this ticket.
- With "Approve & next", the phone bar is crowded at 390px: the title truncates to about 120px.
- Drive machinery: no service, env var, seed or process was added, so `.runcastle/` is untouched.
