# Decisions — A faster web app

Planned with nobody present (2026-11-16). Decisions marked **Assumed.** are the lead's picks, waiting for the human's word.

Check first: 3, 6, 7, 8, 9

## 1. Fast page loads and lag-free typing, measured first
**Decision:** A refresh loads fast and typing in the message box never lags. Measure first, then fix what the measurements show.
**Why:** The human's own ask: refreshes "take forever" and on another PC a key shows "a couple seconds later".

## 2. In the web app, reached over SSH from another PC
**Decision:** The fix is in runcastle's web app, as the human uses it over SSH port forwarding from other PCs.
**Why:** That is where the slowness shows.

## 3. Measured and tuned on the built app (port 4512), not the dev server
**Decision:** Targets are measured against the app runcastle itself serves on port 4512. The Vite dev server on 4513 is not tuned.
**Why:** On this machine only 4512 is listening (the installed runcastle, serving its built app); nothing runs on 4513. The brief left the port as an open question.
**Assumed.** Alternative: the human tunnels to 4513 on some PCs, and the dev server needs its own fix.

## 4. Every runcastle user gets it, with no setting
**Decision:** The human asked; every runcastle user gets the faster app by default, with nothing to switch on.
**Why:** Speed is not a preference, and the fixes cost nothing to anyone.

## 5. No desktop app
**Decision:** No desktop app or packaging change in this feature.
**Why:** It would talk to the same server over the same SSH tunnel, so it fixes none of this. It stays a separate question for later.

## 6. "Fast" means these numbers
**Decision:** Done when, on the built app with Chrome's CPU slowed 4x (a stand-in for the slower PC) and the link slowed to 10 Mbit/s with 60 ms round trips (a stand-in for the SSH tunnel):
- a key typed in a chat of 500+ messages shows on screen within 50 ms, also while an agent is streaming its reply in that chat;
- a repeat refresh shows the project page, sidebar filled, within 1.5 s;
- a first visit (empty browser cache) shows it within 3 s.
**Why:** 50 ms is below what a typist notices. The refresh numbers are what today's bundle cannot reach: it sends about 1.8 MB unzipped on every refresh, which alone takes about 1.5 s at 10 Mbit/s before any work starts.
**Assumed.** Alternative: no fixed numbers, just "clearly faster than before" by the human's feel.
**Amended by the human (2026-11-16):** the slowest 5% of keys while an agent streams lands at about 80 ms, not 50; the human accepted that ("Accept the 80ms"). Off-screen messages keep their layout.

## 7. Long chats keep every message on the page
**Decision:** A long chat still draws all its messages. The typing fix comes from not redrawing old messages on each key, not from dropping off-screen ones.
**Why:** Dropping off-screen messages ("windowing") breaks the browser's find (Ctrl+F) and selecting text across messages, and risks scroll jumps. If the numbers in 6 are still missed after the other fixes, the lead comes back to the human before windowing.
**Assumed.** Alternative: window long chats now, accepting those losses for the fastest typing.

## 8. Coming back to the tab no longer refetches everything
**Decision:** Switching back to the browser tab stops re-asking the server for every list on screen. The live stream keeps the page current; when the stream reconnects, the page catches up once.
**Why:** Today every alt-tab back costs dozens of round trips over the tunnel, and every page load fetches each list twice. The live stream already pushes every change.
**Assumed.** Alternative: keep refetching on focus, but only for the open chat.

## 9. Rarely used parts load the first time they open
**Decision:** The terminal, the design view, the command palette and the phone-link QR code load the first time you open one, behind a brief "Loading…" in their place. Everything else looks and works as today.
**Why:** They carry heavy code (the terminal library alone is a few hundred KB) that every refresh pays for now. This is the one visible change; the alternative keeps refreshes heavier.
**Assumed.** Alternative: keep everything in one bundle and rely only on compression and browser caching.

## 10. Nothing else looks or behaves differently
**Decision:** Apart from 8 and 9, nothing looks or behaves differently. Only faster.
**Why:** The brief rules out visual redesigns.
**Assumed.** Alternative: allow small visible changes where they buy speed, like a "show older messages" row in long chats.

## 11. The measuring script stays, as a tool, not a merge check
**Decision:** The script that takes the numbers in 6 stays in the repo for anyone to rerun. It never blocks a merge.
**Why:** Speed regressions should be easy to spot later, without adding a slow, flaky gate.
**Assumed.** Alternative: a test that fails when typing or loading gets slow again.
