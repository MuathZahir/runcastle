# Decisions — Agents never stop for approval

What the human decided, or must decide, about this feature. Planned with nobody
present on 2026-11-16: decisions marked **Assumed.** are the lead's picks.

Check first: 4, 6

## 1. Never, everywhere
**Decision:** No runcastle agent ever shows the command approval dialog (the box in a chat with a command and Allow / Reject buttons): not the orchestrator, not a feature lead, not a worker, not the drive chats, with autopilot on or off.
**Why:** The human's words, "Yes to both": an epic left on autopilot sat all night on one approval. Runcastle's agents are meant to run without approvals, so any such dialog is a bug.

## 2. The human's own ask rules are ignored inside runcastle
**Decision:** Inside runcastle sessions, the human's Claude Code "ask" rules (today `Bash(git push *)` in their own Claude Code settings) are ignored too, without editing their settings file.
**Why:** The human's words, "Yes to both". Their rule still asks in their own Claude Code outside runcastle.

## 3. No telling anyone about a stuck approval
**Decision:** Runcastle does not tell the epic or the human that an agent is waiting on an approval.
**Why:** The human rejected it: that moves the click, it does not remove it.

## 4. Every command Claude Code still asks about runs
**Decision:** When Claude Code asks to approve a command even in the no-approval mode runcastle starts it in, runcastle answers "allow" itself, at once. That covers Claude Code's own safety checks (for example some delete commands and commands it cannot fully read, like a script fed in through a heredoc), the human's ask rules, and any session whose no-approval mode was switched off.
**Why:** Every ask in this machine's logs was ordinary work (a commit with a long message, a short Python edit, a push), and the brief wants the work to go on. Allowing behaves like Claude Code's no-approval mode with its last checks off; the guards that deny (the lead's worktree guard, the burn guard) still stop what they stop today.
**Assumed.** Alternative: refuse Claude Code's own safety checks with a reason, so the agent tries another way, and allow only the rest. Safer for files outside the worktree, but an agent may loop on a command it needs.

## 5. An agent's own questions still reach the human
**Decision:** An agent asking the human something (its question tool, an MCP server asking for input) still reaches the human as today. Only command approvals are answered by runcastle.
**Why:** Those are the agent asking, not a command waiting on a click; the brief says not to swallow them.
**Assumed.** Alternative: none worth weighing; recorded because the brief lists it as a limit rather than as the human's words.

## 6. Workers in the sandbox stop asking too
**Decision:** Workers that run inside the sandbox (Claude Code in its "auto" mode, and Codex) never escalate a command to the human. Claude Code workers there start in the same no-approval mode as everything else, Codex workers with approvals turned off, and anything either still asks is allowed as in 4.
**Why:** The sandbox is the guard for those workers; the "auto" mode's extra check sends doubtful commands to a human who is not there.
**Assumed.** Alternative: keep "auto" mode and Codex's auto review, and only answer what they would have escalated. Keeps their extra screening, but a screened command is still allowed in the end, so the screening buys little.

## 7. The Allow / Reject dialog leaves the app
**Decision:** Once nothing can raise a command approval, the dialog that shows one is removed from the app.
**Why:** It would be dead code that hides a bug if it ever showed again; a test asserts no approval ask is ever stored instead.
**Assumed.** Alternative: keep the dialog as a fallback that never shows.
