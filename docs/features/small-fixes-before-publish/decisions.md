# Decisions — Small fixes before publish

Planned without the human (headless planning run, 2026-11-02). Every decision
below is assumed until they confirm it.

## 1. Every session kind runs without permission prompts
**Decision:** The host-side kinds that still ask today — the setup session (`prepare`), the Fix-it chat for a failed drive (`drive-fix`) and the scenario chat (`scenario`) — run in Claude Code's no-prompt mode (`bypassPermissions`) like the lead and the orchestrator already do. Rules the human wrote in their own Claude settings still prompt: Claude Code keeps explicit `ask` rules even in that mode and even when a hook answers "allow", so nothing extra is needed to honour them.
**Why:** The human does not want agents stopping for permission; a prompt nobody answers stalls the session, and a headless run simply refuses the call.
**Assumed.** Alternative: keep `acceptEdits` and widen the pre-allowed command list kind by kind (still prompts on anything unlisted).
**Challenged:** The no-prompt mode drops every shell prompt, not just the git ones, so the Fix-it and scenario chats could run `rm` or `sed -i` in the human's checkout unchecked; it would give those two Claude Code's refuse-unless-allowed mode (`dontAsk`) and keep the no-prompt mode for the setup session only.

## 2. The checkout guard replaces the prompts that protected the human's own checkout
**Decision:** The three host-side kinds work in the human's own checkout, and today a prompt is what stops them committing or staging the human's own work there. Under the no-prompt mode a hook refuses instead, with a reason the agent reads: `git add` of anything outside the paths that kind may write (`.runcastle/` and `.gitignore`; the scenario setup errand keeps its wide add), `git commit -a`/`--all`, a commit while anything outside those paths is staged (the refusal lists them), and the git acts that move or discard the human's work (`checkout`/`switch` of another branch, `reset`, `stash`, `clean`, `restore`, `rebase`, `merge`, `push`, branch deletion). Anything the guard cannot read is allowed, like the lead's guard.
**Why:** The brief keeps the protections but drops the prompts; a refusal holds under the no-prompt mode because hooks still run there.
**Assumed.** Alternative: let host-side sessions commit freely and rely on the prompt text alone.
**Challenged:** (same as 1) a git-only guard leaves other shell writes in the human's checkout unbounded.

## 3. Codex leads run unsandboxed; other Codex sessions keep their sandbox
**Decision:** A feature's lead on Codex gets the posture the orchestrator already has there: unsandboxed (`danger-full-access`), approvals off, bounded by the same edit, install and line guards as a Claude lead. Codex's host-side sessions keep the sandbox they have (`workspace-write`, approvals off).
**Why:** Codex sessions already never ask (approvals are `never` for every kind), so "without prompts" holds today. What the lead lacks is room: in the sandbox it cannot install dependencies (network off, the package cache outside its folder), and its job needs that. The host-side sessions work in the human's own checkout, where that sandbox is the only bound on shell writes, and they lose nothing by keeping it.
**Assumed.** Alternative: keep the lead sandboxed and only turn its network on.

## 4. A drive cut off by a restart comes back as a drive you can stop
**Decision:** On boot, when the project's main checkout sits on a feature's branch and that feature's last drive event is a start with no stop, the server puts the drive back in the project's drive slot, marked "cut off by a restart" and with no dev server. It then behaves like any drive: it is named wherever it blocks, it shows a Stop button, and Stop runs the normal stop: the project's stop script, then a return to the branch the drive-start event recorded as home. A checkout the human put on a feature branch by hand (no unmatched drive start) is left alone.
**Why:** It is the brief's one-click return, built from what already exists (the slot, the stop path, the named blocker from decision 6), and it also stops the next drive or merge from recording the feature branch as home, because they are refused while the slot is held.
**Assumed.** Alternative: a separate "checkout left on feature/x · Return" notice outside the drive slot, with drives and merges taught to refuse on it separately.

## 5. Shutdown still leaves the drive alone
**Decision:** A server shutdown does not run the stop script or switch the checkout back. Boot recovery (decision 4) is the one path, for a crash and a clean shutdown alike.
**Why:** A crash never gets a shutdown hook, so boot has to handle it anyway; a stop script can be slow, and a shutdown that waits on it can itself be killed half-way.
**Assumed.** Alternative: a clean shutdown also stops the drive, and boot handles only crashes.

## 6. Every drive that blocks you is named, and stoppable where you own it
**Decision:** Every refusal caused by the drive slot says which drive holds it: the "a drive is already active" refusal for feature drives and dry runs, and "Cannot merge while a test drive is active". On a feature's page, the banner with a Stop button shows for any drive held by something else (another feature's drive, a setup dry run, a cut-off drive), not only for project drives. A live review agent's drive is named but has no Stop: the banner says it ends with that review round. A cut-off one (decision 4) gets Stop, since no round is behind it any more.
**Why:** ADR-0014 (one drive slot per project) already says a blocking drive is always named and stoppable; today only project drives meet it. Stopping a review agent's drive from another feature's page would break a round the human did not start from there.
**Assumed.** Alternative: a Stop button on the review agent's drive too.
**Challenged:** ADR-0014 says every blocking drive is stoppable, and a stuck review drive would block the human's merges with no way out; it would show Stop with a confirmation instead.

## 7. A merge on a dirty checkout commits the feature docs first and lists what is left
**Decision:** Before refusing on a dirty checkout, the merge commits pending feature docs the same way a drive start does, and then refuses only if anything else is dirty, naming the first five files and how many more.
**Why:** It is the drive's own check, so the two refusals agree, and docs written by the agents stop blocking the merge.
**Assumed.** Alternative: ignore the docs folder in the merge check without committing it.

## 8. Sending drive notes offers to stop the drive in the same click
**Decision:** While the feature's drive is running, the main button where notes are sent becomes "Send and stop drive". A quieter "Send, keep driving" stays beside it. The drive is stopped first and the notes sent after, so the lead never wakes into a drive that blocks its rounds and commits.
**Why:** A forgotten drive blocks the lead's rounds and every other merge; sending notes is almost always the end of the drive.
**Assumed.** Alternative: one button that always stops the drive, with no way to send and keep driving.

## 9. "All good" is a button
**Decision:** After a drive with no unsent notes, the notes line shows an "All good" button that sends the existing "Drive done, all good — no notes" message to the lead, and stops the drive too when one is running (decision 8). This reverses the earlier drive-notes rule that the notes rail never says all is good.
**Why:** The brief asks for it: the server already supports the message, and typing it by hand is the only way today.
**Assumed.** Alternative: keep the rail silent and add "All good" only to the chat's after-drive notice.
**Challenged:** The brief asks for the button, not where it goes; putting it only on the chat's after-drive notice meets the brief without reversing an earlier rule while the human is away.

## 10. A provider halt says which kind it is, and every kind gets Resume
**Decision:** When a round halts on the provider, the waiting line says which of three it is: a usage limit ("provider usage limit", plus "resets <time>" when the provider's message gives one), a billing problem ("provider billing problem — check your account"), or a sign-in problem ("provider sign-in failed — check your login or API key"). Each gets a Resume button that sends the lead one message ("the provider halt is cleared; pick up where the round stopped") and clears the wait. The lead decides whether to dispatch again.
**Why:** Today usage and billing share one dead-end line, and a sign-in failure shows the raw error. After fixing billing or a login, the human needs the same way back as after waiting out a limit.
**Assumed.** Alternative: Resume only on a usage limit; billing and sign-in show advice with no button.

## 11. The chat box still takes only pictures, and says so
**Decision:** When files that are not pictures are pasted or picked into the chat box, it attaches the pictures and shows a short message naming the files it left out ("Only pictures can be attached: notes.pdf was left out").
**Why:** The brief asks to stop dropping files silently; attaching other files to a turn is new capability, not a fix.
**Assumed.** Alternative: attach other files by passing their saved path into the message.

## 12. Four tickets and a review round, not built in this chat
**Decision:** The work goes to workers as four tickets: the permission posture and checkout guard; the drive slot (cut-off drives, named blockers, the merge's dirty-file list); drive notes (send and stop, All good, the dead note statuses); and the small rough edges (provider halt, merge toast, chat box, project notes). A review round follows. They run one at a time, since this project burns one ticket at once.
**Why:** It is ten separate changes across the server and the app, too much to build beside this conversation, and the human is away, so long unattended work suits workers.
**Assumed.** Alternative: the lead builds all of it in its own chat, with the review round at the end.

## 13. The orchestrator can stop a cut-off drive too
**Decision:** A cut-off drive (decision 4) holds the slot as that feature's drive, so the orchestrator's existing drive tool stops it with `stop` and the feature's name, and every refusal that it causes names it. No new tool.
**Why:** Restarts are routine (every publish and reinstall), and the orchestrator merges on its own while the human is away; a cut-off drive only the human can clear would stall every merge until they return.
**Assumed.** Alternative: boot returns the checkout by itself whenever it is clean.

## 14. Every kind of drive is recovered, not only feature drives
**Decision:** The boot check in decision 4 covers all three drive kinds that run a stop script: a feature drive (a review agent's drive included, which switches the checkout the same way), a project drive and a setup dry run. Whichever has a start event with no stop after it comes back cut off; Stop runs its stop script, and switches the branch back only for a feature drive (the other two never switched it).
**Why:** A project drive or dry run cut off by a restart also leaves its stop script unrun, which the brief asks to fix; the events to spot them already exist.
**Assumed.** Alternative: recover feature drives only, since only they strand the checkout on another branch.

## 15. "Send and stop drive" sends the notes even when the stop fails
**Decision:** If stopping the drive fails (its stop script errors, or the branch switch is refused), the notes are still sent, and the stop failure shows the way a failed Stop shows today.
**Why:** The notes are the human's work and the lead needs them either way; a failed stop is its own problem with its own message.
**Assumed.** Alternative: hold the notes until the drive stops cleanly.

## 16. Resume is a click, at any time
**Decision:** Resume never fires by itself at the reset time, and is never hidden or disabled before it. The reset time shows beside it; a resume too early simply halts again and comes back to the same line.
**Why:** The brief asks for a Resume action; resuming by itself overnight is a new behaviour that spends the human's quota unattended, which they should choose.
**Assumed.** Alternative: resume by itself at the reset time when the provider gives one.

## 17. Deleting a project note asks first, and still takes its screenshot
**Decision:** Delete on a project note asks inline ("Delete this note and its screenshot?", Keep / Delete), the way a drive note already does; the screenshot is deleted with its note. The note form gets an "Add picture" button that picks an image file, beside paste.
**Why:** A screenshot belongs to its note; what was wrong was deleting both with no warning.
**Assumed.** Alternative: keep the screenshot after its note is deleted.
