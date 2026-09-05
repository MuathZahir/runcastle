# Capture spike — verdict

**Question:** which mechanism lets an integrated Open-app panel on the review page capture a drag-selected region of a *cross-origin* localhost dev server, as the human currently sees it, to a PNG on disk?

**Winner: route (c) — tab self-capture via `getDisplayMedia({ preferCurrentTab: true, selfBrowserSurface: "include" })`.** Proven end to end on Windows, Chrome 149 (Playwright chromium), 2026-09-05:

- `devserver.ts` (port 5599) = the cross-origin dev server; `harness.ts`/`harness.html` (port 5598) = the runcastle origin with the iframe panel, drag-select overlay, capture logic and the `POST /capture` disk write; `run-spike.mjs` = the human (clicks the one share prompt via `--auto-accept-this-tab-capture`, clicks twice inside the iframe, scrolls it to y=850, drag-selects 500×300 at (400,80)).
- Result: `shots/capture-1788592778967.png` shows **clicks: 2** and **BAND BLUE — 800** — the cross-origin iframe's pixels *with the live interaction state* (click-mutated DOM + scroll position). Exactly what a server-side capture cannot see.
- Latency: prompt+stream attach **347 ms** (once per session); per-capture grab **190 ms**, of which 120 ms is a deliberate settle after hiding the selection chrome so the marquee never bakes into the shot.
- Mapping: selection rect (CSS px) → video pixels via `videoWidth / innerWidth` ratio — handles DPR generically; `preferCurrentTab` guarantees the captured surface *is* this viewport, so the mapping is exact.

**Why not route (a) (same-origin proxy):** even after proxying, no browser API rasterizes a live iframe's rendered pixels — `html2canvas` re-renders the DOM (unfaithful: canvas/video/webfonts/scroll), `drawWindow` is Firefox-privileged-only. The proxy would buy absolute-URL and HMR-websocket headaches for zero pixel gain. Not built, on that ground.

**Why not route (b) (server-side headless screenshot):** cannot see the human's live session — their route, scroll, app state — by definition. Viable only as a non-interactive "screenshot the app" without a drive.

**Constraints for the design (decision 39):**
- Chromium-only (`preferCurrentTab`/`selfBrowserSurface` are Chromium APIs). Firefox/Safari: pasted screenshots (decision 7a) are the floor.
- One native share prompt per drive session; keep the stream for the session. Chrome shows a "sharing this tab" indicator.
- Captures the viewport only (the human selects what they see; no full-page capture).
- Selection UI must hide ~2 frames before the grab.
- The iframe stays a plain cross-origin embed — no proxy. An app sending `X-Frame-Options`/`frame-ancestors` deny won't embed; fallback is `Open app ↗` + paste.
- Region/Element-capture APIs (`CropTarget`/`RestrictionTarget`) are unnecessary — client-side cropping from the full-tab frame is simpler and exact.

**Automation notes:** headed Playwright launch hangs under Bun on Windows (`--remote-debugging-pipe` handshake) — drive with Node + `connectOverCDP`. `--auto-accept-this-tab-capture` stands in for the human's one click; the API flow is identical headed. Tab capture works in `--headless=new` (real compositor), not `headless_shell`.
