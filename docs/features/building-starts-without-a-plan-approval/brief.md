# Building starts without a plan approval

> No brief was written for this feature when it was cut. The lead's planning run
> wrote this page from the feature's one-liner and ADR-0023 decision 6, which the
> human agreed in the "Runcastle Rethink" epic (2026-11-21). The ADR lives on the
> project's own branch, not yet on `main`.

## The one-liner

"A lead asks only when a decision of yours is open; otherwise it says what it will
build and builds. The Plan tab goes."

## ADR-0023 decision 6, verbatim

> **No required plan approval.** The lead asks only when what the human gets, where it
> lives, who sees it, or another decision of theirs is open; their answers are the
> approval. When nothing of theirs is open it plays back in a few lines what it will
> build, then builds. A new or changed screen still needs the human's yes to its
> design. A drawn plan page is optional, shown in the chat; the Plan tab is removed.

## Why (the human's words, quoted in the ADR)

"Features that could have finished in less than 30 mins taking hours is
unacceptable", and "using runcastle became a cost rather than a solution".

## Next to this feature

- `how-involved-am-i` waits on this one. It replaces the "plan with me / plan
  automatically" choice and autopilot's switch with one setting per feature.
- `one-file-per-feature-and-reviews-that-scale` waits on this one. It folds the
  brief, decisions, spec and outcome into one file, and lists "decided without
  you" in the review package.

Who: every runcastle user.
