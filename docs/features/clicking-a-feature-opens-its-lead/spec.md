# Clicking a feature opens its lead

## Problem

Clicking a feature in the left sidebar swaps the whole sidebar for that feature's workers page (interactive-workers decision 24). Most of the time the human clicked only to see how the feature is going in its lead's chat, and now has to press Back to reach the other features. Doing that all day is tedious.

## Approach

**For the human.** A click on a feature's row opens the feature with its lead's chat in front, and the sidebar stays on the features list (decision 1). A row that says a worker needs the human ("Header needs you") opens that worker's chat instead, and a second click brings the lead forward (decision 7). Features that have anything on their workers page carry a small, always-visible pill at the row's end: "3 ›", the number being the workers that need the human or are at work, or a bare "›" when none are (decisions 4, 5). The pill never takes a colour; the row's own amber dot and words already say when a worker waits (decision 6). Pressing it opens the feature (lead in front, unless the feature was already open, in which case the chat in front stays) and slides the sidebar down to the feature's workers page, which is unchanged (decision 2). Back slides up and changes only the sidebar. Nothing else goes down to that page: palette, notification taps, links and reloads open the chat they name and leave the list in place (decision 3). The open feature's row stays highlighted whatever chat is in front (decision 10). The phone is unchanged: no pill, workers stay one tap away in the chat title's list (decision 8). No new "+" for features without workers (decision 9).

**The shape of it.**

- **The feature list carries what the pill needs.** Each feature-list item gains a count of its live workers (needs-you, failed, working, queued: the workers page's Needs you and Working groups) and whether its workers page has anything at all (any worker row of the feature, in any state, or any old side or drive chat). The server already counts working workers per feature in one grouped query for the list; this widens that query rather than adding a per-feature read. The live count must agree with how the workers page groups workers (`workerGroups` on the web), so the grouping of statuses is the single rule both follow.
- **The row draws the pill.** The sidebar's feature row gains an optional "workers" input (the live count and what pressing does), drawn as `WorkersArrow` in a new always-shown slot at the row's right end, centred across both lines. With it, the row's text clears the pill and the hover "…" sits just left of it. This part is already designed: see the design pages below.
- **The sidebar's navigation rule changes.** The sidebar today goes down whenever the open feature's threads are published and the human has not pressed Back since. It becomes: down only after the pill was pressed for the feature that is open, until Back, or until another feature opens. A row click no longer goes down. The row click picks the thread in front: the worker the feature's need names when the need is a worker's and that worker is not already in front, else the lead.
- **The phone list passes no pill**, and its rows behave as today.

**Designed screens** (uncommitted until the human approves them; the design page is `apps/web/preview/lead-first.html`, with `?state=lead`, `?state=worker-needs` and `?state=workers`): the pill component `WorkersArrow` and the row slot in `apps/web/src/components/SidebarParts.tsx`, and the frame the design page shares with the older workers pages (`apps/web/preview/workers-frame.tsx`, which gains an optional pill per row).

## Seams

- **Feature list (existing): `feature.list`.** Observe each item's new live-worker count and "has a workers page" flag for a feature with no workers, with only done workers, with only an old side chat, and with a mix (including a failed worker counted as live).
- **The feature row (existing): `SidebarFeatureRow`.** Observe that the pill renders only when given, shows the number only when above zero, and that pressing it calls its handler without also firing the row's own click.
- **The sidebar (existing): `Sidebar`, rendered as `sidebar-*.test.tsx` already do.** Observe: a row click opens the feature and the list stays; a row click on a feature whose need is a worker's picks that worker, and a second click picks the lead; the pill opens the workers page and Back returns to the list; opening the feature's worker through `pick` or a fresh mount with a worker in the address leaves the list in place; no pill on the phone.

## Out of scope

- Any change to the workers page itself, its header, groups or rows (brief).
- A right-hand column or worker tab (rejected in interactive-workers decision 24).
- How workers are started, handed back or listed, including a "New worker" entry in the row's "…" menu (decision 9).
- Remembering the workers page across a reload (decision 3).

## Open questions

- None blocking. The one open look is whether the pill carries the number (decision 5); the design page's Tweaks menu switches it.
