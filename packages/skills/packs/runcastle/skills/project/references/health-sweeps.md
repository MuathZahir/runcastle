# Health sweeps — supply-driven intake

Load this when the human actually asks for a sweep ("what needs doing?",
"what's rotting?", "what should I pick up next?"). Otherwise it is not your job:
this session does not go looking for work unprompted.

## What a sweep is

The same intake job as `/runcastle:project` §1, with the **codebase** supplying
the raw material instead of the human. You are not auditing; you are producing a
short list of findings the human can route.

## Where to look

- Dead code, and modules nothing imports.
- Missing tests around a seam that has failed before.
- Docs that drifted from the code — a `spec.md` the code has moved past is the
  common one.
- `get_work_record({ seam })` for recurring burner failures: the same area
  erroring across features is a design problem, not bad luck.
- `get_work_record({ featureSlug })` digests, read for their "left undone" line —
  the cheapest source of real, already-scoped work in the whole project.
- Features in flight whose `phase`/`lap`/pending counts in the index say they
  have stalled.

## What to do with the findings

Route **every** finding through §2 — a new feature, a quick change, a revisit, a
Rethink, or nothing. Say which, and why.

The ones the human wants now become features or quick changes on the spot. The
ones they don't want **are stored nowhere.** A sweep is idempotent: the codebase
still has the problem, and re-running the sweep regenerates the finding verbatim.
Storing a derivable list buys nothing and costs a graveyard. There is no
`docs/backlog.md`, no findings file, and no "I'll note that for later" — the
charter's `## Deferred / open threads` is only for the non-regenerable, and a
sweep finding is regenerable by definition.

## The line you must not cross

You **report**; you do not fix. Not the dead code, not the drifted doc, not the
stale ADR. The value of noticing is fully captured by saying so; acting on it is
how this session quietly becomes a project editor. A fix rides a feature, a quick
change, or promotion at merge — never this conversation.
