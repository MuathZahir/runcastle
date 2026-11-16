# Decisions — Agents never stop for approval

What the human decided, or must decide, about this feature. Planned with nobody
present on 2026-11-16: decisions marked **Assumed.** are the lead's picks.

Check first: 4

## 1. Never, everywhere
**Decision:** No runcastle agent ever shows the command approval dialog (the box in a chat with a command and Allow / Reject buttons): not the orchestrator, not a feature lead, not a worker, not the drive chats, with autopilot on or off.
**Why:** The human's words, "Yes to both": an epic left on autopilot sat all night on one approval. Runcastle's agents are meant to run without approvals, so any such dialog is a bug.

## 2. The human's own ask rules are ignored inside runcastle
**Decision:** Inside runcastle sessions, the human's Claude Code "ask" rules (today `Bash(git push *)` in their own Claude Code settings) are ignored too, without editing their settings file.
**Why:** The human's words, "Yes to both". Their rule still asks in their own Claude Code outside runcastle. This reverses `small-fixes-before-publish`, where the human's ask rules kept prompting by design, and the part of `interactive-workers` decision 11 that applied them to workers.

## 3. No telling anyone about a stuck approval
**Decision:** Runcastle does not tell the epic or the human that an agent is waiting on an approval.
**Why:** The human rejected it: that moves the click, it does not remove it.

## 4. Every command an agent still asks about runs
**Decision:** When Claude Code or Codex asks to approve a command even in the no-approval mode runcastle starts it in, runcastle answers "allow, this once" itself, at once. That covers Claude Code's own safety checks (for example some delete commands and commands it cannot fully read, like a script fed in through a heredoc), the human's ask rules, and any session whose no-approval mode was switched off.
**Why:** Every ask in this machine's logs was ordinary work (a commit with a long message, a short Python edit, a push), and the brief wants the work to go on. Allowing behaves like Claude Code's no-approval mode with its last checks off; the guards that deny (the lead's worktree guard, the burn guard) still stop what they stop today.
**Assumed.** Alternative: refuse Claude Code's own safety checks with a reason, so the agent tries another way, and allow only the rest. Safer for files outside the worktree, but an agent may loop on a command it needs.

## 5. An agent's own questions still reach the human
**Decision:** An agent asking the human something (its question tool, an MCP server asking for input) still reaches the human as today. Only command approvals are answered by runcastle.
**Why:** Those are the agent asking, not a command waiting on a click; the brief says not to swallow them.
**Assumed.** Alternative: none worth weighing; recorded because the brief lists it as a limit rather than as the human's words.

## 6. Workers in the sandbox stop asking too
**Decision:** Workers in the sandbox keep the modes the human chose for them (`interactive-workers` decision 11): Claude Code's "auto" mode, where a checker model blocks risky commands, and Codex's auto review. A block stays a block: the worker says in its chat what it wanted, as today. What changes is that nothing they raise reaches the human as an approval: anything still asked (the human's ask rules, Claude Code's safety checks, and the MCP-call asks of the fallback used when auto mode is not on the human's plan) is allowed as in 4.
**Why:** The human asked for the providers' own auto modes, and a block is not a stall. Only the approval asks have to go. The human said "Sounds good" to this when asked to check it.

## 7. The Allow / Reject dialog leaves the app
**Decision:** Once nothing can raise a command approval, the dialog that shows one is removed from the app.
**Why:** It would be dead code that hides a bug if it ever showed again; a test asserts no approval ask is ever stored instead.
**Assumed.** Alternative: keep the dialog as a fallback that never shows.

## 8. Commands that destroy things on the remote are refused
**Decision:** Supersedes 4 for remote commands. No runcastle agent may run a command that destroys or rewrites something on the remote: a force push, deleting a remote branch or tag, a mirror or prune push, deleting a repo or release, merging a pull request, or a raw `DELETE` call to GitHub. The command is refused with a reason, never asked about, so the agent carries on another way. Plain pushes, opening pull requests and starting CI runs stay allowed. It covers every chat that can reach the real remote: the orchestrator, leads and workers on the host, Claude Code and Codex alike.
**Why:** The human: "We don't want to introduce risk to this. We don't want destructive commands that could affect the remote." Until now their `git push` ask rule was the only check on many of these; with it ignored (2), a refusal takes its place. A refusal is not a stall, so 1 still holds. Sandbox workers push only into a local copy and never reach the remote.
