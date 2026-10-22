# Outcome — Design mode

While planning, the feature chat docks beside a live story canvas. You iterate on the real components with the agent: it edits them, and the canvas hot-reloads. What you approve is committed to the feature branch, and the tickets then connect it to data and behaviour.

- Shipped: 2026-10-22
- Laps run: 1

## What shipped

57 commits · 137 files

### Lap 1
- 14 tickets landed: #1 The feature chat may write code; Go waits for committed design work; #2 Design server: runcastle runs the chat's preview server per feature; #3 Chat-first feature page with one resizable panel; #6 Design guide skill, and the preview and tickets skills learn about designed screens; #8 Session switcher in the chat column; scenario chat moves in; project page goes chat-first; #9 Design view in the panel: live preview, Select area to the chat, Open in design; #11 Design server: fix: the URL keeps its port, the port variable works on every OS, crops need no permission; #12 Chat column: fix: the feature chat stays in the switcher during a scenario errand, and each session has one terminal; #13 Panel layout: fix: the narrow overlay docks right at full height; project drive controls stay reachable; project chats are distinguishable; #15 Design view: fix: the toolbar never covers the preview, the design view remembers its page, resuming a chat keeps the panel; #17 Feature page: one header row, Go on the tickets view, one collapsed sidebar state; #19 Design view: show the page at a real screen width, scaled to fit, with a width menu; #20 Design view: never strand the human — back to the agent's page, restart the server, show server errors; #22 Design and drive panes: one bar, never over the page; clean server output; Resume says why it failed
- 2 waived: #4 Session switcher in the chat column; scenario chat moves in; project page goes chat-first; #5 Design view in the panel: live preview, Select area to the chat, Open in design
- 0 failed

## Review record

### Lap 1 · review

- Reviewed commit: unknown
- Landed since: 10
- Outcome: cancelled

### Lap 1 · review

- Reviewed commit: 2798d1eed19892bd10b2fd0c6a593013136c904f
- Landed since: 8
- Outcome: done

### Lap 1 · review

- Reviewed commit: 6926df20cf0505976b85fbb4ad0250ccaa226fff
- Landed since: 5
- Outcome: done

### Lap 1 · review

- Reviewed commit: e06c87988683db7c2c995da1f464b6d7f700ef94
- Landed since: 4
- Outcome: done

### Lap 1 · review

- Reviewed commit: unknown
- Landed since: 4
- Outcome: cancelled

### Lap 1 · review

- Reviewed commit: 5602ba8782aecbde2c12384c329e46c0f825d532
- Landed since: 1
- Outcome: done

### Lap 1 · review

- Reviewed commit: 46301817832e7cabc227a318151943dd225421a2
- Landed since: 0
- Outcome: done

- **Drive pass: all five criteria hold on runcastle-demo** — open
- **Select area not exercised: the screen-capture picker can't be granted headless** — open
- **A live test drive lost its sidebar row and header Stop button after moving between pages** — open

## Notes record

- So many headers one after the other. A title header, "Planning with you" row, chat row.. Why is the design this bad.. Also, why do we have the "Plan" and "Design" buttons at the top, it looks so bad. The sidebar can also be minimized and closed. Why would there be two states?? The minimized sidebar is useless. — open
- Also, I don't want the "Go", "Go anyway.." buttons. The buttons should be on the tickets page since it starts the burn. — open

## Per-ticket digests

### Lap 1

#### 2. Design server: runcastle runs the chat's preview server per feature

# Ticket 2: design server

## What was done
- **New service, `packages/server/src/services/design.ts`.**
  - `startDesignServer(ctx, featureId, command?)` runs the command in the feature's talk worktree (`worktreeDir(projectId, slug)`), under the pane id `design:<featureId>`.
  - It picks the port by bind-probing upward from a base derived from the feature id, in the 30000–39999 range. The port is passed to the command as `RUNCASTLE_DESIGN_PORT`.
  - It resolves with `{url, port, command}` once a URL is sniffed, and writes `.runcastle/design.json` when it is given a command.
  - It refuses when there is no command and none is recorded, and also when the talk worktree does not exist yet.
  - A second start with the same command returns the running server. A different command restarts it.
  - Other exports: `stopDesignServer` (with a reason), `heartbeatDesignServer`, `designServerStatus`, `stopDesignServerForSession` and `sweepIdleDesignServers`. The idle check is a single unref'd 60s interval that runs only while a server exists.
  - `configureDesignServers({ now, urlTimeoutMs })` is the test hook for injecting the clock and the timeout.
- **Events:** `design.server_started` {url, port, command} and `design.server_stopped` {reason}. A design server whose process dies on its own also emits `stopped {reason:'failed'}`, and a start still waiting on it rejects with the output tail at once rather than waiting out the 60s timeout.
- **Dev pane:** `pty/dev-pane.ts` now has a lower-level `spawnDevPane({paneId, cwd, command, env, onUrl, onExit})`. It emits nothing and throws if the spawn fails. `startDevPane` wraps it, so drives behave exactly as before.
- **`exitTail` moved** from `launcher.ts` to `pty/exit-tail.ts`, so the design service can use it without an import cycle through the launcher.
- **Stop hooks:**
  - `handlePtyExit` and `endSession` call `stopDesignServerForSession`.
  - `mergeFeatureFlow` stops the server with reason `shipped` after the feature is marked shipped and before the worktree is retired.
- **MCP tools:** `start_design_server` and `show_panel` are registered for the `chat` audience only, and are refused at call time for other kinds (`requireChatFeatureId`). `show_panel` accepts only the five views, refuses `design` when no server is running and none is recorded, and emits `panel.show` {view, path?}.
- **tRPC:** a new `design` router with `status`, `start` (recorded command only), `heartbeat` and `stop`.
- **Tests:** `test/design-server.test.ts` has 19 tests and runs against a real PTY and a real git talk worktree. `chat-contract.test.ts` lists the two new tools.
- **Verification:** the full typecheck passes, and the full suite passed with 0 failures.

## Surprises / deviations
- Ending a **headless** chat session (self-plan, lead-wake, relay) deliberately does not stop the design server, since those runs never open one. Only the human's interactive chat ending stops it.
- `heartbeat` emits no event, which goes against "every mutation emits". This is intentional: it would land every few seconds and change nothing the UI shows. The code has a comment saying so.

## Left undone
- `CLAUDE.md`'s note that "the server registers **24** tools" was already stale, and there are now two more tools. I did not edit it.
- The web side (the panel acting on `panel.show`, sending heartbeats) and the Select-area crop endpoint belong to other tickets.
- I made no changes to the drive machinery: the design server runs only on demand and adds no service or env var the app needs at boot.

#### 3. Chat-first feature page with one resizable panel

# Ticket 3 — chat-first feature page with one resizable panel

**What was done.** The Overview/Chat tabs are gone (`FeatureViewTabs.tsx` deleted). For a started feature, `Workspace.tsx` now renders the topbar, then a feature strip (`data-feature-strip`: the resume alert, the NextStepBar or ReadonlyBanner, the drive prerequisites notice), then `PanelSplit`: the chat fills the page and one panel sits on the right. A draft keeps its old page (header + DraftBody) and has no chat or panel.
- The pure model is `lib/feature-ui/panel.ts`. It holds `PanelView`, `availableViews` (design is dropped once shipped, preview only when one exists, drive only while one is up, nothing for a draft), `bodyLabel`, the reducer, and `panelShowRequest`. Runcastle's opens go through a `follow` action (`go` opens body, `testDrive` opens drive), so the type itself says runcastle opens only after those two clicks.
- `components/workspace/FeaturePanel.tsx` has `usePanel`, `PanelSplit` (with the divider), `FeaturePanel` (header with a Select switcher, fold, close), `PanelStrip` and `PanelButtons`.
  - The size is a 0..1 share, stored in thousandths through `useRailWidth` under `runcastle.feature.panel`.
  - Below 1100px of content width the panel overlays the chat (`@max-[1100px]:absolute`).
- `use-panel-show.ts` opens a new `panel.show` event for this feature, skipping history.
- The views: `DetailsView` (Inspector without its Aside), `FeatureDriveView` (EvidenceStage drive side, no recordings), `PreviewPanel`, and a `DesignView` placeholder with props `{ featureId, path? }`.
- Routes:
  - bare `/f/slug` is the body (the old Overview link);
  - `/chat` is the chat alone (the old Chat link);
  - the other views are path segments (`/preview`, `/design`, `/drive`, `/details`), not `?panel=`, because `currentPath()` only reads the pathname;
  - `/tickets` and `/body` land on the body.
- A remembered `overview` value means body. The default is now the chat alone. Chat notices now target `body`, `preview` or `drive`.
- The palette's "toggle details" now flips the details view. The dead inspector-collapse state (`inspectorCollapsedForPhase`, `toggleInspector`, `showsInspector`) and its tests were removed.
- `PreviewLead` was removed and `planningFills` no longer looks at the preview.

**Surprises.** In this sandbox `bun run typecheck` fails only at its last step, `tsc -p .runcastle/preview/tsconfig.json`. That step can't find `@types/node`, or `@tanstack/react-query` from `fake-api.ts`, at the repo root, because bun installed them per package. core, server, web and scripts all typecheck clean, and no file under `.runcastle/` was touched. The full test suite passes: 357 files passed, 2 skipped. The landing on chat after a session launch still closes the panel (`select(id, 'chat')`).

**Left undone.** ReviewBody's evidence stage still swaps to the live drive, so a drive is visible in both the body view and the drive view. The scenario chat stays docked in ScenarioDrive (the next ticket moves it). The project page is not reshaped. No server emits `panel.show` yet. Drive machinery needed no change (no new service, env var, seed or process).

#### 8. Session switcher in the chat column; scenario chat moves in; project page goes chat-first

# Ticket 8: session switcher, scenario chat in the column, chat-first project page

**What was done**
- **Review body.** `ReviewBody` no longer embeds the live drive. The evidence stage mounts only for recordings and always plays them. While this feature's drive is up, the body shows "A test drive of this branch is live" with **Open the drive**, which opens the panel's drive view (`onOpenDrive`, threaded through `PhaseBody`).
- **Session switcher.**
  - Pure model in `lib/chat-sessions.ts`: entries `{id, label, live}`, `featureChatEntries`, `projectChatEntries`, `shownSession`.
  - `components/chat/SessionSwitcher.tsx` is a Select that sits in ChatView's strip, where the context line was.
- **Scenario chat in the column.**
  - The scenario chat moved out of `ScenarioDrive` into `components/chat/ScenarioChat.tsx`: the `useScenarioChat` state, a `ScenarioChatContext` the drive calls `begin`/`opened` through, and `ScenarioChatView`, a ChatView.
  - `use-feature-chat-column.ts` assembles the feature page's column.
  - Both terminals stay mounted (hidden) while live.
  - Closing the errand only drops it from the switcher; New scenario brings the same session back.
  - `ChatView` now also passes `onEnded` to its `TerminalView`.
- **Project page.**
  - `ProjectWorkspace` now uses `PanelSplit`/`FeaturePanel`/`usePanel`. The left column holds the resting list (New chat, Test drive, chats), the live chat, an ended chat's transcript, or the scenario chat.
  - The switcher lists the live chat plus the past chats. The project crumb steps back to the list.
  - Panel views come from `projectViews`: drive while live, and details labelled "Notes" (the NotesCard) once notes exist.
  - `ProjectChat` lost its own topbar. `ProjectDriveView` lost its topbar: Stop and the notes toggle moved into its header. `ProjectViewSwitch`/`ProjectView` were deleted.
- **DESIGN.md** gained the switcher and the project page.

**Deviations and surprises**
- **Notes default-open.** I kept today's "Notes open while an open note waits" behaviour, now as the panel's default view, and only while the column is at rest. That is a runcastle-initiated open on the project page. Spec decision 5 forbids that for the feature page only.
- **Stopping a project drive** switches the panel to Notes (the old "the inbox is the exit"), or closes it when there are no notes.
- **Project page scenario chat.** It also gets the scenario chat, through the same context; otherwise New scenario on a project drive would open nothing visible.
- **Feature chat label.** The entry reads "Feature chat", or the session kind's name when a lead or drive-fix session is up.

**Left undone**
- **No screenshot critique.** The sandbox has no browser, so the screens were not checked against DESIGN.md with screenshots. Do that at the test drive.
- **EvidenceStage.** It still contains the drive-swap machinery, now used only by `FeatureDriveView` (with `recordings=[]`). It could be simplified later.
- **Drive machinery.** No infrastructure changed, so nothing under `.runcastle/` needed an edit, and none was checked or run.

**Verification:** `bun run typecheck` is clean. `env -u GIT_ASKPASS bun run test`: 364 files, 5028 passed, 48 skipped, 0 failed.

#### 9. Design view in the panel: live preview, Select area to the chat, Open in design

# Ticket 9: design view, crop to chat, Open in design

**What was done**
- Server: new `design.sendCrop({ featureId, png, text })` on the existing `design` router. It's thin over a new `services/design-crop.ts`, kept separate from `services/design.ts` because the launcher already imports `design.ts`, and a crop needs `writeToLiveTerminal` from the launcher.
  - It saves the PNG at `designCropsDir(featureId)/<timestamp>.png`. `designCropsDir` is a new helper in core `paths.ts` that resolves to `<dataDir>/design-crops/<featureId>`.
  - It types `[Screenshot: <path>] <text>` into the feature's live, non-headless `chat` session. Newlines in the text are flattened to spaces so one remark is one submission.
  - It emits `design.crop_sent` {path}.
  - With no live chat, or when the terminal write fails, it throws a GateError: "the chat is not running — open it, then select again". Tests: `packages/server/test/design-crop.test.ts`.
- `DrivePanel` takes `sendTo?: 'note' | 'chat'` (feature target only).
  - `chat` sends the crop through `design.sendCrop` and uses design wording: "Send to chat", "Open in a new tab", "What should change?".
  - Drive behaviour is unchanged (`drive-panel-target.test.tsx`).
- `DesignView` replaces the placeholder:
  - running: the iframe at url + path, with the drive toolbar;
  - recorded command only: starts it once, with a spinner and "Starting the design server…";
  - neither: an empty state.
  - It heartbeats on mount and then every 60s while `document.visibilityState === 'visible'`.
  - A server that stops while the view is up shows "The design server stopped" with "Start it again". It is not restarted on its own.
  - `design.status` is now invalidated by every pushed event in `lib/live.ts`, which is how `server_started` / `server_stopped` reach the view.
- `PreviewPanel` takes `onOpenDesign(path)`. Both frames (inline and full window) accept `{ type: 'runcastle:open-design', path }` only from their own `contentWindow`, and the path must start with `/` (`openDesignPath` in `lib/preview-frame.ts`). The full-window dialog closes as the design view opens. `Workspace` dispatches `open design` (origin `human`).

**Deviations and surprises**
- Close is the panel header's existing ✕, which matches the approved look's header. I did not add a second Close to the floating toolbar. The path is likewise already shown in the panel header (ticket 3).
- happy-dom tries to load a real iframe `src`, so `design-view.test.tsx` turns on `disableIframePageLoading`. Harmless "loading is disabled" lines still print.
- I did not take or critique screenshots against DESIGN.md: the sandbox can't run the app. I checked the states against DESIGN.md's text instead (EmptyState rules, spinner only beside a word).

**Left undone**
- No drive machinery change was needed (no new service, env var, seed or process), so I didn't run or check the drive scripts.
- Crops in `design-crops/` are never cleaned up. Removing them at ship or archive would be a follow-up.

#### 12. Chat column: fix: the feature chat stays in the switcher during a scenario errand, and each session has one terminal

# Ticket 12 — the feature chat stays in the switcher during a scenario errand; one terminal per session

**What was done**
- Root cause of both defects: `activeSession` (apps/web `lib/feature-ui/gates.ts`) returned *any* live session, so a live `scenario` session was read as the feature's own. The switcher named the feature-chat entry "Scenario", `FeatureChat` mounted a second (hidden, 0×0) TerminalView on the scenario session, and the status line / next step read it as the agent working. `activeSession` now passes over `kind === 'scenario'` (the launcher's `assertSpawnable` already treats scenario chats as docked to the drive, not the feature).
- Server: `liveSessionOf` in `services/features.ts` (feeds `feature.list` → sidebar "Agent working" lane) skips scenario sessions the same way. `activeSessionsForFeature` itself is unchanged.
- `useFeatureChatColumn` now takes the feature's `sessions` and derives the feature chat's entry itself (moved from Workspace.tsx), so the column test drives it from real session rows.
- `TerminalView` never fits or sends a resize while its container is 0×0 (hidden); the existing ResizeObserver refits once shown. The on-`live` resize is guarded the same way.
- Tests: `chat-column.test.tsx` now renders the real `FeatureChat` and adds three repro tests (verified red before the fix: entries were `['Scenario', …]` and two terminals for one session id); `feature-ui.test.ts` and `feature-list.test.ts` cover the selection; new `terminal-view.test.tsx` (fake xterm/fit addon, fake WebSocket, controllable layout) covers no-resize-while-hidden and refit-on-show (verified red before the fix: a 2×1 resize was sent).

**Repro re-run:** the reviewer's repro is a live drive, which cannot run in the sandbox; I re-ran it as the tier-2 DOM tests above (scenario session live → switcher lists "Feature chat" + "Scenario chat · New scenario", one terminal per session, switching back and forth keeps the one scenario terminal). Full `bun run typecheck` (incl. .runcastle/preview) and `bun run test` (5051 passed, 0 failed) are green.

**Surprises:** `ScenarioDrive.tsx` already had no TerminalView after #8 — the duplicate came entirely from `FeatureChat` picking up the scenario session.

**Left undone:** `lead-delivery.ts:217` (headless lead wake skipped while any session is live) and `feature-worktrees.ts:94` (worktree kept while any session is live) still count a scenario session — arguably right for the worktree, debatable for the lead wake; not in this ticket. No drive machinery change was needed (no new service, env var, seed or process).

#### 13. Panel layout: fix: the narrow overlay docks right at full height; project drive controls stay reachable; project chats are distinguishable

# Ticket 13 digest

**What was done**
- Narrow overlay: `FeaturePanel.tsx` built the `@max-[1100px]:` variants at runtime, so Tailwind never emitted them. They are now one whole-literal string (`PANEL_OVERLAY`). `test/panel-overlay.test.ts` (tier 1) checks that the panel renders absolute/inset-y-0/right-0/z-20/shadow-dialog under the 1100px variant, and that every overlay class it renders is written as a literal in the source. That test fails on the old file and passes on the new one. Build check: `vite build` of apps/web, then a grep of the emitted CSS. All five rules now sit inside `@container not (width>=1100px){…}` (absolute, inset-block:0, right:0, z-index:20, the --elevation-dialog shadow).
- Project drive controls: `ProjectDriveView` now puts its header (Driving <branch>, Stop drive, Hide notes, meta line) above the `AsideLayout` instead of inside it. Below 4xl the notes aside floats only over the stage row, never over the header. A new tier-2 test in `project-drive-workspace.test.tsx` checks that both buttons sit outside the aside's row and that both clicks work. It fails on the old layout. At wide widths the aside now starts under the header rather than at full panel height, a small visual change.
- Switcher: `projectChatEntries` (lib/chat-sessions.ts, used only by the project page) labels each past chat `<title> · <age>` using the resting list's `relTime`, for example "Untitled chat · 32d". The live chat's label is unchanged. `SessionSwitcher.tsx` was not touched.
- `ProjectWorkspace` has a topbar **Test drive** button while a chat is in front and no drive is up. It starts the blank app and opens the drive in the panel, the same `follow testDrive` path as the card. While another drive holds the slot it is disabled and its title names the holder. DESIGN.md's project-page paragraph is updated to match.

**Repro re-run**
- For finding 1, I re-ran the build-and-grep check: the classes are present now and were missing before.
- For finding 2, I did not run the `elementFromPoint` check in a real browser, because the sandbox has none. The structural test stands in for it.

**Surprises**
- None beyond the ticket's own diagnosis. The full suite (365 files, 5049 passed) and `bun run typecheck`, including the `.runcastle/preview` step, were green.

**Left undone**
- `AsideLayout` in `PreparationWorkspace` and `ReviewBody` may have the same "aside floats over a header" risk in narrow containers. I did not check them because they are outside this ticket.
- No drive machinery changed.

#### 15. Design view: fix: the toolbar never covers the preview, the design view remembers its page, resuming a chat keeps the panel

# Ticket 15 digest: design view toolbar, remembered page, resume keeps the panel

**What was done**
- **Toolbar.** `DrivePanel` takes `toolbarPlacement: 'floating' | 'bar'`, default `floating`, so drives look as before. The panel is now an outer column holding an optional bar plus a `relative` stage, which contains the iframe and every overlay (selection shade, crop composer, the floating toolbar). `panelRef` points at the stage, so in bar mode the selection and the crop are measured against the frame alone. `DesignView` passes `bar`.
- **Remembered page.** `services/design.ts` keeps a `lastPaths` map per feature. It is separate from `servers`, so it survives a stop or restart, but it lives in memory and is lost when the runcastle server restarts. `rememberDesignPath` sets it, and `designServerStatus` returns `lastPath` when one is set. `toolShowPanel` records the path for `view: 'design'`. A new `design.showPath` tRPC mutation lets the web record one: `DesignView` calls it whenever it gets an explicit path (Open in design, `show_panel`). It falls back to `status.lastPath`, then to the server root. The panel reducer no longer drops the design path when switching to another view and back.
- **Resume keeps the panel.** A new pure `landingView()` in `lib/land-on-chat.ts` is used by `ProjectShell`'s land-on-chat. If the launch is for the feature on screen, its current view (drive, design…) stays, and so does the URL segment. Another feature, the project page, preparation, or a draft's Start still lands on the chat alone.
- Each fix has a test that failed before the change: `drive-panel-target`, `design-view`, `panel`, `design-server` (show_panel plus the tRPC path), and `land-on-chat`.

**Surprises**
- The bug sat in `ProjectShell.tsx` (`select(featureId, 'chat')`), not in `Workspace.tsx` as the ticket suggested.
- Remembering a path emits no event, deliberately and the same way as the heartbeat. The view that opens the path already shows it, and `show_panel` already emits `panel.show`.

**Repro re-run**
- This sandbox has no app or browser, so I could not repeat the reviewer's visual steps.
- Instead, each defect was reproduced as a failing test and then fixed:
  - toolbar elements inside the frame's floating layer;
  - a bare reopen loading `/`;
  - landing after a resume with the drive open switching the view to `chat`.

**Verification**
- `bun run typecheck`: 0 errors.
- `env -u GIT_ASKPASS bun run test`: 366 files passed, 2 skipped; 5073 tests passed, 48 skipped, 0 failed.
- Drive machinery: no new service, env var, seed or process, so `.runcastle/` was left unchanged.

**Left undone**
- The ticket's optional "collapse to chat on a narrow window": the overlay is a CSS container query, and the shell cannot tell whether it is active.
- The panel header shows the path only when the reducer holds one, not when the path comes from `status.lastPath`.

#### 17. Feature page: one header row, Go on the tickets view, one collapsed sidebar state

# Ticket 17 — one header row, Go on the tickets view, one closed sidebar state

**What was done**
- **Sidebar.** It has one collapsed state now, closed: zero width, and the icon rail (`SidebarRail`) and its `rail` prop on `Frame` are gone. While it is closed, every `PageTopbar` starts with a "Show sidebar" button. `Frame` provides it through a new `SidebarDoorContext` in `ui/page.tsx`. Ctrl/⌘+B still toggles it. A drag under half the minimum width (110px) closes it. The storage key `runcastle.sidebar.collapsed` is unchanged, so a stored `'1'` simply opens as closed. `FrameApi.collapsed` was renamed to `closed`, and `closeSidebar` was added.
- **Panel toggle.** `panel.ts` remembers `last` (the view last on show, including one the shell opened) and gained a `toggle` action. `PanelButtons` was replaced by a single `PanelToggle` icon button ("Show/Hide the panel"). On the project page it carries the open-notes badge.
- **One header row.** On the feature page it is the title, then `FeatureStatusLine` (now a quiet single line, in a new `PageTopbar` `status` slot), then the switcher, at most one `HeaderAction`, the ⋯ menu and the panel toggle. A new pure `headerActions(ns, status)` in `status-line.ts` builds on `leadActions`:
  - Go goes to the tickets view.
  - The status's primary gets the one header button.
  - Failing that, Merge & ship gets it, but only when the resolver itself offers a merge. The planning resolver does, so planning shows Merge & ship, as in the human's screenshot.
  - Everything else goes into ⋯ (`FeatureAction` gained `disabled` and `hint`).
- **Removed.** The feature strip and the `ChatView` header row are gone. `ChatView`, `FeatureChat`, `ScenarioChatView` and `ProjectChat` lost `contextLine`, `meta`, `switcher` and `branch`.
- **Where the strip's contents went:**
  - The resume alert, the drive-prerequisites notice and the "What to test" disclosure (new `WhatToTest`) now sit as notices atop the chat column.
  - The read-only banner for a pinned phase now sits atop the body.
- **Switcher.** `SessionSwitcher` is now a dropdown menu. Session rows are `menuitemradio`; extra items and a hint line follow them.
  - New `FeatureSessionSwitcher` adds End session (via a new `EndSessionItem`) and "One transcript per feature" to it.
  - In front, the scenario chat gets its errand hint, Close and End session instead.
- **Go.** It is in `TicketsBody` above the list (new `GoAction`). When gated it shows the reason beneath, and a "Go anyway…" link only for an unfinished plan. It opens the existing Go dialog through `runAction('burn')`.
- **Project page.** One header row. The switcher is the crumb after the project, so the project crumb stays clickable. Its menu holds "Lands on <branch>" and End session.
- **NextStepBar.** Only drafts use it now, so its `status` and `demote` props and `OVERFLOW_KINDS` were removed.
- DESIGN.md was updated (Frame, Page anatomy, the feature and project page sections), and the affected tests were rewritten.
- Gates: `bun run typecheck` is clean. The full `bun run test` run had 0 failures (5097 passed, 48 skipped).

**Surprises**
- `panel.ts` did not track a last view, despite the ticket saying so. I added it.
- The planning resolver offers Merge & ship, so "only when offered" still puts Merge in the planning header.
- The status label "(1)" badge is part of the panel toggle's accessible name ("Show the panel (1)").
- **No screenshots.** The sandbox has no browser (no Playwright or Chromium), so the critique against DESIGN.md was done from rendered markup and tests only. A human should eyeball the 44px row at narrow widths: the crumb is capped at 60% when a status is present, and the status truncates first.

**Left undone**
- The QuickForm ("create") view has no `PageTopbar`, so while the sidebar is closed it shows no reopen button. Ctrl/⌘+B and the palette still work there.
- The project chat's short session id, which the old chat strip showed, is no longer shown anywhere.
- `SidebarResizeHandle` in Sidebar.tsx is only used by its test. I left it alone.
- The drive machinery is untouched: this was a UI-only change, with no services, env vars or seeds, so no drive script needed checking.

#### 19. Design view: show the page at a real screen width, scaled to fit, with a width menu

# Ticket 19: design view at a real screen width, scaled to fit

**What was done.**
- Added `apps/web/src/lib/preview-width.ts`. It is pure and holds:
  - `frameSize(width, pane)`, which returns `{ width, height, scale, left }`;
  - the presets (Desktop 1440, Laptop 1280, Tablet 768, Mobile 390, Fit);
  - the label `1440 · 61%`, or `Fit`;
  - the remembered width under `runcastle.preview.width`, in try/catch like `rail-width.ts`.
- `DrivePanel` measures its stage with a ResizeObserver. At any width other than Fit the iframe is `absolute`, sized W × paneHeight/scale, and drawn with `scale(s)` from its top-left corner. A width narrower than the pane is centred at scale 1.
  - Fit keeps the old flex-1 frame.
  - Switching width restyles the iframe but does not remount it, so the page keeps its state.
  - The drive and the design view both get this, because both render `DrivePanel`.
- New `components/review/WidthMenu.tsx`, built on the `Select` primitive with `SELECT_GHOST` and tabular-nums. It sits in the toolbar's first group, after Open.
- `show_panel` takes an optional `width` (an integer from 200 to 3840). It is sent in the `panel.show` event data, and only for `design`.
  - On the web side it goes through `panelShowRequest`, the reducer's `open` (`PanelState.width`), then `DesignView`, then `DrivePanel`.
  - The width holds for that design open and survives a switch to another view and back. A later design open without a width, or Close, drops it.
  - An agent-asked width is never written to localStorage.
- The tool description and the design guide's §3 now mention `width: 390`.

**Deviation.** The ticket asked to wrap the frame in a container of the scaled size. Instead the stage clips (`overflow-hidden`) and the frame is placed absolutely inside it. The effect is the same, and the selection overlay stays a sibling of the iframe, as the existing toolbar-placement test requires.

**Select area.** I made no code change here. The marquee and the crop are measured against the stage box, and the capture reads composited on-screen pixels, so a crop over the scaled frame is exactly what was dragged over. This was reasoned from the code, not run: there is no `getDisplayMedia` in the sandbox.

**Surprises.** None of note. Typecheck is green. The full suite passed: 368 files passed, 2 skipped.

**Left undone.**
- I did not do the DESIGN.md screenshot critique: there is no browser or app in this sandbox.
- If the agent asks for the same width twice in a row after the human changed the menu in between, the second ask doesn't re-apply. The prop didn't change, so the effect doesn't fire.
- No drive machinery is affected: no service, env var, seed or process was added.

#### 22. Design and drive panes: one bar, never over the page; clean server output; Resume says why it failed

# Ticket 22 — digest

**What was done**
- `DrivePanel` has a single toolbar row (`role="toolbar"`, "Page controls") above the frame everywhere. The floating variant and the `toolbarPlacement` prop are gone, so drives (ScenarioDrive, EvidenceStage) use the bar too, and nothing sits over the frame. A new `leading` slot sits before the panel's own controls. The Select area crop is still measured against the stage box only (the test checks this).
- `DesignView` no longer has its own line. Back to <path> is now an icon button (the path is in its label/tooltip) in the `leading` slot. Restart server and Show/Hide output moved into a ⋯ "Design server" menu at the end of the row. The output terminal now opens *below* the frame, not above it, so nothing stacks between the header and the toolbar.
- The panel header path: a new `useDesignPath(featureId, path, enabled)` hook (in DesignView.tsx) gives back the explicit path, else `design.status.lastPath`. Workspace passes that to `FeaturePanel`.
- `exitTail` (packages/server/src/pty/exit-tail.ts) now strips OSC sequences before `stripVTControlCharacters`, plus any leftover control bytes. It also collapses consecutive repeated blocks of lines. Node's stripper only removed `ESC]0;C` from a Windows title, which is why the tail started with `:\WINDOWS\system32\cmd.exe`. The launcher's `session.pty_exited` tail uses the same function, so it gets the same cleaning.
- The "Test drive running" card is not a ToastProvider toast. It is the chat column's NoticeDeck. In ChatView at rest the floating layer now covers only the transcript, never the Resume bar. The drive card has `expiresAfterMs` (`DRIVE_NOTICE_MS` = 5s) and FeatureNoticeDeck dismisses it when that runs out. Other cards still never expire.
- A refused launch now shows its message under the Resume button (`launchError`, role=alert, from `launch.error`). The existing toast is still there.

**Surprises**
- `Workspace`'s `launch` mutation already toasted on error. My guess is the 6s toast in the far corner went unseen while clicks were landing on the deck card. That is why the inline message was added.
- DrivePanel never had a "fullscreen" control. The finding probably took the Select area icon for one. I added none.

**Left undone / not verified**
- I could not re-run the reviewer's repro (1600×950 in the live app, design and drive panes) or do the screenshot critique: this sandbox has no running app. The tests encode the repro instead: one toolbar row, nothing over the frame, header path from lastPath, the recorded Vite/cmd.exe output, the deck clear of Resume.
- ProjectChat's Resume doesn't pass `launchError` (ProjectWorkspace's `talk` hook owns that launch). Only the feature chat was in the finding.
- If the row is narrow, a long "Scenario: <name>" gets clipped (the bar is `overflow-hidden`, no wrap), not ellipsised.
- Drive machinery: nothing changed that needs it (no new service, env var, seed or process).
