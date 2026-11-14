# What the two skill workers took out

The "Lead rules" and "Orchestrator rules" workers each listed (a) statements they removed that
describe a tool, for the "Briefings and tools" worker to move into tool descriptions, and (b)
behaviours today's skill asked for that the new one no longer says, for the human to check at
review (spec: "Nothing the human relies on silently disappears").

## Feature lead

### (a) Tool statements removed

- **get_feature_context**: call it first and after compaction; a repeat call returns only what changed; carries the feature, docs (`moreDocs[]`), workers, newest ready, drive on, Stop pressed, waiting reason, `annotatedModels`, `scenarios`, `designs[]` (state, approvedBy, opened, report), `autopilot` (null or the epic); anything not inlined must be read before acting.
- **read_feature_doc**: returns any doc in full.
- **start_worker**: `model` must be an id from `annotatedModels`, never invented; past the machine's agent limit workers queue and start by themselves; without Docker or Podman it says so (point the human at the setup check); "with you" hands back only when the human says so or presses Hand back, "on its own" at done-when.
- **message_worker**: any time; mid-turn messages wait for the turn's end; the human may be talking to it too.
- **land_worker**: through the landing queue like your own commits; never land a Review worker.
- **send_back_worker**: the worker works again; on a review it asks for more.
- **drop_worker**: removes sandbox and branch; closes a review.
- **start_review**: `checksPassed {commit SHA, never a branch name; commands}` — if its checkout is on that commit or differs only in `docs/features/<slug>/` it runs only the typecheck, else everything; `model` comes from the Review row in Settings, omit it; mode is set at start (unset: drives on the human's machine when it can, holds the one drive slot, waits while the human drives; `gates` reads the diff in a sandbox); `verify {findingIds, commits}` checks only those fixes; writes no code; hands back a Review Package.
- **resolve_finding**: `addressed` or `dismissed`, with a note.
- **declare_ready**: `scenario` is the title of the drive Test drive starts; pass on any warning; a worker landed after ready means declaring again.
- **wait_for_you**: withdraw with `{ withdraw: true }`; stays until the human writes, even while you keep working; the only thing that makes the feature "Needs you"; on autopilot it goes to the epic.
- **notify_human**: only for something the human asked to be told beyond a wait; one plain sentence, no secrets (lock screen); refused on autopilot; relay any `note`; runcastle already pings when a wait starts.
- **hand_back** (lead): refused off autopilot; the summary says what is done, left and needed, since the epic never reads the chat.
- **show_file**: words before the call fold away, so put any ask after it; a review's screenshots arrive in its package.
- **show_panel**: `work`, `review`, `details`, `drive`, only while talking about that thing; never in a planning run with nobody present.
- **show_plan**: posts the Plan card and opens the Plan tab.
- **show_design**: records the page and posts its card; opens the Design tab, except in a planning run with nobody present; calling again puts the design back to waiting.
- **start_design_server**: records the command in `.runcastle/design.json`; stops when the chat ends, the feature ships, or after 30 minutes unseen; opening the view restarts it; in a planning run it records the command for the human's Design tab.
- **set_design_state**: no Drop button, so a spoken rejection is recorded as `dropped`.
- **create_feature** (lead): backlog only (`draft: true`); the brief says why it was deferred and what it must not swallow; `dependsOn: [this slug]`.
- **Design approvals**: Approve-button approvals stay quiet until the last waiting design is approved, then one `[runcastle]` line names them all, with the tweak values the page last reported.

### (b) Behaviours no longer said

- Read one reference file per read (kept as "one file per read").
- The "Proceed with your task" launch line is no go-ahead to skip grilling; skip the grill only when nothing is left to decide, and say so.
- Domain modelling while grilling: challenge conflicting terms, invent edge cases, cross-check claims against the code.
- Offer to cut deferred scope (kept as "offer a split").
- Never compact or /clear yourself.
- The good order: understand, decide, write, build, check, hand over.
- Use Read and Edit, not patch scripts in /tmp or long heredocs.
- Run your own checks after a subagent's chunk of code (now only "trust the diff").
- Check drives go to a helper subagent on a small model; its brief and report format; which screenshots to open; with no drivable app, lean on checks and say so.
- Assignment detail: name files, patterns and gotchas; name the covering tests, not the whole suite; UI work names design references and critiques with screenshots; one screen block per screen worker; one area per worker; parallel workers touch different files; order dependent work.
- Never ask a worker for its transcript; the human's direction to a worker means amending decisions and spec on landing; "+"-started workers handled the same; on a failed worker retry, drop or do it yourself.
- Stand on a reported bug before fixing it (reproduce, or trace to file and line); after a drive, reply first with what you will do about each point.
- The step-back line format; on stopping, independent workers finish and nothing is sent back.
- A change of how that overturns a decision appends a superseding decision.
- Commit only once checks are green for code; never reword `runcastle: …` commits; commits wait while the human drives.
- After the human presses Stop, start nothing until they reply.
- Merge-conflict handling (`git merge-base --is-ancestor` first; if base is in, say so and stop; else resolve, check, commit).
- A shipped feature: only answer questions and amend docs.
- Ready-check rule: a clean tree equal to the last green commit, or differing only in feature docs, needs no rerun.
- Show your own screenshots with `show_file` and a caption before saying ready.
- Never point back at words the human may not see (kept as "question last").
- Autopilot end: re-ask open questions with `wait_for_you`; the epic's answers count as the human's when they handed decisions over.
- Planning alone: question rounds, depth rule, challenger, "For the human" mark (all dropped by decision 9).
- Plan and design page minutiae: starter tokens, in-page link scrolling, judging a prototype of another product's UI by its look, stale preview repair note, `.runcastle/preview/design-report.ts`.

## Orchestrator

### (a) Tool statements removed

- **send_to_feature**: the message opens with a line naming the epic, so the lead records any decision it changes as the orchestrator's; it clears Stop like a human message; it counts as the human only when they handed over decisions or it carries `humanWords`.
- **read_feature_chat**: what is new since your last read, or the last turns with `full`; `shown` lists files the chat showed, to re-show with `show_file`.
- **stop_feature_run**: ends only a headless planning run (today's description does not say so).
- **set_autopilot**: locks every open feature of the epic; `add` moves features into it; only the human ends autopilot (here or "End autopilot" in a locked chat) and runcastle tells the orchestrator; a feature locked to another epic is refused — say which epic holds it.
- **name_epic**: refuses to rename over the human's rename; rename only while the epic is young.
- **show_plan / show_design / show_review_package** with slug: showing a card with a question ending in "?" is how runcastle marks this chat as asking; never show a raw preview.html; mention `commitsSince` when above zero.
- **notify_human**: on autopilot only the orchestrator may notify about locked features; relay any `note`.
- **wait_for_you**: a lead's wait on autopilot reaches the epic as a handback card; a locked feature never shows "Needs you", only this chat does.
- **merge_feature**: writes the outcome doc, marks shipped and cleans up (a hand merge would not); on a conflict resolve in the worktree, commit, call again; a clean merge returns in-progress siblings.
- **plan_feature / start_feature**: a "plan it with me" feature never plans automatically; `start_feature` first lands the orchestrator's commits like a pull, refused when the checkout is on another branch, conflicts, or has overlapping edits.
- **create_feature**: planning `with-me` | `self`, not written into briefs; always pass `baseBranch` on a non-draft; when the current branch is no base, suggest `baseBranches.detectedMain`, pick from `selectable`; backlog is `draft: true` with no base; up next is `upNext: true` plus non-empty `dependsOn`, starting when its last dependency merges; a backlog feature stays put after dependencies ship.
- **set_feature_dependencies**: replaces a draft's whole set (`[]` clears); leaving `upNext` out keeps the mark; the index notation.
- **get_project_context**: feature index (slug, worker counts) and live ADR index.
- **get_work_record**: a seam query returns rows without full digests; read one with featureSlug and seq; `digestNotInlined`; a digest's "left undone" line is the best lead for half-answered work.
- **read_adr**: a live ADR binds every session.
- **list_project_notes**: `screenshotPath` is an absolute host path to Read; paste `attachmentSentence` verbatim into a brief; `driveBranch`/`driveCommit` (+dirty) tell whether a note predates a fix.
- **triage_project_note**: several ids close a theme in one call; outcome forms `→ new feature <title>`, `→ batch feature <title>`, `→ sent to <slug>`, `dropped: <why>`; pass `featureId` when the destination is a feature; a triaged note is frozen, only the human reopens it.
- **update_project_note**: only for a theme the human defers, with their OK.
- **dry_run_drive**: start lands commits first; identity slug `prep-dry-run` (RUNCASTLE_ID `prep_dry_run`); returns the drive.env variable names it parsed; status gives pane, URL, devReady; verified stamps set by the server only on a clean full pass.
- **record_finding**: never overwrites a human-set key ("none" and user-supplied are on the preparation page).
- **drive**: starts from the scenario its ready names; `deniedReason`.
- **get_feature_context** with slug and `full: true`: the lead's whole bundle and worker ids; a failed drive's reason.

### (b) Behaviours no longer said

- Opening move: greet and ask "What are we cutting into features today?"; orient lazily; "Proceed with your task" is no go-ahead; a missing charter is noted, not scaffolded.
- Triage: offer it when the prompt says there are open notes; a briefing to triage means start at once; the method (read every screenshot, cluster into themes and play back, grill theme by theme, route each, batch small themes into one feature per pass, close with counts).
- Routing's five named destinations; "one feature per change, not per fix"; a small change's brief carries its repro or expected/got.
- Health sweeps: where to look (dead code, missing tests, drifted docs, recurring failures, stalled features); findings stored nowhere.
- Curation list: stale or disagreeing ADRs, a term with two meanings, drifted docs.
- Grill detail: breadth first, then core, uncertainty and width; walk every branch; say a "your call" pick back in one line; "nothing left to decide" plans automatically; examples of "plan it with me" vs "plan automatically"; every new request is a new cut.
- A "plan it with me" feature's turn: hand the human its chat, name what waits on it, `notify_human` once, keep the rest moving.
- Base branch: object when the current branch looks wrong; ask on a release, hotfix or stacking signal.
- Autopilot detail: say in the run plan if "carry on after a usage limit" is off; features left for the human stay locked and untouched; "I'll do X myself" keeps X locked until autopilot ends; off autopilot a refusal means link the human to the chat.
- Handed-over decisions: designs approved via `set_design_state`; leads record `**Decided by autopilot.**`; one summary when the human is back.
- Judging a plan: a decision contradicting the human goes back via `send_to_feature`; how-it-is-built decisions are the orchestrator's; never override their config.
- End of a batch: give the plan's yes via `send_to_feature`; one end report; start the first drive and say what to try; then "merge these?"; read the review through a subagent; have the lead delete scenarios it added before merging, except any the human keeps.
- "What's waiting for me?" lists each item with its one place.
- When the human judges one part, say its siblings are unmerged; order shared pieces to merge first.
- `[runcastle]` lines: a failed drive; a draft on autopilot that started itself; an agent that could not be woken; the merge-check detail.
- A mangled message may be a runcastle line joined to the human's half-typed one.
- Start only as many features as gain from it; workers share one machine limit.
- Load tools once with the ToolSearch line; name the epic again if missed.
- Report briefly what you did and decided; the closing git-status steps.
- Never scaffold an empty ADR or a backlog file.
- Preparation: the plain-words table for new users; "work quietly"; the close line about Settings › This project; show the human a script before committing it; prove commands in your own worktree; the full scenario contract; all recipes (postgres, compose, redis, hosted, port helpers); do not re-derive a settled value.
