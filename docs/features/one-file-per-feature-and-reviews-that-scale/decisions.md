# Decisions — One file per feature, and reviews that scale

Planned by the lead with nobody present (2026-11-21). Decisions 1–4 are the
human's, from the brief's "Decided with the human" (ADR-0023 decisions 4, 5, 8,
10, 11, 13 and 15). Decisions 5–10 were made without them; the epic said go on
them on 2026-11-21 (autopilot) and lists them to the human to overturn.

## 1. One growing file per feature, and the review package is what you read
**Decision:** A feature keeps one growing file: the human's words, then the decisions (theirs, and any made without them), then short build notes, then the review's summary at merge. There is no separate spec and no separate outcome: runcastle stamps the review's summary into the file at merge, and no agent writes it. The "how" is the short build notes plus the assignment each worker gets; for a large feature the lead may write a longer assignment as a working paper, not a kept document. The review package is the one thing the human reads. Tests and scenarios are untouched.
**Why:** "the amount of redundant documentation runcastle makes. The spec, plan, etc.. which most of the time, users wont read." Agreed in the epic: "Yes", and "Alright. These look good, so also add the review package."

## 2. Review scales with the change
**Decision:** Every feature gets one review, always. It drives the app only when the feature changed something a user sees or does. A second review runs only after a large fix set: more than a handful of findings, or fixes that reached into code the feature had not touched; the lead judges. After a small fix set, passing checks and the lead's skim are enough. The lead accepts or sends back from the findings and a skim of the diff's shape, with no line-by-line review of its own.
**Why:** A one-line change spent 9.5M tokens on two reviews and found one low-severity defect, while a read-only review of another feature cost 0.9M and found two real ones. Agreed in the epic: "Agreed".

## 3. The reviewer is an ordinary worker with runcastle's standard instructions
**Decision:** The reviewer is an ordinary worker, started with runcastle's standard review instructions (never a prompt the lead writes) and an empty conversation. It checks the diff against the human's words in the brief and the repo's standards, not only against the lead's notes.
**Why:** The human: "the lead can just create a worker with a review prompt, right?" Settled as an ordinary worker with standard instructions, so the lead's blind spots do not travel into the review.

## 4. How agents talk
**Decision:** A worker's assignment quotes the human's words it needs, unchanged. A handback is short: what was done, what was not, where to look, with no logs or file lists. The lead brings the base branch into its branch before the review and before it says ready. Nobody is pinged when the base branch moves.
**Why:** ADR-0023 decisions 10, 11 and 13. Agreed in the epic: "Agreed".

## 5. The one file is the feature's `brief.md`, grown in place
**Decision:** The file keeps its name, `brief.md`. The orchestrator writes it at creation as today. The lead adds the decisions and build notes below the brief, and runcastle adds the review summary at merge. In Details → Docs it reads "Brief", as now.
**Why:** The human's words were "keep the brief and decisions in one growing file". Every feature already has a `brief.md` (all 238 shipped ones do), and the orchestrator's tools, the "read a shipped feature's brief" tool and the chat's start check already read it, so nothing has to learn a new name or a fallback.
**Decided by autopilot.** Alternative: a new name such as `feature.md` that says what the file has become, at the cost of a second name every tool must know for old features.

## 6. The file's four parts, and who writes each
**Decision:** The file reads top to bottom: the brief as the orchestrator wrote it (the human's words); `## Decisions`, numbered, in the same shape as today's decisions file, added by the lead when the first one settles; `## Build notes`, a few short paragraphs from the lead (the approach, where to test it, what is left out), no file lists; `## Review summary`, added only by runcastle at merge. The orchestrator's "add to the brief" tool writes into the first part, above the decisions. Each part appears only once it has something in it, so a small feature may be the brief alone until merge.
**Why:** It is the order the brief asks for, and it keeps the human's words at the top, where the reviewer and every worker read them first.
**Decided by autopilot.** Alternative: runcastle scaffolds all four headings at creation, so the file's shape is visible from the start but carries empty sections.

## 7. The merge stamp is short: what the review found and what became of it
**Decision:** At merge, runcastle adds a `## Review summary` holding the ship date, the commit and file count, and each review's findings with how each was resolved (fixed with its commit, accepted, or left open). The worker list with token counts and the old ticket digests are left out. The epic's merge news points at this section in place of the outcome doc.
**Why:** The human reads the review package before merge; after merge, the record worth keeping is what was found and what was done about it. Token counts and the worker list stay readable in the feature's work record (runcastle's own database), only not copied into the file; the epic asked for that.
**Decided by autopilot.** Alternative: stamp the whole of today's outcome doc into the file (workers, token counts, ticket digests), so nothing it records today is lost.

## 8. Features started before this merges keep their separate files
**Decision:** A feature whose folder already has `decisions.md` or `spec.md` when this merges is an old-shape feature: its lead keeps writing those files, it gets `outcome.md` at merge as today, and every tool reads it as today. Only features with neither file use the one-file shape. The 230-odd shipped features are not touched and stay readable.
**Why:** It needs no migration and no switch, and an in-flight feature is never caught half in each shape. A new feature with no decisions at all is simply the brief alone, which is already right.
**Decided by autopilot.** Alternative: in-flight features switch at merge time, folding their decisions into `brief.md` and dropping the spec, which ends the old shape sooner but rewrites files mid-feature.

## 9. "Something a user sees or does" means what the project's users meet, and the lead picks the kind
**Decision:** A review drives when the diff changes anything a user of the project meets: a screen, a command's output or options, an API's responses, or a library's public functions. Driving means using it the way that user would: open the screen, run the command, call the API, or call the function from a scratch script. For a project with no screen, driving is running the command or calling the API as its user would; the wording stays that plain. Internal-only changes (refactors, tests, docs, build setup) get a reading review. The lead picks the kind when it starts the review, by this rule. A reading reviewer that finds a change a user would meet says so as a finding, so a wrong pick is caught. A project the machine cannot drive gets a reading review, as today.
**Why:** The rule has to work for a project with no screens. Making the lead choose explicitly replaces today's default of driving whenever the machine can, which is what made a one-line change cost two full drive reviews.
**Decided by autopilot.** Alternative: runcastle picks from which files changed (for example, any change under the web app). It would need per-project setup and breaks for projects whose layout it does not know.

## 10. The scenario rule stays, but runs before "ready" instead of before the verify review
**Decision:** A lead still writes and proves a scenario for each "No scenario reaches <state>" the review reports. Because the second review is now often skipped, that happens before the lead says ready, whether or not a second review runs.
**Why:** The brief says to leave the scenario rule as it is and name it if it gets in the way. It does get in the way, because it is timed to the second review, which decision 2 makes rare. This keeps the rule and changes only when it runs.
**Decided by autopilot.** Alternative: drop the rule, so scenarios are written only when the work builds a slow-to-reach state.
