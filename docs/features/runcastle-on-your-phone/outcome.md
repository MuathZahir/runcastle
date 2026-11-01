# Outcome — Runcastle on your phone

A private link and a phone view let the human use runcastle from their phone: the feature list and the chats, with no drives.

- Shipped: 2026-11-01

## What shipped

27 commits · 83 files

- 4 tickets landed: #1 Phone: the list and a full-screen chat; #2 Phone: the chat by touch, and read-only views; #3 Phone: the private link in Settings; #4 Phone: live designs through a pass-through
- 0 waived
- 0 failed

## Review record

### Ticket 5 · review

- Reviewed commit: ff325ec24508f5efe6b0db873bc11cda10d5de92
- Landed since: 0
- Outcome: done

- **The chat bar's Back adds a history step, so the phone's own Back then goes back into the chat** — fixed
- **The phone's "Jot a note" box still shows desktop keyboard hints and has no Save or Close to tap** — fixed
- **A chat's error line with a long path is cut off at the screen's right edge instead of wrapping** — fixed
- **Table cells on the phone break words mid-word ("PowerShel / l")** — fixed
- **The shown-file viewer's Close and Download are 24px targets on the phone** — fixed
- **Review Package screenshots and walkthrough could not be checked: the drive's copied data has no review files** — open
- **The phone link itself was not exercised; Settings shows "On your phone" with Turn on** — open
- **The drive ended by itself late in the walk; one shown-file read was left unconfirmed** — open
- **Phone chats still show notices that point at desktop-only setup** — open

## Notes record

- No human notes

## Per-ticket digests

### 1. Phone: the list and a full-screen chat

# Ticket 1 — Phone: the list and a full-screen chat

## What was done
- **`Sheet` / `SheetRow`** (`src/ui/sheet.tsx`, exported from `src/ui.tsx`, listed in STYLE.md). `Sheet` is a `Dialog` at a new `size="sheet"`: it sits on the screen's foot, rises in and pads for the home bar. So it gets Dialog's portal, Escape, backdrop dismissal and focus handling, and there is no second overlay. `Dialog`'s panel classes became two small lookups (place, look) so the sheet does not stack two animation or radius utilities on one element.
- **Frame**: on a phone (`useIsPhone()`) it renders `PhoneFrame`. That is either the sidebar content at full width (`phoneShows="list"`) or `main` at full width, with no margins, no resize handle, no closed state, safe-area padding and `h-full` (no `vh`). Ctrl/⌘+B is not bound on a phone.
- **ProjectShell**: on a phone the landing never picks a feature and never restores a stored one. A bare `/p/<id>`, or an unknown slug, is the list. The same applies to a popstate. Tapping a row opens the feature on `chat`. The CommandPalette and Settings are not mounted on a phone. `nothingOpen` drives `phoneShows`. Before the landing it reads the address, so a stored selection never flashes.
- **Sidebar** on a phone: `PhoneListHead` (ProjectSwitcher + "+" sheet with New chat / Jot a note) and `ComputerUnreachable`. That warning shows while `useLiveStatus()==='offline'` or `feature.list` errors, says the list's age, and clears itself. Hidden on a phone: search, CreateMenu, collapse, foot and drive cards, PrepRow, row and Orchestrator menus, nested threads.
- **components/phone/PhoneChatBar.tsx**:
  - `PhoneChatBar` has Back, the title, status words with a warning dot for waiting or ready, and "…".
  - With more than one published thread, the title gets a chevron and opens a Threads sheet: pick, plus New thread.
  - The views sheet offers Plan, Tickets and Design only, each with a hint.
  - `PhoneViewScreen` shows one view full screen with "Back to the chat".
- **phone-views.ts** holds the pure mappings between them.
- **Workspace** and **ProjectWorkspace**: on a phone the chat bar replaces PageTopbar, the panel and strip are never passed, and the drive is never mounted. A Plan, Tickets or Design view replaces the chat (the chat stays mounted and hidden). An address naming Details or Drive shows the chat. The Orchestrator never shows its drive or Notes card. A new `onBackToList` prop does `select(null)`.
- **Tests**:
  - `test/sheet.test.tsx` checks Dialog's mechanics through the Sheet.
  - `test/phone-shell.test.tsx` is tier 2 at the app level, using AppAt, shell-fakes, fakeTrpcFetch and a stubbed `matchMedia`. It covers the list with no desktop chrome, a tap opening the chat, browser Back, a reload at the chat, "…" opening Plan with Details absent, a Details address showing the chat, the Orchestrator threads sheet, the + sheet (note capture and new chat), and the offline warning appearing and clearing on the stream's `ready`.
  - Typecheck is green, and the 30 existing web test files that touch these components pass.

## Surprises / deviations
- The chat's address is `/p/<id>/f/<slug>/chat`, because the existing scheme makes the bare `/f/<slug>` Work (Tickets). I kept the scheme rather than changing desktop routes. A bare feature link on a phone still lands on the chat for a fresh browser (the remembered view defaults to chat).
- The bar's Back (to the list, and from a view to the chat) navigates forward, by pushing an entry. It is not `history.back()`. The browser's own Back still works as the criteria require, but after tapping the bar's Back, Android Back goes back into the chat.
- Visible differences from `preview/phone.html`: the head uses the real `ProjectSwitcher` (logo, 13px semibold) instead of the preview's hand-rolled 16px switcher. The warning's age reads "12m ago" (the app's `relTimeAgo`), not "12 minutes ago". The chat bar's title is the feature's title, as in the design, so the thread in front is named only in the Threads sheet.
- The chevron and Threads sheet appear only with more than one thread, as the ticket says. So a feature with only its main chat cannot start a side thread from the phone.

## Left undone
- I did not compare the screens against `/preview/phone.html` at 390px in a browser, because this sandbox has none.
- A chat notice that opens Details or a drive still writes `/details` or `/drive` to the address, though the phone shows the chat. Hiding those notices belongs to the chat-notices sibling ticket.
- The Design view on a phone is the existing `DesignView`, Select area included. The pass-through and phone widths are later tickets.
- The loading skeleton (`FeatureSkeleton`) still shows the desktop topbar briefly.
- This ticket adds no service, env var, seed or process, so the drive machinery needed no edit. I did not run it.

### 2. Phone: the chat by touch, and read-only views

# Ticket 2 — Phone: the chat by touch, and read-only views

## What was done
Every phone difference reads `useIsPhone()`; no new breakpoint was added.
- **Composer:** on a phone, Enter adds a new line and only Send sends (`isComposing` handling is kept). There are no Kbd hints and no Tab guess (the suggestion is dropped on a phone). The placeholder is shorter ("Message the agent" / "Steer the agent"). The textarea is 16px so iOS does not zoom. Image remove buttons are always visible. Attach, Stop and Send use a new `touch` (40px) size on `Button`/`IconButton` in `ui/button.tsx`, recorded in STYLE.md.
- **ThreadColumn on a phone:** no meter and no meta line. While the agent works it passes no footer, so it shows only Working, Stop and Send. `ModelControls` drops its "Effort" word to fit 390px.
- **Ask docks:** `DockFooter` now takes `left` (always shown) and `keys` (desktop only). On a phone, choices are 44px full-width rows, the Other field is 16px, and the dock is capped at 75dvh with its body scrolling, so the answer buttons stay reachable.
- **Thread:** hover message actions are not rendered on a phone. Markdown's root gains `wrap-anywhere`, so long paths break instead of widening the page; fenced blocks still scroll sideways. Image runs in shown files use `grid-cols-1`.
- **Read-only:**
  - TicketsView on a phone has no list "…" menu and no Stop, Resolve, model, Edit or Cancel; only "Open review package" stays.
  - PlanBody and DocReader drop "Open full window".
  - On a draft's page, `NextStepBar` renders nothing on a phone, `DependenciesRow` is a read-only line, and DraftBody says "Ask the Orchestrator to start this."
- **Dialog `size="full"`** is edge to edge on a phone (`min-h-dvh`, no margin, no corners). This changes `Dialog` in `src/ui.tsx`, not the Sheet. Because of it, the Review Package and FileViewer fill the screen. The package's Close/Prev/Next use the `touch` size.
- **Notices:** `FeatureNoticeDeck` hides drive-target notices on a phone. It takes a new `readyToTest` prop from FeatureChat (`waitingReason === READY_TO_TEST`) and shows the "Ready to test. The test drive is on your computer…" line.
- **Setup screens:** the first-run wizard, OpenProject (screen and dialog) and Preparation show a new `OnYourComputer` component ("Set this up on your computer."). PortfolioHome on a phone renders without the Frame sidebar and without "Open a project". ProjectCard hides its hover menu.
- **Tests:** these are tier 2 and stub `matchMedia` through a new helper, `test/phone-width.ts`.
  - New file `phone-chat.test.tsx`: Enter at phone vs desktop width; no kbd; dock answers; the ThreadColumn footer idle vs working.
  - Phone cases added to the tickets-view, preview-panel-dialog (Plan), review-package, feature-notice-deck, portfolio-home, first-run-wizard, open-project and preparation-workspace tests.

## Surprises
- Start and the base-branch form on a draft's page come from `Workspace.tsx` (ticket 1's file) through `NextStepBar` and `DependenciesRow`, so I gated those two components rather than Workspace.
- `ReviewPackagePage` already lays out with Tailwind `md:` classes; I left them.

## Left undone
- The standing "Stop it" row for a project drive still shows on a phone. It does not open a drive.
- The FileViewer header buttons and FormDock's TextFields are still desktop-sized: 24px buttons, and 14px text that iOS zooms into on focus.
- Safe-area insets on the full-screen dialog are left to ticket 1's viewport work.
- None of this was checked on a real phone or in a 390px browser, only in happy-dom.
- No drive machinery changed: no new service, env var, seed or process.

### 3. Phone: the private link in Settings

# Ticket 3 — Phone: the private link in Settings

## What was done
- `packages/server/src/services/phone-link.ts`: wraps the `tailscale` CLI through an injected `ExecFn`. It exports `phoneLinkStatus`, `turnPhoneLinkOn`, `turnPhoneLinkOff`, `phoneDesignPort(config)` (= serverPort + 2, for ticket 4) and `LINUX_OPERATOR_HINT`. It finds the binary by name, and on win32 also tries `C:\Program Files\Tailscale\tailscale.exe`; a found path is quoted in the `commands` shown to the human. `status --self --json` decides missing, stopped or running and gives the DNS name with its trailing dot removed. `serve status --json` gives the served ports (the `TCP` keys), and `on` means the app port is among them. turnOn serves the app port, then the design port, with `serve --bg --https=<port> http://127.0.0.1:<port>`. If one fails, it turns back off what that same call turned on and returns `error` (the CLI's stderr and stdout) plus `commands`. On Linux the `sudo tailscale set --operator=$USER` hint goes first in `commands`. turnOff removes only those two ports, and only ports that serve actually holds, because the CLI errors on removing a handler that isn't there.
- `trpc/routers/phone-link.ts`, registered as `phoneLink`: `status` (query), plus `turnOn` and `turnOff` (mutations with a `{projectId}` input). Each mutation returns the fresh status. On success it emits `phone_link.changed` with `emitProject`; a failed attempt emits nothing. CLI commands run with a 15s timeout and no stdin, because `tailscale serve` can block on a tailnet where HTTPS is off.
- Web: `settings/PhoneLinkSection.tsx` is rendered on GeneralPage beside Appearance, so it shows even while `settings.get` is loading or has failed. It covers the missing, stopped, off, on and failed states. The QR code is inline SVG from qrcode-generator (added to apps/web) at 180px, with a 4-module quiet zone. It deliberately uses a fixed white ground with black modules (`#fff`/`#000`). This is the one literal-colour exception and is commented in the code. Mutations write their answer straight into the query cache with `setData`, so the section updates at once without calling the CLI again. Search finds it through `PHONE_LINK_SEARCH`, which is added in SettingsDialog. `projectId` was already in `SettingsPageProps`; GeneralPage just didn't read it.
- Tests: `packages/server/test/phone-link.test.ts` uses a stateful fake CLI and covers:
  - every status state, including the Windows path fallback
  - the exact serve commands
  - turnOff leaving the existing 443 serve untouched
  - no command containing `funnel` or using the 443 or default slot
  - rollback on partial failure, with the operator hint
  - the router path through a mocked spawn, including events on success and none on failure

  `apps/web/test/settings-phone-link.test.tsx` covers each state, Turn on and Turn off swapping the view at once, and the failure block. A test added to `settings-dialog.test.tsx` checks that search finds the section. The 127.0.0.1 bind was left alone; it is already pinned by `serve-config.test.ts`.
- Checks run: those three test files pass (37 tests), and `bun run typecheck` is clean.

## Surprises
- I couldn't confirm the shape of `tailscale serve status --json` on a real machine (the sandbox has no Tailscale). The code assumes the ipn ServeConfig shape, `{"TCP":{"4512":{"HTTPS":true}},…}`, which prints `{}` when nothing is served. Check this on the human's machine.
- `live.ts` invalidates queries on SSE events, but I left `phoneLink.status` out of it on purpose. That query runs the CLI, so blanket invalidation would re-run real work on every signal. A change made in another browser tab therefore only appears on refetch.

## Left undone
- The drive machinery needed no change: no new service, env var, seed or process.
- macOS's app-bundle CLI path (`/Applications/Tailscale.app/...`) isn't probed, because the ticket didn't ask for it.

### 4. Phone: live designs through a pass-through

# Ticket 4 — Phone: live designs through a pass-through

## What was done
- **Server**: `packages/server/src/routes/design-pass.ts`.
  - `designPassFetch(req, lookup)` is the HTTP side. `GET /__runcastle/open/<featureId>?path=` sets `runcastle_design=<id>; Path=/; HttpOnly; SameSite=Lax; Secure` and returns a 302 to `path`. It refuses with a 400 any path that is not a single-slash local path (`//x`, `/\x`, `https://…`, relative), and answers a malformed id with a 404 page.
  - Every other request is forwarded to the printed URL. It keeps the method, path, query and body, and rewrites `Host`, `Origin` and `Referer` to the printed URL's host. Hop-by-hop headers are dropped and `accept-encoding` is not forwarded, so fetch never double-decodes. The response is streamed without buffering. A `Location` pointing at the dev server is turned into a local path.
  - No cookie, or a stopped server, gives a 503 readable page. A dead upstream gives an immediate 502 page.
  - `serveDesignPass(config, lookup)` runs `Bun.serve` on `SERVE_HOSTNAME` at `phoneDesignPort(config)`. It upgrades WebSockets and pipes frames both ways (`designPassWebSocket`), keeping the path, the query (Vite's token) and the subprotocols, and echoing the first subprotocol. If the port is busy it prints a `console.warn` and returns null. It is wired in `index.ts` with a lookup over `designServerStatus`, and shutdown stops it.
- **Web**:
  - `useDesignServer(featureId, path)` and `DesignServerDown` were lifted out of `DesignView.tsx`. They hold the status query, the recorded-command auto-start, the heartbeat, showPath, restart, and the stopped, failed and died states. `DesignView` now uses them, and its desktop behaviour is unchanged (its 14 tests pass untouched).
  - New `components/phone/PhoneDesignView.tsx` renders inside `PhoneViewScreen`. That screen gained a `trailing` slot for the Desktop/Phone toggle. The frame is sized with `frameSize` from `lib/preview-width.ts`: the agent's `width`, else 1440, or the phone's own width. There is no Select area, and the foot line is the approved one.
  - `Workspace` renders `PhoneDesignView` for the phone's design view. The Plan preview's open-design path still dispatches `open design`, so it lands there too.
- **Tests**:
  - `packages/server/test/design-pass.test.ts` (16 tests). Against a node HTTP stub that, like Vite, 403s foreign Hosts, it covers: the entry, open-redirect refusal, the Tailscale Host, the POST body, streaming, redirects, no cookie, a stopped server and a dead upstream. Through the Bun fixture `fixtures/design-pass-bun.ts`, it covers: the 127.0.0.1 bind on serverPort+2, a vite-hmr socket both ways with its token, and the busy port warning without starting.
  - `apps/web/test/phone-shell.test.tsx` gained: at a phone's `/design` address, the frame loads the entry URL at 1440 and toggles to the phone's width. It also checks the heartbeat is sent, Back to the chat, a stopped server started from its recorded command, and `phoneDesignSrc`.
- **Manual run against the real dev servers**, recorded here: with `bun run --cwd apps/web dev --port 31999 --strictPort` behind `serveDesignPass`:
  - The entry returned 302 with the cookie.
  - `/preview/phone.html` with Host `desk.tail1234.ts.net:4514` returned 200 through the pass-through; the same request straight to Vite returned 403.
  - `/@vite/client` gave the token.
  - A `vite-hmr` WebSocket through the listener got `{"type":"connected"}`. After touching `preview/phone.tsx` it got `{"type":"update",…"path":"/preview/phone.tsx"}`.
  - A `python3 -m http.server` static server also served `/preview/phone.html` with 200 through it.

## Surprises
- The frame uses the pass-through only when the page's own hostname is the link's machine. The ticket said "if the link is off". From `localhost` the frame would be cross-site and its Lax cookie would never be set, so the host check is the condition that actually works.
- The pass-through forwards to the printed URL exactly. If a server prints `localhost` but binds only `127.0.0.1`, Bun's fetch to `localhost` can hit `::1` and get a 502. I saw this with Python when I pointed it at `localhost`. Real servers print the address they bind, so this was left alone.

## Left undone
- I have not tried it on a real phone or through real `tailscale serve`; that is the human's checkpoint. I also have not tried frameworks other than Vite and a static server.
- Drive machinery: no new service, env var, seed or process; the listener is inside `runcastle serve`. A drive whose serverPort+2 is busy only warns. No `.runcastle/` edit was needed, and none was run.
