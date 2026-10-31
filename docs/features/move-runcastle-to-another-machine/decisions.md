# Decisions — Move runcastle to another machine

Planned without the human on 2026-10-31. Every decision below is the planner's own
recommendation, accepted so the plan could finish, until the human confirms it. An
independent challenger read the brief and an earlier draft; decisions 1, 3, 5, 6 and
10 to 13 were amended after its reading, and decisions 14 and 15 come from it.

## 1. Two published CLI commands, for a Linux or macOS destination
**Decision:** The tool is part of runcastle itself: `runcastle move` on the old machine and `runcastle move-in` on the new one. The old machine can be Windows, Linux or macOS. The new one cannot be Windows, and `move-in` says so. It is a move tool, not a backup or sync tool.
**Why:** A published command is the only way the code reaches the VPS, and a one-off script would have to be carried there by hand and would be just as long. Treating all source paths the same way costs nothing, but a Windows destination would need its own testing and nobody needs it.
**Assumed.** Alternative: a one-off script kept outside the product and thrown away after this move.

## 2. One command does the whole move over SSH
**Decision:** `runcastle move muath@vmi3713868` checks, packs, copies the pack with `scp`, and runs `runcastle move-in` on the other end over `ssh`. With no host it stops after packing and prints the two commands that finish the job, which is also the way through if SSH misbehaves. A failed copy keeps the pack, so nothing is packed twice.
**Why:** The feature's one-line description promises one command. The wrapper only calls `scp` and `ssh`, which the PC and VPS already use, and the manual path is the same code stopped earlier.
**Assumed.** Alternative: two manual commands and a manual copy, with no SSH step inside runcastle.
**Challenged:** The wrapper is a second path to maintain, `scp` cannot resume a multi-gigabyte copy, and `runcastle` may not be on the PATH in a non-interactive `ssh` session. It would cut the wrapper. (The challenger saw only `brief.md`, which does not carry the one-line description.)

## 3. Show the plan first, on both machines, then ask
**Decision:** `runcastle move --dry-run` prints what would move, what would change and what blocks the move, then stops. It works with the server running. Given a host, it also asks that machine for what only it can know: version, free disk, folder clashes, final paths and existing data. A real run prints the same report and asks for a yes before it packs. `--yes` skips the question. Without a host the report says the destination was not checked, and `move-in` makes those checks before it writes anything.
**Why:** The brief requires seeing the changes before anything is touched, and a preview from the old machine alone cannot see half of what could stop the move.
**Assumed.** Alternative: the real run needs a separate `--go` flag and never prompts.

## 4. Repos travel inside the pack, with every branch, and nothing is pushed
**Decision:** Each project's repo travels as a git bundle (one file holding all its commits and refs): every branch, tag and remote-tracking ref. The new machine rebuilds the repo from it and keeps the same remote URLs. The tool never pushes or fetches anywhere. The report names each project with no remote, or with commits its remote lacks, as a note and not a blocker.
**Why:** It makes a project's committed work reachable by construction, so `jewellery-system` and `jev-browser-extension` (no remote) and `JanaLearn_Updated` (46 unpushed commits on `Adel2002`'s remote) can move as they are, and nothing lands on someone else's remote by accident. It also brings feature branches and unfinished ticket branches that exist nowhere else. Copying the repo folders instead would bring Windows `node_modules` and worktree links. The cost is that, after the move, those repos have the VPS and the PC as their only copies.
**Assumed.** Alternative: clone from each project's remote and refuse until everything is pushed, as the brief first assumed.

## 5. Uncommitted work travels too, and the old machine is not changed to do it
**Decision:** Uncommitted changes in main checkouts and talk worktrees (the checkout each feature's chat works in) travel as a patch, plus whole copies of the changed files and of untracked files git does not ignore. `move-in` recreates any talk worktree that has such work and applies it there. If a patch will not apply, the whole copies are kept in a folder beside the repo, the report names it, and the move still succeeds. A checkout stopped in the middle of a merge or rebase blocks the move until it is finished or aborted.
**Why:** The feature's description promises unfinished work, and `jev-browser-extension` has 44 uncommitted files and `exam-forge` 21. Committing them for the human would change the old machine and put half-done work into history. A patch keeps line endings right where git can; the copies mean a line-ending failure loses nothing.
**Assumed.** Alternative: refuse to move until every checkout is clean.

## 6. Rounds and drives finish first; a real move needs both servers stopped
**Decision:** The dry run works with the server up, so the warnings come before anything is cut off. A real `move` and `move-in` refuse while that machine's server is running. Two things block a real move: a round still marked running, and a main checkout left on a feature's branch (the mark a test drive leaves). Open chats do not block: the destination's first boot ends them as it does after a restart, and they can be resumed. The dry run names every feature this affects.
**Why:** Chats and logs write outside the database, so a copy taken while the server runs can catch them half-written. Waiting for a round is cheap and a cut-off one wastes burn spend. Boot handling already covers a session whose process died, so chats need no separate state.
**Assumed.** Alternative: take a database snapshot while the server runs, and leave anything live out of the move.

## 7. Commands are never rewritten; Windows-only ones are cleared for preparing again
**Decision:** On a move between operating systems, any prepared command plainly tied to the old system (`cmd`, PowerShell, `.bat`, `.cmd`, `%VAR%`, a drive-letter path) is cleared. Portable commands stay. Every "verified by a dry run" stamp is dropped, because that proof came from the other machine. Old values are saved in a report file on the destination and listed on screen. The human then runs Prepare on that project; it fills in exactly the cleared fields. A move between two Linux machines clears nothing.
**Why:** The runcastle project's reset command is `cmd` syntax, so rewriting paths cannot fix it, and a translated command would be an untested guess. Clearing is what hands a field back to preparation, even one the human typed by hand. Keeping portable commands means a project with no Windows-bound command still works without another Prepare; a command the check misses fails loudly at its first use.
**Assumed.** Alternative: keep every command as it is and let the first drive fail.
**Challenged:** On a cross-system move, clear the drive setup, drive stop and database reset commands on every project. The stamps are dropped anyway, so each project likely needs Prepare regardless, and a detection list will miss cases.

## 8. History text is left alone
**Decision:** Windows paths inside events, tickets, review findings, notes, thread logs and transcripts stay as written. Only the paths the app acts on are rewritten: `projects.repo_path`, `sessions.worktree_path` and `sessions.transcript_path`.
**Why:** The brief rules out rewriting history, and that text is a record of what happened. Chat images and shown files are served by id from the session folder, not by a stored path, so old chats keep showing them.
**Assumed.** Alternative: rewrite paths in the events' data as well, so old links stay accurate.

## 9. A failed move loses nothing, and the old machine stays usable
**Decision:** The old machine is only read. The pack is built in a temp folder and nothing in `~/.runcastle`, the repos or `~/.claude` changes. The new machine builds everything in a staging folder, checks it, and only then swaps it in. If any check fails, the destination is as it was. After a good move-in the pack is deleted from both machines. The closing message says the new machine is now the only home and the old one must not be used for work.
**Why:** The brief requires an untouched source, and a working old machine is the cheapest way back if the new one disappoints. The pack holds chats, which may hold pasted secrets, so it should not sit in a temp folder.
**Assumed.** Alternative: after a good move-in, leave a marker that stops the old server starting until it is removed by hand.
**Challenged:** One closing message is the only guard against the split the brief says cannot happen. It would write that marker. The marker changes the source, so this needs the human's call.

## 10. Existing data on the destination is set aside, never merged, and a second move works
**Decision:** `move-in` refuses if the destination already has projects, unless given `--replace`, and the report shows what is there. With it, the old data folder becomes `~/.runcastle.before-move-<date>`, and target repo folders are renamed the same way. The destination's own `.env` and install id are kept. Settings come from the old machine, except burn width and CPU limits, which stay the destination's. `--replace` passes through the one-command form. `runcastle-trial` on the VPS leaves this way. Moving again later is the same command with `--replace`: the newest move wins, and whatever the destination held is set aside, not merged.
**Why:** Two machines' ids and histories have no safe merge at solo scale. Renaming keeps an easy way back, and it lets a failed or repeated attempt run again.
**Assumed.** Alternative: merge the incoming projects into the destination's database.

## 11. Repos land in `~/projects`
**Decision:** Each repo lands at `~/projects/<its folder name>`, or under `--repos-dir`. A target folder that already exists blocks the move unless `--replace` sets it aside, and two projects with the same folder name always block; the report shows both.
**Why:** `~/projects` is the location runcastle itself already recommends on Linux, and the tool never writes into an existing folder.
**Assumed.** Alternative: ask for a target path for each project.

## 12. What travels is everything tied to runcastle's projects
**Decision:** The pack holds the database, `config.json`, session folders (thread logs, chat images, shown files, Codex conversations), reviews, annotations, notes screenshots, design crops and stories. It also holds the whole Claude folder of every project repo and talk worktree: chats started by runcastle, chats started by hand in those repos, and Claude memory. Those folders are renamed for the new paths. Left behind: `.env` files, logins, Codex auth copies inside session folders, logs, caches, the install id, Claude's undo checkpoints, global `~/.claude` rules, skills and settings, and Claude chats in folders that are not runcastle's. Talk worktrees are not packed, because runcastle re-adds them when a session next starts there.
**Why:** The human asked for all of runcastle's data and worktrees rebuild from branches. Hand-started chats in these repos sit in the same folders, so taking them is simpler than filtering them out. Secrets must not travel, though a secret pasted into a chat travels with that chat, as history.
**Assumed.** Alternative: copy all of `~/.claude/projects`, 1.4 GB, whether or not it belongs to a runcastle project.

## 13. Proved on fake data, including a rehearsal to the VPS; the real move is the human's call
**Decision:** The automated tests use scratch data folders and scratch repos, with Windows paths in a simulated pack. Before merge, a rehearsal moves fake data from the PC to a scratch folder on the VPS, leaving the installed runcastle and its service alone. It is the only way to prove line endings and folder renaming between the two systems. Nothing touches the real `~/.runcastle`, the real `~/.claude` or the VPS's real data, and even `--dry-run` is not run on real data until the human says so. The VPS needs a release containing this tool, which needs the human's yes. `move-in` refuses a pack from a newer runcastle than its own.
**Why:** This is the brief's second checkpoint. The real run happens once, so the rehearsal has to cover everything except the real data.
**Assumed.** Alternative: no rehearsal on the VPS, relying on the automated tests alone.

## 14. Git-ignored files and old stashes are reported, not carried
**Decision:** The report lists each project's ignored files by top-level name and size, skipping `node_modules`, so a local dev database or uploads folder is seen before it is left behind. It also counts stashes, because git bundles carry only the newest one, and burner worktrees with leftover changes. None of this blocks the move, and the human can copy what matters by hand from the old machine.
**Why:** Ignored files are mostly rebuildable or secret, and no rule can tell which are precious. Silent loss is what must be avoided, and a list does that.
**Assumed.** Alternative: a flag naming extra ignored paths to carry.

## 15. A project that cannot move does not hold up the others
**Decision:** `--no-repo <project>` moves a project's features, chats and notes but not its repo, for example when a repo is too big or blocked. A project whose repo folder is already gone gets the same treatment automatically, with a report line. It appears on the new machine at its expected path, and it works once the repo is placed there by hand.
**Why:** With eight projects, one blocker should not stop the move, and history is worth keeping even without the repo. Leaving a project out altogether would lose the data the move exists to carry.
**Assumed.** Alternative: every project must be clean, or the whole move waits.
