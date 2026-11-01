# Runcastle on your phone

## Problem

Runcastle only works at the computer. When an agent asks a question, finishes a round or leaves a Review Package, nothing can be done about it until the human is back at their desk. The app is built for desktop, and its server only answers on the machine itself.

## Approach

**For the human.** Settings has an "On your phone" section. One button turns on a private link through Tailscale, and a QR code puts that link on the phone. The link opens the same runcastle in the phone's browser, and it can be added to the home screen.

On the phone, runcastle is a list and chats. The list opens first: the Orchestrator, what needs you, what is working, then the shelves. Tapping a row opens that chat full screen, and Back returns. A chat has everything the agent needs from you: messages, questions, approvals, images and Review Packages. Its title switches threads, and its "…" menu opens the Plan and Tickets to read and a running Design to look at. Accepting work is done by telling the Orchestrator in chat. Test drives, Details, Settings and terminals are not on the phone.

**One app, one address scheme.** There is no separate app or route. A width check (`useIsPhone`: under 768px wide, or under 500px tall so a phone on its side stays a phone) changes how the existing screens are framed:

- `Frame` shows one thing at a time. With nothing open it shows the sidebar's content at full width, as the list. With something open it shows the page, and the list stays out of the way.
- `ProjectShell` keeps its existing address handling, so `/p/<id>` is the list and `/p/<id>/f/<slug>` is that feature's chat. Back is the browser's Back through the existing history sync. On a phone, landing never picks a feature by itself.
- The feature page's panel views become full-screen pages over the chat rather than a split.
- `PageTopbar` gives way to the phone's chat bar: Back, the title (a sheet of threads when there is more than one), the status words, and "…".
- A bottom `Sheet` primitive is the phone's menu. It runs through `Dialog`'s mechanics and is built only once.

The approved look is `apps/web/preview/phone.html`, with its source in `phone.tsx`. Its rows, thread, composer and Review Package are real components. Its bars, sheets and read-only screens are the design to reproduce with real data.

**Touch.** On a phone, Enter in the composer starts a new line and the Send button sends. Keyboard hints go from the composer and the ask docks. A hover-only control is reachable or gone: row menus and hover actions are hidden on the phone list. The model and effort pickers stay and hide while the agent works. The layout follows the on-screen keyboard (`interactive-widget=resizes-content`, `dvh` heights) and respects the safe areas.

**Read-only surfaces.** Plan, Tickets and a backlog feature's page keep their content and lose their controls on a phone: no ticket editing, no Go, no Start, no Merge. A notice that opens a drive is hidden, and a feature waiting on a drive says so in its chat. Preparation and the first-run wizard say to use the computer.

**The phone link.** A new server service wraps the `tailscale` CLI. It finds the binary, reads whether Tailscale is running, this machine's name and whether HTTPS certificates are available, and reads and writes the serve config. It only ever calls `tailscale serve`, never Funnel. The app is served on HTTPS at the same port number as `config.serverPort`, so it never takes the plain address; the design port is `serverPort + 2`. The server keeps listening on `127.0.0.1` only: Tailscale's proxy is the sole way in. Turning the link on is one tRPC mutation that emits an event. A failure returns the exact commands for the human to run, which is the VPS case until `tailscale set --operator` is done.

**Design pass-through.** A design server is a dev server on the host's localhost, on a per-feature port, and it refuses a Tailscale hostname. A second `Bun.serve` listener on the design port forwards HTTP and WebSocket traffic to the feature's design server, rewriting `Host` and `Origin` to the server's own localhost address. Which feature it forwards to comes from a cookie set by an entry path (`/__runcastle/open/<featureId>?path=…`). The phone's Design screen frames that entry. It keeps the design view's heartbeat, starts a stopped server from its recorded command, and offers the Desktop and Phone widths. Select area stays desktop-only. Keeping the design on its own port keeps project code on a different origin from runcastle's API.

Reaching the server must not depend on how the dev server binds: on Windows Vite answers on `::1`, not `127.0.0.1`, so forward to the URL the server printed.

**Home screen.** A web manifest and PNG icons make the link installable. No service worker: notifications add one later.

## Seams

- **`useIsPhone()`** (new): the one switch every phone difference reads. Testable by stubbing `matchMedia`.
- **`Frame` and `ProjectShell` rendered at phone width** (existing): with a `/p/<id>` address they show the list, with a feature address the chat, and Back returns. Tier 2 component tests at the app level, using `.runcastle/preview/app-at.tsx`'s pattern.
- **`Composer`, the ask docks and the read-only views** (existing): their phone behaviour shows in rendered markup and key handling.
- **`phoneLink` tRPC router** (new): `status`, `turnOn`, `turnOff`, over a service whose only outside dependency is a command runner, so tests fake the CLI's output.
- **The design pass-through's `fetch` handler** (new): a pure function of a request and a port lookup, testable against a local stub server, with one check against this repo's real Vite dev server for hot reload.

## Out of scope

- Notifications ("Agents can notify your phone"), and with them the service worker and a page for a fresh open with the computer off.
- Public access, accounts and login. Runcastle stays on the private network.
- A Merge button, Test drive, Details, Settings, terminals, Select area and Add to backlog on the phone.
- Redesigning the desktop app, and native apps.
- A tablet layout: an iPad gets the desktop app.

## Open questions

- Whether the design pass-through holds for frameworks other than Vite. If it fights back, it splits into its own backlog feature and agents show pictures in chat until then.
- The real phone: nothing has been tried on the S24 yet. That is the human's checkpoint before merge, and it needs Tailscale on on the phone.
