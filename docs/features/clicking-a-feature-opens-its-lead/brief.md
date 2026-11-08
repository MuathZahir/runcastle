## Purpose

Today, clicking a feature in the left sidebar swaps the sidebar to that feature's drill-in page (a back link, the lead, then its workers grouped Needs you / Working / Done). This comes from `interactive-workers` decision 24 (`docs/features/interactive-workers/decisions.md#24`). In daily use the human mostly clicks a feature just to see how it is going in the lead's chat, then has to press Back to reach the other features. Doing that over and over is tedious.

The fix: **clicking a feature's row opens its lead's chat and leaves the sidebar on the features list.** A **small arrow on the right of the row**, possibly with a worker count (e.g. "3 ›"), opens the feature's drill-in workers page. Getting into the workers becomes a deliberate step, not the default.

## Understood (settled with the human in the project session, 2026-11-08)

- The human chose the **row arrow** over a "Workers" button in the lead chat's header.
- The arrow shows only on features that have workers. A feature with none has no arrow.
- The drill-in page itself stays as decision 24 built it: same header, lead, groups and row shapes. Only the way in changes. Going back from it still changes only the sidebar.
- This partly revises decision 24 ("Opening a feature swaps the left sidebar to the feature's own page"). Record it as a decision that supersedes that part.

## Must not swallow

- No redesign of the drill-in workers page or its grouping.
- No new right-hand column or worker tab. The human rejected those in decision 24 and that still stands.
- No change to how workers are started, handed back or listed.

## Open (for this feature's own design)

- The arrow's exact look: whether it shows a count, and whether it signals that a worker needs the human (e.g. a dot). Decision 24 said the drill-in page does not announce other features' needs. Whether the features-list row should show a worker's need is open; keep it quiet unless it is clearly better.
- What a phone shows: tap target size of the arrow next to the row.
- Which row is highlighted when the lead's chat is open from the features list.

## Working agreement

**Check-in before merge.** The orchestrator carries this feature to ready without stopping, then presents it to the human and merges only after their yes. The human asked to be shown **screenshots** of how it looks (the review's pictures: the features list with the arrow, a click opening the lead's chat, the arrow opening the workers page, on desktop and phone width). A test drive is not needed for the check-in.

## Ordering

Standalone. Nothing waits on it, and it waits on nothing.
