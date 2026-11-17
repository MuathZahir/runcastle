# A calmer sidebar

## Problem
In the sidebar's epic block, rows that need the human and rows that are working look alike, and every row carries a long status line ("Needs you · Ready to test · A lead runs a …"). The human can't scan it for what needs them.

## Approach
Each epic card lists its features as one-line rows with no status words. Rows that need the human come first and stand out in the epic's own colour: a faint tint, the mark (play for ready to test, speech bubble for a question) in a small tile, an unread dot at the end, and a count in the epic's head. They don't move. Every other feature folds into one quiet line ("2 working · 1 idle"), opened per epic and remembered on the browser; the open feature always stays visible. Working rows wear a small spinner, the only motion in the block; the fold line shows it only while closed. A feature with live workers has a collapse arrow at its row's end that opens one-line worker rows; finished workers leave the sidebar. The waiting reason and the time move to the row's hover. The progress ring is gone. Red "!" marks a failed worker or a feature that can't start.

The shape: the epic card's feature list is its own component (the list, the row, the worker rows, the fold line, the marks), used by the epic cards and the Other features card. The epic card takes the count of features that need you. "Ready to test" is told apart from a question by a small helper in core that reads the need's reason. Nothing on the server or the wire changes. Autopilot-locked features keep their lock and never get the needs-you look.

## Seams
- The sidebar's static markup tests (existing): which rows render, in what order, with which marks, count and fold line.
- The chat column tests (existing): opening a feature's workers, picking a worker, the "+" new worker.
- The design page (existing for this feature): every state drawn with sample data.

## Out of scope
- What states a feature can be in, and when "needs you" is set.
- The feature page, chat, project rail and the Epics page beyond what shared components force.

## Open questions
None.
