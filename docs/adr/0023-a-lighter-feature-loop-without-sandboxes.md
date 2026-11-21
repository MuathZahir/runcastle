# ADR-0023: A lighter feature loop — no sandboxes, no required plan, one involvement setting

- **Status:** accepted as direction (2026-11-21). Each part comes into force when the
  feature that builds it merges. Until then `CONTEXT.md` describes how runcastle works,
  and the orchestrator rewrites the charter at each merge.
- **Deciders:** Muath + the orchestrator, in the epic "Runcastle Rethink"
- **Supersedes, as its features merge:** ADR-0022 (epics on autopilot); ADR-0004,
  ADR-0005 and ADR-0018 (the worker sandbox's caches, isolated workspace and image
  build)
- **Amends:** ADR-0019 (where workers run; what the epic hears), ADR-0020 decision 2
  (the parts that name worker sandboxes), ADR-0008 (its bounds on agents stay; its
  sandbox parts go), charter decisions 6, 9, 13, 16, 17 and 18

## Context

An audit of a 36-hour autopilot run on another project (18–20 Nov 2026, runcastle
1.7.4) found 36.4 hours of wall-clock time for 16.2 hours of agent work. The largest
losses were silent: 7.7 hours behind a dead worker that showed "working", 9.7 hours
stopped on usage limits, 1.6 hours with the orchestrator locked out, and 16.4 hours of
workers queueing because one ran at a time. About 702M tokens were used, 96.6% of them
agents re-reading their own conversations.

The human's complaint was wider than that run: "Features that could have finished in
less than 30 mins taking hours is unacceptable", and "using runcastle became a cost
rather than a solution". Every feature paid the same fixed cost whatever its size: a
brief, a grill, a decisions file, a spec, a drawn plan page, an approval, a container,
a landing, two reviews and an outcome doc. A recent one-line change to runcastle spent
9.5M tokens on its two reviews and found one low-severity defect.

Sandboxes accounted for a large share of the audit's findings (images missing a
toolchain, no shared build cache, 1.6 GB copied per worker, stale private copies of the
branch, container deaths nobody saw) while protecting less than they seemed to: leads
and the orchestrator already ran on the host without permission prompts.

The audit proposed about 45 fixes, a third of them new machinery. This decision takes
the other road: fix the real bugs, then remove structure until most of the remaining
problems cannot occur.

## Decision

### Who does what

1. **Sandboxes are removed, not made optional.** Workers run on the host. Runcastle's
   guards before each tool call are the only protection: edits stay inside the agent's
   own folder, and a short list of destructive commands is refused. The remaining risk,
   that an agent's script can reach outside its folder, is accepted and stated plainly
   to users. Docker and Podman stop being prerequisites.
2. **A worker builds in the feature's own folder, straight on the feature branch.** Only
   when a lead runs workers in parallel does each get its own folder and branch; each
   merges back when the project's checks pass and the lead has skimmed the diff. Leads
   give parallel workers work that does not need the same port or database.
3. **The lead may build small things itself**, by judgement: when writing the assignment
   would take about as long as doing the work. The docs-only guard on the lead's folder
   goes.
4. **The reviewer is an ordinary worker with runcastle's standard instructions**, never a
   prompt the lead writes, and it starts with an empty conversation. It checks the diff
   against the human's words in the brief and the repo's standards. There is one review
   of the whole feature, not one per worker.
5. **The lead accepts or sends back** from the review's findings and a skim of the diff's
   shape. It does no line-by-line review of its own: it wrote the plan, so it shares the
   plan's blind spots.

### The flow

6. **No required plan approval.** The lead asks only when what the human gets, where it
   lives, who sees it, or another decision of theirs is open; their answers are the
   approval. When nothing of theirs is open it plays back in a few lines what it will
   build, then builds. A new or changed screen still needs the human's yes to its
   design. A drawn plan page is optional, shown in the chat; the Plan tab is removed.
7. **One setting per feature says how involved the human is**, with four nested levels
   (working names, to be tuned by the feature that builds it):
   - *Everything*: ask the decisions, show the designs, the human tries it and merges.
     The default.
   - *Designs*: the lead decides small things; the human sees screens, tries it, merges.
   - *Result*: the lead plans and builds it all; the human tries it and merges.
   - *Nothing*: runcastle merges once the lead says ready and the review is clean.

   It is chosen on the feature creation card, with the epic's recommendation
   preselected, shown and changeable on each feature, and settable for every feature of
   an epic at once. It replaces the "plan with me or plan automatically" choice, the
   autopilot switch, the run plan and the locking of feature chats. At every level:
   work stops before money, accounts or anything outside git that cannot be undone;
   anything the human named as theirs is still asked; and each decision made without
   them is recorded and listed for their return.
8. **Review scales with the change.** Every feature gets one review. It drives the app
   only when something a user sees or does changed. A second review runs only after a
   large set of fixes; the lead judges that.
9. **A feature that waits on another starts only after that one merges**, and then
   starts working by itself at its level. Nothing is built on unmerged work.

### How agents talk

10. **The human's words travel down unchanged**: the brief holds them, and a worker's
    assignment quotes the part it needs.
11. **News travels up one step, and only when it matters.** A handback is short: what
    was done, what was not, where to look. Leads decide the questions their level lets
    them decide; the epic is not a relay.
12. **Runcastle states facts itself.** A status comes from what is running. One alert
    goes to the human when features are open, nothing is running and nothing waits on
    them.
13. **When the base branch moves, nobody is pinged.** A lead brings it into its branch
    before the review and before it says ready.
14. **The epic is woken for each merge of its features and for trouble that crosses
    them** (a conflict a lead cannot resolve, a feature stuck after three tries, a stop
    for money or something irreversible), and for nothing else. The merge message
    carries the review's summary and anything that departed from the brief, so the epic
    can answer in one turn: update a later feature's brief, offer a follow-up for a gap,
    or, on the last merge, tell the human the epic is done.

### Docs and capacity

15. **One growing file per feature**: the human's words, then the decisions (theirs, and
    those made without them), then short build notes, then the review's summary at
    merge. No separate spec or outcome. The review package is the thing the human
    reads, and it lists what was decided without them.
16. **One visible number** sets how many workers and reviews run at once, with a default
    taken from the machine's memory. Leads and the epic never queue. A waiting worker
    says what it waits behind.
17. **Sessions keep the human's own skills, plugins and tool servers**, as ADR-0019 §9
    says. A clean default was considered and rejected: most people want their skills in
    their sessions.

## Considered and not built

A memory-aware scheduler with light and heavy queues; a registry of migration numbers
and other shared counters (the second feature to merge renumbers); a project-level
agreements file (the brief holds the human's words); a long-lived builder container; a
separate screen-review pass; a watchdog beyond the one alert in 12; building a waiting
feature on its dependency's unmerged branch; a size switch between a "small" and a
"large" path (each stop exists only when it has something to stop for).

## Consequences

- The seven bugs in the audit's first part are fixed as their own features, under any
  design: `stopping-a-session-kills-its-process`, `a-usage-limit-never-strands-work`,
  `a-restart-resumes-planning-runs`, `a-worker-never-shows-working-with-nothing-running`
  and `the-orchestrator-is-never-locked-out`. The stale worker copy goes with the
  sandboxes.
- A lead that keeps building lets its conversation grow, the problem workers were
  introduced to solve (ADR-0019). The existing cap on a lead's conversation bounds it.
- A lead deciding its own question will usually pick its own recommendation. The
  record of decisions made without the human, shown on their return, is the check.
- Two parallel features may pick the same migration number or drift from each other;
  bringing the base branch in before review, and the human's drive, are the checks.
- A project with a heavy build can overload the machine at the default number; the
  human lowers it.
- The charter's core loop, decisions 6, 9, 13, 16, 17 and 18 and the principle that
  names "sandboxed workers" are rewritten as each part merges.
