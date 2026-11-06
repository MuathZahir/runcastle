## Purpose
Three small bugs the human hit using runcastle on their phone (the phone view shipped in `runcastle-on-your-phone`). One feature, one change: fix all three.

## The three bugs
1. **New thread is buried.** In a chat's thread sheet (where `runcastle-on-your-phone` decision 7 put a thread's own "New thread"), the human has to scroll to the bottom of the thread list to reach "New thread". Expected: "New thread" is reachable without scrolling — at the top of the sheet (or pinned so it is always visible), however long the list is.
2. **Back loops.** Repro: on the phone, open a thread, open a design from it (full screen), press Back → lands on the thread (correct). Press Back again → it goes to the design again instead of to the home feature list. The human is stuck in a loop between the thread and the design and has to close the app. Expected: Back walks out one level at a time — design → thread → feature list — and never re-enters something already closed. `runcastle-on-your-phone` decision 1 promised "Back returns to the list" and Android's Back working as expected. **Scope agreed with the human: fix Back for anything opened full screen from inside a thread, not just designs** — files the agent shows in chat, the review package, and any other overlay/full-screen view opened from a chat. Likely cause is history being pushed/replaced wrongly when an overlay opens or closes; find the actual cause, don't patch per-view.
3. **No context usage on the phone.** On desktop the context meter (a short bar with a percentage, in the composer's footer row beside attach and send — `the-chat-looks-the-part` decisions) shows how full a thread's context is. On the phone it is missing. Expected: the phone shows each thread's context usage, consistent with desktop's meter, fitted to the phone layout.

## Must not swallow
No redesign of the phone view, the thread sheet or the composer beyond what these three need. No new navigation model.

## Open (for the feature lead)
- Exact placement of "New thread" (top row vs pinned) and of the context meter on the phone — follow the existing phone design (`apps/web/preview/phone.html`, `runcastle-on-your-phone/decisions.md`) and the desktop meter.
- Verify the Back fix on a real history stack (Android Back = browser history back), including opening two things in a row from one thread.

## Working agreement
**Autonomous.** The orchestrator carries this through to merged and tells the human when it is done. No test-drive checkpoint; rely on the feature's own review round (screenshots of the phone view welcome). Ask the human only for a decision that changes what they get.
