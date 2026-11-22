## Purpose

A small server-only fix to runcastle left about 5,000 words in five files: brief, decisions, spec, plan page, outcome. The human: "the amount of redundant documentation runcastle makes. The spec, plan, etc.. which most of the time, users wont read." Reviews are also the same size for every change: a one-line change to the model picker spent 9.5M tokens on two reviews and found one low-severity defect, while a read-only review of another feature cost 0.9M and found two real ones.

This is decisions 4, 8, 10, 11, 13 and 15 of `docs/adr/0023-a-lighter-feature-loop-without-sandboxes.md`.

What the human gets.

**Docs:**
- One growing file per feature: their words, then the decisions (theirs, and any made without them), then short build notes, then the review's summary at merge.
- No separate spec. The "how" is the short build notes plus the assignment each worker gets. For a large feature the lead may write a longer assignment as a working paper, not a kept document.
- No separate outcome. Runcastle stamps the review's summary into the file at merge; no agent writes it.
- The review package is the one thing they read.
- Tests and scenarios are untouched.

**Review:**
- One review per feature, always. The reviewer is an ordinary worker with runcastle's standard instructions (never a prompt the lead writes) and an empty conversation, checking the diff against the human's words in the brief and the repo's standards, not only against the lead's notes.
- It drives the app only when the feature changed something a user sees or does.
- A second review only after a large fix set: more than a handful of findings, or fixes that reached into code the feature had not touched. The lead judges. After a small one, passing checks and the lead's skim are enough.
- The lead accepts or sends back from the findings and a skim of the diff's shape, with no line-by-line review of its own.

**Talk:**
- A worker's assignment quotes the human's words it needs, unchanged.
- A handback is short: what was done, what was not, where to look. No logs or file lists.
- The lead brings the base branch into its branch before the review and before it says ready. Nobody is pinged when the base moves.

Where: the lead's and reviewer's rules, the feature docs runcastle scaffolds, the tools that read them (`get_feature_context` and others), and the merge step. Who: every runcastle user.

## Must not swallow

- The plan approval and the Plan tab (the feature this waits on).
- Listing "decided without you" in the review package: that belongs to the involvement setting's features, which create that record.
- Migrating the docs of the 230-odd shipped features. They stay as they are and stay readable.
- A registry of migration numbers, an agreements file, or a separate screen-review pass: considered and not built.

## Decided with the human

- The docs list ("keep the brief and decisions in one growing file, drop the spec and outcome as separate docs, and make the review package the thing you read"): "Yes".
- "Alright. These look good, so also add the review package."
- The three review rules: "Agreed".
- On the reviewer: "I feel like theres no real difference in functionality that would require a new agent type.. the lead can just create a worker with a review prompt, right?" Settled as: an ordinary worker, but with runcastle's standard instructions, so the lead's blind spots do not travel into the review.
- The five talk rules: "Agreed".
- The cut: "Alright, you can start". Planning mode was the orchestrator's pick (plan automatically).

## Understood

- Both kinds of review (reading, and driving the app) already exist; this is a rule for choosing between them, not new machinery.
- The requirement that a lead write and prove a scenario for every state the review could not reach was not discussed with the human. Leave it as it is and name it in the plan if it gets in the way.

## Open

- The file's name and exact shape, and how tools and older features that expect `decisions.md` and `spec.md` keep working.
- What "something a user sees or does changed" means for a project with no screens, such as a command-line tool or a library.

## Ordering

Waits on "Building starts without a plan approval", because both rewrite the lead's rules. Nothing waits on it.

Planning mode: automatic
