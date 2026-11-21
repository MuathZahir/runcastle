# Decisions — Workers build in the feature's folder

Decisions 1 to 6 are the human's, from the brief and ADR-0023. 7 to 13 were made in a planning run with nobody present; the epic (Runcastle Rethink, running this feature on autopilot) then settled them on 2026-11-21, changing 8 and 12 (see 14 and 15). The human can overturn any of them.

## 1. Workers run on the host, with no sandbox and no opt-in
**Decision:** Every new worker runs on the human's machine as an ordinary process. No setting brings the container back.
**Why:** "if sandboxes are causing all these issues I dont think it should even be opt in. Why offer something if the user will hate it." Deleting the sandbox code is the next feature, "Sandboxes are removed".

## 2. One worker builds in the feature's own folder, on the feature branch
**Decision:** A worker builds in the lead's folder and commits straight onto the feature branch. Its commits are simply there: no landing step, and it always sees the lead's latest commits.
**Why:** The folder rule the human agreed ("Agreed"). It removes the stale private copy and the landing step.

## 3. Parallel workers each get their own folder and branch, merged back on green checks and the lead's skim
**Decision:** A worker running beside another gets its own git worktree and branch. It merges back into the feature branch when the project's checks pass and the lead has skimmed the diff. No review agent per worker; one review of the whole feature at the end.
**Why:** The folder rule the human agreed ("Agreed").

## 4. The lead builds small things itself
**Decision:** The lead may edit code in its folder, by judgement: build it yourself when writing the assignment would take about as long as doing it. No guard keeps the lead's folder docs-only.
**Why:** The human: "Agreed." The code already lets the lead edit; this feature fixes the lead's rules and the messages that still say "docs-only".

## 5. Guards are the only protection, and the remaining risk is stated plainly
**Decision:** Runcastle's checks before each tool call keep a worker's edits inside its own folder and refuse a short list of destructive commands. An agent's script can still reach outside its folder; the docs say so plainly.
**Why:** The human: "Alright this is fine."

## 6. Parallel workers get work that does not share a port or database
**Decision:** The lead's rules tell it to split parallel work so two workers never need the same port or database, because nothing separates them any more.
**Why:** ADR-0023 decision 2, agreed with the human.

## 7. The feature's folder goes to the first worker; any other worker running at the same time gets its own folder
**Decision:** Runcastle decides where a new worker builds, the lead does not. If no other worker is building in the feature's folder, the new worker takes it. If one is, the new worker gets its own folder and branch. This holds for a worker the human starts with "+" too.
**Why:** One rule, no choice to get wrong, and the human's "+" fits it with no extra step. Chosen over a flag on each start that the lead sets.
**Decided by autopilot.** Alternative: the lead says per worker whether it builds in the feature's folder or in its own.

## 8. While a worker or a review works in the feature's folder, the lead edits only its docs
**Decision:** The lead's code edits are refused while anything else is working in its folder, with a message saying who holds it. Docs stay open. The lock lifts when that worker hands back, is dropped, or the review ends.
**Why:** It answers the brief's open question (two agents editing one file at once) with one deterministic check, instead of hoping it stays rare. It costs nothing when the lead builds alone.
**Assumed.** Alternative: a rule in the lead's instructions only, with no check.

## 9. The review runs in the feature's folder and does not edit code
**Decision:** A review that does not drive the app runs in the feature's folder on the committed branch, where packages are already installed, and may write nothing but its own notes. It starts only after every worker is landed or dropped, as today.
**Why:** No second install and no extra folder. Chosen over a throwaway folder for each review.
**Decided by autopilot.** Alternative: each review gets its own new folder at the feature branch's tip.

## 10. A worker may not push, rewrite history or leave its branch
**Decision:** On top of today's checks for every agent (no force push, no deleting outside the folder), a worker is refused: any `git push`; rewriting history (`reset --hard`, `rebase`, `commit --amend`, `filter-branch`, deleting branches); switching branch; and `git stash`, whose stack every folder shares. Its file edits stay inside its own folder and the system temp folder.
**Why:** The brief's list (deleting outside the folder, pushing, rewriting history), plus the two commands that would break the shared folder for the lead; the epic stressed that the stash is shared across every worktree. Leads keep their guards as they are today.
**Decided by autopilot.** Alternative: keep only today's checks for every agent and add nothing for workers.

## 11. The same guards on Windows, best effort, said plainly
**Decision:** The checks read the shell forms Claude Code uses on Windows (Git Bash and its PowerShell tool), with Windows paths (backslashes, drive letters) and PowerShell's delete (`Remove-Item -Recurse`) tested. The docs say they are best effort on every platform, Windows included.
**Why:** Workers on the host need the guards wherever runcastle runs; a script can get past them on any platform, so promising more on one would be false.
**Decided by autopilot.** Alternative: say Windows workers are unguarded for shell commands and leave it there.

## 12. Runcastle runs the checks before merging a parallel worker back
**Decision:** When the lead merges a parallel worker back, runcastle first runs the project's check commands in the worker's folder and merges only if they pass, returning the output either way. A project with no check commands merges, and the lead is told no checks ran.
**Why:** "Merged back when the checks pass" becomes a fact runcastle states, not a step the lead can skip. Chosen over leaving the lead to run them itself, as today.
**Assumed.** Alternative: the lead runs the checks itself, as it does today.

## 13. Dropping a worker in the feature's folder keeps its commits
**Decision:** A worker in the feature's folder has already committed onto the branch, so dropping it stops it and leaves its commits. If they are unwanted, the lead reverts them with new commits. Its uncommitted changes are left in the folder for the lead to keep or clear.
**Why:** Undoing them would mean rewriting the feature branch's history, which decision 10 refuses. Chosen over resetting the branch to where the worker started.
**Decided by autopilot.** Alternative: dropping resets the branch to before the worker's first commit.

## 14. Sharing the feature's folder is a rule in the lead's skill, with no check
**Decision:** While a worker or a review works in the feature's folder, the lead's skill tells it to leave code alone and write only its docs. Nothing refuses its edits.
**Why:** The epic: less machinery, the clash is rare because leads mostly write docs, and a refusal would also stop a lead building small things while a worker runs. Chosen over the edit check in 8.
**Decided by autopilot.** Alternative: runcastle refuses the lead's code edits while the folder is held.
Supersedes: 8

## 15. The lead runs the checks before merging a parallel worker back
**Decision:** Before it merges a worker from its own folder back, the lead runs the project's checks in that worker's folder, as today. Runcastle does not run them.
**Why:** The epic: runcastle stays language-agnostic and does not need to know a project's check commands. Chosen over runcastle running them in 12.
**Decided by autopilot.** Alternative: runcastle runs the project's check commands and merges only on green.
Supersedes: 12
