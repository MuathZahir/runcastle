# Phone fixes: New thread on top, Back never loops, context meter

## Problem
Three things go wrong when the human uses runcastle on their phone:

1. In a chat's thread sheet, "New chat" is the last row, so with many threads they scroll to reach it.
2. Back loops. Open a thread, open a design, press Back: the thread shows. Press Back again: the design opens again instead of the feature list. The only way out is closing the app. Shown files and Review Packages have the opposite fault: Back on one leaves the chat for the list, skipping a level.
3. The context meter, which shows how full a thread's context is, is missing on the phone.

## Approach
**New chat on top** (decision 1). The phone chat bar's thread sheet renders "New chat" as its first row, then the threads. Nothing else in the sheet changes.

**Back walks out one level at a time** (decisions 2, 3, 5). Two changes, each in the one place that owns the behaviour.

*The history layer* (`use-history-sync`, the only code that writes browser history). Today, when the app's location changes after landing, it always pushes a new entry. A view that closes itself (the phone design view's Back, Approve on the last waiting design, any panel close on the desktop) therefore pushes the chat's address on top of the entry that holds the view, and the next Back returns to the view. The fix: every entry the app pushes carries, in its history state, the path it was pushed from. When the app moves to a path equal to the current entry's "from", it calls `history.back()` instead of pushing. The `popstate` that follows parses to the location the app already holds, so it changes nothing. Paths are compared without the query string, since the open thread rides in the query and is replaced, never pushed. The existing "step back" helper for on-screen Back buttons keeps working and gains nothing new. A view reached with nothing of the app's behind it (a pasted link, a notification) closes by dispatch as today, which replaces nothing and pushes the chat's path once; Back from the chat then takes the existing fallback to the list.

The shape of the state, as it would sit in the history layer:

```ts
// What an entry the app pushed carries.
type InAppEntry = { runcastle: true; from: string } // `from`: the path pushed from

// Moving to `path` once landed:
if (history.state?.runcastle && history.state.from === path) history.back()
else history.pushState({ runcastle: true, from: currentPath() }, '', path)
```

*The dialog shell* (`Dialog` in the UI kit, the single shell every overlay and sheet runs through). On the phone only, a dialog that opens pushes one entry at the same address, marked as an overlay entry. A `popstate` that leaves that entry closes the dialog (through its `onClose`; a dirty dialog asks its discard question and, if kept, pushes its entry again). Closing the dialog any other way (its Close button, a tap outside, Escape, a sheet row) steps back off its entry when that entry is still current. A sheet row that closes the sheet and then navigates (picking a thread, New chat, opening a view) must run its action after the step back has landed, or the step back would undo the action's own push. An overlay entry found with no dialog open (after a reload) is stepped over: the app goes back past it at once. On the desktop, dialogs stay out of history, as now.

**Context meter on the phone** (decision 4). The thread column passes the context meter to the composer on the phone too, removing the phone exception. The meter keeps its desktop look and its popover (numbers, usage limits, Compact now), opened by a tap. It sits first on the footer row's right side, before Attach and Send, and gives way to the working clock while the agent works. At the narrowest phone widths (360px) the model chip on the left truncates before the meter or Send are squeezed. The phone mockup page (`apps/web/preview/phone.tsx`) gains the meter so the design record matches.

## Seams
- **The history layer's hook and helpers** (existing, `use-history-sync`; tested in `apps/web/test/history-sync.test.tsx`). Drive a location through open-view → close-view → Back and observe `history.length`, `history.state` and the path after each step. The repro becomes a test: chat → design → close by dispatch → Back lands on the list's path, never the design's. Also: two views opened in a row from one chat; a reload between steps (state survives); a deep-linked view.
- **The `Dialog` shell** (existing). With the phone media query matched: open → a history entry appears; `popstate` → `onClose` is called; close by button → the entry is stepped off; a dirty dialog on Back asks first; desktop → no entry. Observed through `history` and `onClose` calls.
- **The phone chat bar's thread sheet** (existing component test tier). The first row is New chat.
- **The composer on the phone** (existing). With the phone query matched and a context reading present, the meter renders in the footer; while working, the clock does instead.
- **The real phone** (the review round). At a 390px viewport in a real browser: chat → design → Back → Back lands on the list; chat → shown file → Back → chat → Back → list; chat → Review Package → Back → chat; open two things in a row; screenshots of the sheet and the composer with the meter.

## Out of scope
- Any redesign of the phone view, the thread sheet or the composer beyond these three fixes.
- A new navigation model or router. Desktop overlays (palette, Settings, forms) stay out of history.
- Showing context usage while the agent works (the clock keeps that slot on both phone and desktop).
- Context usage in the feature list or the thread sheet.

## Open questions
- Decision 3: whether sheets take a Back step or only full-screen overlays do. The plan includes sheets; the challenger argued against. If the human picks the narrower rule, the dialog shell pushes an entry only at its full size.
- Whether the meter fits at 360px beside the model chip without the chip becoming unreadable; checked in the review round's screenshots.
