# Decisions — A calmer sidebar

## 1. A redesign of the epic block with a clear hierarchy
**Decision:** The sidebar's epic block (its feature rows, their status lines, the workers nested under features) is redesigned so the rows that need the human stand out and the rest recede. Minimal text, professional and polished. Designs are approved before anything is built.
**Why:** The human finds needs-you rows and working rows blend together, and the status lines too long to read.

## 2. The waiting reason leaves the sidebar row
**Decision:** A feature row no longer shows the agent's waiting reason ("Needs you · Ready to test · A lead runs a …"). The feature's chat already shows it. Workers nested under a feature shrink to something minimal, such as a count.
**Why:** The human: "too much text for no real reason, I can't read anything since it's too long."

## 3. Features that don't need you fold into one line per epic
**Decision:** Inside an epic, rows that need the human keep their full row at the top. Every other feature (working, idle, up next) folds into one quiet line under them, such as "3 working · 1 idle"; a click opens them, and each epic remembers whether it is open. The exact look is settled in the designs.
**Why:** Chosen over hiding them (the epic would look empty while agents work) and over dimming them in place (the clutter stays). The cost is one extra click to reach a working feature.

## 4. A needs-you row is one line, with a mark for ready to test
**Decision:** A feature that needs the human shows as one line: its title, an amber mark and the time. A feature that is ready to test wears a different amber mark (such as a small play icon) from one waiting on an answer (an amber dot). The full reason shows on hover and in the chat.
**Why:** The human wants to tell "go test it" from "go answer it" without reading. Chosen over one dot for every need, and over a short word on a second line.

## 5. The progress ring leaves the sidebar rows
**Decision:** The hollow circle before each feature row (its share of landed tickets) is removed from the sidebar.
**Why:** The human: it is useless now that workers replaced rounds and laps; it shows nothing true.

## 6. Workers show as a count that opens on click
**Decision:** A feature row with live workers shows a small count at its end (a worker icon and "2"). Clicking it opens the live workers as one-line rows, each its name and a mark. Finished workers no longer show in the sidebar; the feature page's work panel lists them. A worker that needs the human turns its feature row amber, folded or not.
**Why:** Keeps a feature to one line while workers run, and still reaches a worker's chat in one click. Chosen over a count with no way in, and over today's rows minus the "done" fold.

## 7. No dots: circled icons say what a row waits on
**Decision:** Replaces the marks in decision 4. No amber or red dots anywhere in the epic block, including the epic's own head. Ready to test wears a circled play, a question a circled "?", both amber; a failed worker or a feature that can't start wears a circled "!" in red. An epic whose own chat asks you wears the same "?" in its head.
**Why:** The human: "why do we still have yellow dots? We have the run icon and maybe we can have a question mark icon for questions", and the first icons "feel out of place". One family of line icons, the size of the app's other icons, matches the rest of the app.

## 8. An arrow before the title opens a feature's workers
**Decision:** Replaces the clickable count in decision 6. A feature with live workers shows a collapse arrow before its title, and the arrow opens its workers under it; there is no worker count. Every feature title keeps the same left edge, so rows without workers leave the arrow's space empty. The fold line's arrow moves after its words ("2 working · 1 idle ›"), so the left column only ever means workers.
**Why:** The human: "I don't want to have to click on the worker number to expand the thing… a collapse arrow would be more intuitive."

## 9. A feature row: mark, title, and the workers arrow at its end
**Decision:** Every feature row is one line: its mark in front, its title, and, when it has live workers, the collapse arrow at the row's end. No time on the row; hover shows it with the full reason. Every feature that doesn't need you folds, even a lone one.
**Why:** The human liked this layout ("much better") over the arrow before the title, and asked why a lone working feature sat unfolded and faded.
Supersedes: 8

## 10. Needs-you rows are still and wear the epic's colour
**Decision:** A row that needs you sits on a faint tint of its epic's colour, with its mark (a play for ready to test, a speech bubble for a question) in a small tile of that colour and an unread dot at its end. Hover deepens the tint. The epic's head shows a count of them in its colour. A failed worker or a feature that can't start keeps a red "!". Nothing amber or yellow is left in the block; Other features, with no colour, uses grey.
**Why:** The human turned down amber ("it doesn't look right"), an outlined tray, a travelling light ("will always look like it's working"), a ripple and a Test/Reply pill, then approved this mix on the design page.
Supersedes: 4, 7

## 11. Only working rows move: a small spinner
**Decision:** A working feature or worker wears a small grey spinner in front, the one moving thing in the block. The fold line ("2 working · 1 idle") shows the spinner only while closed; open, it has no mark, so it doesn't repeat the rows under it.
**Why:** The human: anything that moves reads as busy, and the fold line "has the same icon as the rows below". Chosen over the level meter and three dots.
