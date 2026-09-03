# Waypoint 1 — Reconcile the prior designs and audit findings with what is built

**The doc is [`prior-designs.md`](./prior-designs.md).**

The waypoint prompt named two paths for this research node's output: the runner's
template asked for this numbered filename, and the waypoint's own `question`
asked for `research/prior-designs.md`. The question is the more specific
instruction about *this* waypoint's deliverable and is the name the map and
converge sessions will cite, so the findings live there and this file is a
pointer — one doc, two names, no divergent copies.

**Answer, in one line:** almost everything the seven prior designs promised is in
the code; the annotation loop is mechanically complete and was witnessed working
in a browser, so the human's complaint is about ergonomics (layout, pen, save
gating, jump-back) rather than breakage. Audit findings F3, F8, F21, F22, F23 and
F25.1 are closed in code and F12 is closed except its "expected duration" half.
All three `ux-issues` "left undone" items are confirmed still open, plus two more
defects in the same family.
