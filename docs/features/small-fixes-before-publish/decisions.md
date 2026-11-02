# Decisions — Small fixes before publish

Planned without the human (headless planning run, 2026-11-02). Every decision
below is assumed until they confirm it.

## 1. Every session kind runs without permission prompts
**Decision:** The host-side kinds that still ask today — the setup session (`prepare`), the Fix-it chat for a failed drive (`drive-fix`) and the scenario chat (`scenario`) — run in Claude Code's no-prompt mode (`bypassPermissions`) like the lead and the orchestrator already do. Rules the human wrote in their own Claude settings still prompt: Claude Code keeps explicit `ask` rules even in that mode and even when a hook answers "allow", so nothing extra is needed to honour them.
**Why:** The human does not want agents stopping for permission; a prompt nobody answers stalls the session, and a headless run simply refuses the call.
**Assumed.** Alternative: keep `acceptEdits` and widen the pre-allowed command list kind by kind (still prompts on anything unlisted).

## 2. The checkout guard replaces the prompts that protected the human's own checkout
**Decision:** The three host-side kinds work in the human's own checkout, and today a prompt is what stops them committing or staging the human's own work there. Under the no-prompt mode a hook refuses instead, with a reason the agent reads: `git add` of anything outside the paths that kind may write (`.runcastle/` and `.gitignore`; the scenario setup errand keeps its wide add), `git commit -a`/`--all`, a commit while anything outside those paths is staged (the refusal lists them), and the git acts that move or discard the human's work (`checkout`/`switch` of another branch, `reset`, `stash`, `clean`, `restore`, `rebase`, `merge`, `push`, branch deletion). Anything the guard cannot read is allowed, like the lead's guard.
**Why:** The brief keeps the protections but drops the prompts; a refusal holds under the no-prompt mode because hooks still run there.
**Assumed.** Alternative: let host-side sessions commit freely and rely on the prompt text alone.

## 3. Codex sessions get the same posture as Claude ones
**Decision:** Every kind passes the same no-prompt mode on both runtimes. On Codex that means the leads and host-side kinds run unsandboxed (`danger-full-access`) like the orchestrator, still with approvals off; the edit, install, line and checkout guards are the bound, exactly as on Claude.
**Why:** Codex sessions already never ask (approvals are `never` for every kind), so "without prompts" holds today; what differs is the sandbox, and in it a Codex lead cannot install dependencies (network off, the package cache outside its folder), which the lead's job needs. One posture for both runtimes is simpler to reason about.
**Assumed.** Alternative: keep the Codex sandbox for everything but the lead, or keep it for the lead and open its network.

## 4. A drive cut off by a restart comes back as a drive you can stop
**Decision:** On boot, when the project's main checkout sits on a feature's branch and that feature's last drive event is a start with no stop, the server puts the drive back in the project's drive slot, marked "cut off by a restart" and with no dev server. It then behaves like any drive: it is named wherever it blocks, it shows a Stop button, and Stop runs the normal stop: the project's stop script, then a return to the branch the drive-start event recorded as home. A checkout the human put on a feature branch by hand (no unmatched drive start) is left alone.
**Why:** It is the brief's one-click return, built from what already exists (the slot, the stop path, the named blocker from decision 6), and it also stops the next drive or merge from recording the feature branch as home, because they are refused while the slot is held.
**Assumed.** Alternative: a separate "checkout left on feature/x · Return" notice outside the drive slot, with drives and merges taught to refuse on it separately.

## 5. Shutdown still leaves the drive alone
**Decision:** A server shutdown does not run the stop script or switch the checkout back. Boot recovery (decision 4) is the one path, for a crash and a clean shutdown alike.
**Why:** A crash never gets a shutdown hook, so boot has to handle it anyway; a stop script can be slow, and a shutdown that waits on it can itself be killed half-way.
**Assumed.** Alternative: a clean shutdown also stops the drive, and boot handles only crashes.

## 6. Every drive that blocks you is named, and stoppable where you own it
**Decision:** Every refusal caused by the drive slot says which drive holds it: the "a drive is already active" refusal for feature drives and dry runs, and "Cannot merge while a test drive is active". On a feature's page, the banner with a Stop button shows for any drive held by something else (another feature's drive, a setup dry run, a cut-off drive), not only for project drives. A review agent's drive is named but has no Stop: the banner says it ends with that review round.
**Why:** ADR-0014 (one drive slot per project) already says a blocking drive is always named and stoppable; today only project drives meet it. Stopping a review agent's drive from another feature's page would break a round the human did not start from there.
**Assumed.** Alternative: a Stop button on the review agent's drive too.

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
