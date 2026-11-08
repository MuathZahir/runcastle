# Decisions — Clicking a feature opens its lead

Planned without the human (a self-planning run, 2026-11-08). Decisions marked
**Assumed.** are the planner's own pick; the human confirms or changes them.

Check first: 3, 5, 7, 8, 9

## 1. Clicking a feature's row opens its lead's chat and keeps the features list
**Decision:** Supersedes the "opening a feature swaps the sidebar" part of interactive-workers decision 24. Clicking a feature's row in the sidebar opens the feature with its lead's chat in front, and the sidebar stays on the features list. Clicking the row of the feature already open brings its lead back to the front if a worker's chat was there.
**Why:** Settled with the human in the project session (brief). Most clicks are to see how a feature is going in the lead's chat, and the drill-in made every one of them cost a Back press to reach the other features.

## 2. A small arrow on the row opens the feature's workers page
**Decision:** A small arrow at the right of a feature's row, always visible (not only on hover), opens that feature's drill-in workers page (back, the feature's title, "+" New worker, the Lead card, then Needs you / Working / Done) exactly as interactive-workers decision 24 built it. If the feature was not open, the arrow also opens it, lead in front; if it was, the chat in front stays. Going back still changes only the sidebar.
**Why:** Settled with the human (brief): getting into the workers becomes a deliberate step, chosen over a "Workers" button in the lead chat's header.

## 3. The arrow is the only way down to the workers page
**Decision:** Nothing else drills the sidebar into a feature's page any more: not a row click, not the command palette, not a notification tap, not a reload or pasted link that names a worker's chat. Those open the chat they name and leave the sidebar on the features list. Today's rule that reopening a feature "comes back down" goes away.
**Why:** One way in keeps the sidebar predictable: the list stays put unless the human asked to go down. A tap on "Header needs you" still lands in Header's chat; only the sidebar stays where it was.
**Assumed.** Alternative: opening a worker's chat from elsewhere (a notification tap, a link) also drills the sidebar into that feature.
**Challenged:** A reload while on the workers page should keep the sidebar there, since a reload is not "opening" anything. Kept: reloads are rare in a live-updating app, and remembering the level across a reload is extra state for a one-click recovery (the arrow).

## 4. The arrow shows on any feature that has something on its workers page
**Decision:** The arrow shows when the feature's workers page would list anything: a worker in any state, done ones included, or an old side or drive chat. A feature with none has no arrow (brief). Shipped and archived features follow the same rule.
**Why:** The workers page is the only place done workers and old chats are reached from the sidebar; hiding the arrow once they are all done would strand them.
**Assumed.** Alternative: show the arrow only while a worker is still live (needs you or working).

## 5. The arrow's number counts the workers still in play
**Decision:** The arrow reads "3 ›" where 3 is the workers that need the human or are working or queued: the page's Needs you and Working groups. When none are, it is a bare "›". The number is in the row's quiet secondary text, never coloured.
**Why:** A total that includes landed and dropped workers only grows, so it says nothing at a glance; the live count says "there is work going on down there".
**Assumed.** Alternative: the total of everything on the page, or no number at all.

## 6. The arrow does not signal a worker's need; the row already does
**Decision:** The arrow never turns amber or carries a dot. A worker that needs the human is already shown by the row itself: today the feature moves to Needs you, lights its amber dot and reads "<worker> needs you".
**Why:** The brief asked to keep it quiet unless clearly better, and the row already says it in words; a second amber mark on the same row would say the same thing twice.
**Assumed.** Alternative: tint the arrow's number amber while a worker needs you.

## 7. A row that says a worker needs you opens that worker's chat
**Decision:** When the row's need is a worker's ("Header needs you"), clicking the row opens the worker the row names, in front instead of the lead. A feature has one need at a time, so the row's words and the click always point at the same chat; when the lead's own question outranks the worker, the row names the lead and opens it. Clicking again while that worker is already in front brings the lead forward, so the row always gets the human to the lead. The sidebar stays on the features list. Every other row opens the lead.
**Why:** The row names the worker the human is being asked about; landing in the lead's chat would make them go find it through the arrow, two more clicks for the most urgent case.
**Assumed.** Alternative: always open the lead, as the brief says, and let the arrow lead to the worker.
**Challenged:** The brief, settled with the human, says the row opens the lead. Under this decision a click lands in different places as the feature's state changes, which is the unpredictability the feature exists to remove; the worker is two clicks away through the arrow.

## 8. The phone shows no arrow
**Decision:** On a phone the features list has no arrow. Tapping a row opens the lead's chat full screen, as today, and a feature's workers are reached from that chat's title, which already opens the list of the lead and its workers with "New worker" first.
**Why:** The phone never had the drill-in page, and its chat title already lists every worker one tap away; a second tap target squeezed beside the row would be easy to miss-hit for no new reach.
**Assumed.** Alternative: an arrow on phone rows too, with a full 44px tap target, opening the feature with its list of chats.
**Challenged:** The brief names the arrow's tap target on a phone as an open question, and the human asked for screenshots of the arrow at phone width, so they likely expect one there.

## 9. A feature with no workers gets no new "+" on the list
**Decision:** With no arrow, a feature without workers has no "+" New worker in the sidebar. It keeps the other ways to start one: the command palette's "New worker", Ctrl+Shift+O, and on the phone the chat title's list. The workers page's "+" is there once the feature has a worker.
**Why:** The brief rules out changing how workers are started, and the human starts few workers by hand; the lead starts most of them.
**Assumed.** Alternative: add "New worker" to the row's "…" menu on started features.

## 10. The open feature's row stays highlighted whatever chat is in front
**Decision:** On the features list, the open feature's row is highlighted whether its lead's chat or one of its workers' chats is in front. Down on the workers page, the Lead card or the worker's row is highlighted, as today.
**Why:** The row stands for the feature, and the human needs to see which feature they are in; the workers page is where to see which of its chats.
