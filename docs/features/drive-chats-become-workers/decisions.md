# Decisions — Drive chats become workers

Planned by the lead alone (2026-11-08), on the human's delegation ("do what you think is best");
no human was present. Each decision names the alternative it was chosen over. One independent challenger read the brief
and these decisions; its objections are marked **Challenged:**.

Check first: 1, 4, 5, 6, 8

The two chats: the **Fix-drive chat** opens from "Fix drive" when a test drive's setup script
fails; it edits the repo's drive scripts under `.runcastle/` and restarts the drive. The
**scenario chat** opens from "New scenario" or "Fix it" during a drive; it writes the scripts
that seed a drive's state (`.runcastle/scenarios/`) and runs them against the drive's database.
Both run today in the human's own checkout, which the drive has switched to the driven branch.

## 1. Both run on the host, in the drive's checkout, as host-placed workers
**Decision:** The Fix-drive and scenario chats become workers that run on the host, in the
human's checkout the drive switched to, exactly where they run today. They join the worker model
(a worker row, label, assignment card, status, handback, the feature's worker list) without
moving into a sandbox. The drive review worker already runs this way (`burns-become-workers`
decision 3); this generalises its host placement to three kinds instead of one.
**Why:** Their whole job is the running drive: the Fix-drive chat edits the drive scripts and
restarts the drive on the host, and the scenario chat runs scenarios against the drive's own
database and app. A sandbox has neither, and giving it both would mean a browser, the drive's
database and the drive's environment inside the image, the large change `burns-become-workers`
already declined for the review.
**Assumed.** Alternative: sandboxed workers on their own branch that reach the drive through
runcastle's tools.
**For the human.** Nothing about where they run or what they can touch changes.

## 2. A drive worker belongs to whoever owns the drive
**Decision:** On a feature's drive, both workers belong to that feature and report to its lead.
On a project-level drive (a drive of the checkout's current branch with no feature, started from
the project page), the scenario worker belongs to the project and reports to the project's chat
(the orchestrator); it is listed with the project's chats. The Fix-drive chat exists only on
feature drives today and stays so. Workers gain an owner that is either a feature or the project.
**Why:** The project drive's scenario chat is how a project first gets its scenarios; leaving it
as the one old-style chat would keep both code paths alive, which the human rejected for side
chats ("I don't want old code and inconsistencies"). It is the same worker with a different
parent, not a third kind of agent (ADR-0019 point 1).
**Assumed.** Alternative: keep the project drive's scenario chat as a plain host chat, the last
one of its kind.
**For the human.** On a project drive the scenario chat shows in the project's chat list as a
worker, and its handback lands in the project chat.

## 3. Their commits go straight onto the driven branch; nothing waits to be landed
**Decision:** A drive worker commits in the drive's checkout, which is on the driven branch, as
the chats do today (`drive-scenarios` decision 4): the feature branch on a feature drive, the
current branch on a project drive. A scenario is usable the moment it is committed. The handback
names those commits and files for the lead, but there is no land step, and the lead cannot send
the work back or drop it.
**Why:** The checkout already is the driven branch, so a separate worker branch would need a
branch switch under the running app, and the human, who is driving, wants the new scenario now,
not after the lead lands it. The worry interactive workers solved, work reaching a feature behind
its lead's back, is met by the handback telling the lead.
**Assumed.** Alternative: commit on a worker branch the lead lands through the landing queue,
like a build worker.
**For the human.** A scenario still works the moment the chat commits it.

## 4. A drive worker's handback reaches its lead quietly
**Decision:** A drive worker's handback is a card in the lead's chat (or the project chat, per
2) that rides the lead's next message; it does not wake the lead. The lead reads it when it next
works: which scripts changed, which scenarios exist now.
**Why:** Nothing in a drive handback needs the lead to act: the commits are already on the
branch (3) and the human, who asked for them, is still driving. Waking the lead for each one
would spend a turn of its large context on a note. ADR-0019 point 6 lets runcastle choose who
hears what; a build worker's handback still wakes its lead because the lead must land it.
**Assumed.** Alternative: wake the lead with every handback, as build workers do.
**For the human.** The lead does not start working when a drive chat finishes.
**Challenged:** an unread Fix-drive handback should surface when the lead declares ready, so
drive-script changes on the branch are seen before merge. Kept: the drive usually comes after
ready, the changes are confined to `.runcastle/`, and the feature's work record lists every
handback.

## 5. One Fix-drive worker and one Scenarios worker per feature, living with the drive
**Decision:** A feature has at most one Fix-drive worker and one Scenarios worker (a project, one
Scenarios worker for its project drives). Each starts working when the human presses its drive
button, and every later press, in this drive or a later one, sends the new ask into the same
worker and resumes its conversation. When the drive stops, runcastle ends any turn still running
and hands the worker back on its behalf: its commits during the drive, the files they touched,
and its last message as the summary. It then sits in Done and takes no messages until the next
drive's button reopens it. The Fix-drive worker also hands back by itself once the app it fixed
is answering again; its own drive restart does not count as the drive stopping.
**Why:** It keeps what each chat learned about this project's drive (today's Fix-drive chat
already reopens its last conversation) and keeps the worker list to two rows instead of one per
drive. Between drives the checkout is back on another branch, often the base branch, so a message
then could commit a scenario where it does not belong.
**Assumed.** Alternative: a new worker for every drive, as the scenario chat does today.
**For the human.** The scenario chat now remembers earlier drives, and both chats go quiet when
the drive stops.
**Challenged:** the Fix-drive worker should be one per project, since what it learns is about
the project's drive, not the feature; and the Scenarios worker should start fresh each drive with
the current scenario list, since remembered context goes stale and grows. Kept: per feature
matches today's Fix-drive reopening and the feature's own worker list, and long conversations
are compacted.

## 6. Only the human starts a drive worker; the lead can message one
**Decision:** Drive workers start only from the drive's buttons ("Fix drive", "New scenario",
"Fix it"), as today. The lead cannot start, land, send back or drop one, and drive workers never
block "ready". The lead can message one while its drive is on, like any worker
(`interactive-workers` decision 17).
**Why:** The drive is the human's (ADR-0014); a lead starting work in the human's checkout would
reach into a drive it does not hold. With nothing to land (3), the lead's landing tools have
nothing to act on.
**Assumed.** Alternative: let the lead start a Scenarios worker to write the scenario it plans to
declare ready with.
**Challenged:** the lead should not message drive workers either: its message starts a turn
that edits and commits in the human's checkout during the human's drive, which is reaching into
the drive. Kept for consistency with every other worker; the human is the one to overturn it.

## 7. Drive workers never wait in line
**Decision:** Drive workers start at once and do not count toward "agents working at once"
(`interactive-workers` decision 14): the drive slot is their limit. An account-level hold on the queue does not hold them; they fail on their own.
**Why:** The human is sitting beside the drive waiting for the answer; queueing a drive chat
behind background build workers would stall the drive the human is in.
**Assumed.** Alternative: count them like any worker, so they can show "queued".
**For the human.** A busy machine can run one or two agents beyond the limit while a drive
chat works.

## 8. Drive workers need the human like any worker
**Decision:** A drive worker whose turn ends shows "needs you" and pings the desktop and phone
once, with the tap opening its chat (`interactive-workers` decision 6). The button that starts
it counts as the human writing to it, so the "+" worker's silent hello (`interactive-workers`
decision 25) does not apply.
**Why:** A Fix-drive turn can take minutes, long enough for the human to walk away from the
drive; one rule for every worker is what the human asked for.
**Assumed.** Alternative: no pings while the drive is on, since the chat sits beside it.
**For the human.** They now get a ping when a drive chat finishes a turn.
**Challenged:** skip the ping while the drive page is open and visible; a ping on every short
turn beside the human's eyes is noise. Kept: one rule for every worker, and runcastle's desktop
ping already stays quiet in a focused window.

## 9. What they may write is unchanged
**Decision:** Drive workers keep today's limits on the human's checkout: no permission prompts,
writes only under `.runcastle/` and `.gitignore` (the whole checkout in scenario setup mode, when
a project has no scenarios yet), and git limited to staging those files and committing, never
switching branches, resetting or pushing. They keep their tools (`retry_drive`, `run_scenario`,
`set_scenario_runner`) and gain the worker's hand-back tool. Their model stays the "Drive chats"
setting.
**Why:** These guards were built for exactly this checkout (`small-fixes-before-publish`
decisions 1–2); the provider's auto mode that sandboxed workers use was chosen for a sandbox, not
the human's real checkout.
**Assumed.** Alternative: run them in the provider's auto mode like sandboxed workers.

## 10. Old Fix-drive and scenario chats become read-only transcripts
**Decision:** The `drive-fix` and `scenario` chat kinds retire. Chats of those kinds made before
this ships stay listed in their feature's Done group as read-only transcripts marked "Old drive
chat"; the next drive button starts a worker, not the old chat.
**Why:** The precedent the human accepted for side chats (`interactive-workers` decision 23):
reopening them would keep the old code alive, and converting them is code for a few chats.
**Assumed.** Alternative: convert each old chat into the feature's first drive worker.
**For the human.** An old Fix-drive conversation is not resumed; the first Fix-drive worker
starts fresh.

## 11. They dock beside the drive and list with the feature's workers
**Decision:** The drive keeps its docked chat column; it now shows the drive worker's chat with
the worker header (label, status, Hand back) and its assignment card. In the feature's sidebar
page the two leave their separate list above the workers and sit in the worker groups (Needs
you / Working / Done) labelled "Fix drive" and "Scenarios". No new screen; the look reuses the
worker list and worker chat as they are.
**Why:** One list of threads per feature (`interactive-workers` decision 24); the dock is where
the human already looks during a drive.
**Assumed.** Alternative: drop the dock and open drive workers like any worker in the main
column.
**For the human.** The two drive chats move from their own list into the worker groups.

## 12. A turn the drive's stop cuts off keeps its uncommitted files visible
**Decision:** When the drive stops while a drive worker is mid-turn, runcastle cancels the turn,
and the drive's stop treats any file the worker changed but did not commit as it treats the
human's own: it comes back onto the branch the checkout returns to, with the drive's notice
naming it. The handback runcastle writes for the worker lists those files as left uncommitted.
**Why:** It is the drive's existing rule for uncommitted work, so nothing is thrown away and the
human sees where it went. Committing a half-written script onto the feature branch on the
worker's behalf would land work nobody checked.
**Assumed.** Alternative: hold the drive's stop until the worker's turn ends.
**For the human.** Stopping a drive mid-answer can leave a half-written scenario uncommitted on
the branch they return to, named in the notice.

## 13. Only one drive worker works at a time
**Decision:** While one drive worker of a drive is working, the other drive worker's button
waits and says which one is working. In practice they rarely meet: Fix drive is offered only
while the setup has failed, and the scenario buttons only while the app is answering.
**Why:** Both work in the same checkout; two agents staging and committing there at once, or a
drive restart under a running scenario, would tangle each other's commits.
**Assumed.** Alternative: let both run and rely on the git guard.

## 14. Fix-drive fixes stay on the feature's branch
**Decision:** As today, a Fix-drive worker's fix to the drive scripts is committed on the
feature's branch and reaches other features when it merges. This feature does not send drive
fixes to the base branch.
**Why:** Committing to the base branch from a feature drive would need a branch switch under
the running app, and the fix is checked by this feature's drive first. Moving drive fixes to the
base branch is its own design question.
**Assumed.** Alternative: commit drive-script fixes to the base branch so every feature gets them
at once.
