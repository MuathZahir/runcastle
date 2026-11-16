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
