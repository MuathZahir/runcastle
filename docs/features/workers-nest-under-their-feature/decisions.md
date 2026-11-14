# Decisions — Workers nest under their feature

## 1. Workers are rows under their feature's row; the drill-in page goes
**Decision:** A feature's workers show as indented rows under its row in the same sidebar list. The feature's own sidebar page (its header with back and "+", its Lead card, its Needs you / Working / Done lanes) and the "›" workers arrow on the feature row are removed.
**Why:** The drill-in page costs a navigation step and hides a worker that needs the human one level down. Clicking a feature already opens its lead, so the Lead card adds nothing.

## 2. Live workers show under every feature row, wherever it sits
**Decision:** A feature's live workers (needs you, failed, working, idle, queued) show under its row in every place the row appears: the Needs you lane, the Working shelf, under an epic card. The Review, fix-drive and Scenarios workers are workers and nest the same way. Needs-you and failed workers come first, then working, idle and queued, newest first within each.
**Why:** A worker that needs the human must be visible where the human is already looking, with no toggle to find it.

## 3. Finished workers fold into "N done", under the open feature only
**Decision:** Handed-back, landed and dropped workers fold into one "N done" line, shown only under the feature that is open. Other feature rows show only their live workers.
**Why:** A shipped feature would otherwise grow a done line on every row; old workers only matter once you are inside that feature. Chosen over the brief's "N done" under every feature.

## 4. Old side and drive chats live inside the "N done" fold
**Decision:** The side and drive chats from before workers existed, which the drill-in page listed under Done, go inside the open feature's "N done" fold.
**Why:** They are finished history like done workers; they need a home once the page goes.

## 5. "+" New worker on hover on in-progress feature rows
**Decision:** Hovering the row of a feature in progress shows a "+" (New worker). Drafts, shipped and archived features have none. On a feature that is not open, "+" opens that feature and starts the worker there.
**Why:** The drill-in page's header held "+"; the feature row is its nearest home, and starting a worker on a finished feature makes no sense.

## 6. Status words and the feature row's need
**Decision:** A nested worker row keeps today's worker row words: Needs you · <line>, Working, Idle, Queued, Failed, and the quiet done words. The feature row still shows the newest need among its lead and its workers.
**Why:** The words are already settled ("Needs you is the agent's call"); only the placement changes.

## 7. Autopilot locks nested worker rows too
**Decision:** When a feature is locked to its epic's autopilot run, its nested worker rows show locked the same way the feature row does, and never light the amber dot.
**Why:** Its needs go to the epic (epics-on-autopilot); the rows under it must not contradict that.

## 8. The phone is unchanged
**Decision:** The phone's feature list gets no nested rows. A tap on a feature already opens the exact chat its question waits in, a worker's included, and the chat bar's sheet already lists the lead and the workers with New worker.
**Why:** The phone already puts a waiting worker one tap away; nesting rows there would only crowd a narrow list.

## 9. A feature's workers fold and unfold
**Decision:** A feature row with workers under it carries a chevron that folds and unfolds them. Unfolded by default; each feature's choice is remembered on this browser. A folded feature still shows a worker's need through its row's amber dot and words.
**Why:** The human asked to collapse and expand a feature with all its workers under it. Defaulting open keeps a waiting worker visible until the human chooses to hide it.

## 10. It looks like the sidebar it lives in
**Decision:** Nested rows use the sidebar's existing rows, heights, paddings, glyphs and theme tokens (`apps/web/STYLE.md`); nothing new enters the theme. The bar is a professional, carefully finished look: alignment, indent guides, hover and active states, fold motion. The `frontend-design` skill's craft standard applies; its push toward a new, bold look does not.
**Why:** The human: "make sure that it looks professional and maintains the consistent style of the sidebar."
