# Decisions — Phone fixes: New thread on top, Back never loops, context meter

Planned without the human (a headless planning run). Every decision below is assumed until the human confirms it.

Check first: 3, 4, 5

## 1. New chat is the first row of the thread sheet
**Decision:** In a chat's thread sheet (the sheet that opens from the chat's title), "New chat" moves from after the thread list to its first row, above every thread. It keeps its name and its "+" icon, the same words as the list's own "+" menu.
**Why:** The sheet opens scrolled to the top, so the first row is reachable without scrolling however long the list is. It is the smallest change that fixes the bug, and needs no new sheet layout.
**Assumed.** Alternative: keep New chat last but pin it to the sheet's foot so it is always visible.

## 2. Back is fixed once, in the app's one history layer
**Decision:** Closing a view never adds a history entry. When the app moves to the place the browser has just behind it, it steps Back instead of pushing a new entry. Each entry the app pushes remembers the place it came from, so this holds after a reload too. Every view that closes by itself (the design view's Back, Approve on the last design, a doc's way back) then walks out the way the system Back does. A view opened straight from a link or a notification, with nothing of the app's behind it, still walks out one level: Back goes to its chat, then to the list.
**Why:** The loop comes from the phone's design view: its Back closes the view by pushing the chat's address as a new entry, so the entry with the design stays behind it and the next Back returns to it. Patching that one button would leave the same trap for every other view that closes itself. The brief asks for the cause, not a patch per view.
**Assumed.** Alternative: make each view's Back button call the existing "step back" helper, as the chat's own Back already does.

## 3. On the phone, an overlay opened from a chat takes one Back step
**Decision:** On the phone, every overlay a chat opens takes one history entry, and Back closes it before anything else: a shown file opened large, a Review Package, and the chat's sheets (the thread sheet, the "…" views sheet). Closing it with its own button removes that entry, so it never comes back. The desktop is unchanged: there, overlays stay out of history.
**Why:** Today these overlays are not in history at all, so Android's Back on an open file or Review Package leaves the chat for the list, skipping a level. The brief's scope is anything opened from a thread, and Android users expect Back to close a sheet too. One rule in the app's single dialog shell covers them all.
**Assumed.** Alternative: only the full-screen overlays (shown file, Review Package) take a Back step; sheets stay out of history and close by tapping outside.
**Challenged:** The brief's scope is things opened full screen and it forbids a new navigation model; the app's rule has been that overlays never enter history, and every new history entry is one more way to loop. Sheets already close on a tap outside.

## 4. The phone shows the context meter where the desktop does
**Decision:** On the phone, the context meter (the short bar with a percentage that shows how full the thread's context is) comes back to the composer's footer row, before attach and send, exactly as on the desktop. Tapping it opens the same details: the numbers, the account's usage limits and Compact now. It steps aside for the working clock while the agent works, as on the desktop. This reverses the approved phone design's "no meter" (runcastle-on-your-phone decision 8), at the human's request in the brief, and the phone mockup is updated to match. It shows on every chat the phone opens, the Orchestrator's included.
**Why:** It was hidden on the phone only so the composer would fit 390px. The meter is about 50px wide, and the row is tight: where it does not fit, the model name shortens first, never the meter or Send. Keeping it in the desktop's place means one meter, not a second phone version.
**Assumed.** Alternative: put the percentage in the chat bar under the title, or as a line in the "…" sheet, leaving the composer as it is.

## 5. The Back fix applies to the desktop too
**Decision:** The history fix in decision 2 is not phone-only. On the desktop, closing a panel (Plan, Tickets, Design) also steps back rather than adding an entry, so the browser's Back no longer reopens a panel you just closed, and Forward reopens it. Overlays on the desktop stay out of history, as before.
**Why:** The desktop has the same loop: open the Plan, close it, press Back, and the Plan opens again. One history layer serves both, and splitting it by screen size would keep two rules where there is one bug.
**Assumed.** Alternative: limit the step-back to the phone and leave the desktop's history exactly as it is.
