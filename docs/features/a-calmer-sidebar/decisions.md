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
