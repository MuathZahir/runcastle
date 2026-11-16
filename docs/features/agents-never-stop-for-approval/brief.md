## Purpose

On another PC the human left an epic on autopilot and went home. One agent stopped on the command approval dialog (the box in a chat that shows a command with Allow / Reject buttons) and the whole run sat there all night. Runcastle's agents are meant to run without approvals; any such dialog is a bug.

## Decided with the human (2026-11-16)

- What: no runcastle agent ever shows the command approval dialog: not the orchestrator, not a feature lead, not a worker, not the drive chats. The human's words: "Yes to both" to (1) never, everywhere, autopilot on or off, and (2) inside runcastle, the human's own Claude Code "ask" rules (today `Bash(git push *)` in ~/.claude/settings.json) are ignored too.
- Where: every agent conversation runcastle runs.
- Who: the human, who should never be asked to approve a command.
- Rejected: telling the epic or the human about a stuck approval. That moves the click, it does not remove it.

## Understood (orchestrator's read of code and this machine's logs, 2026-11-16 — verify)

- Leads, the orchestrator and host-side drive workers launch Claude Code with `permissionMode: 'bypassPermissions'` (`packages/server/src/threads/launch.ts`). Yet this machine's thread logs (`~/.runcastle/sessions/*/thread.jsonl`, entries `"type":"ask"` with `kind: "approval"`) show 14 approval asks since 2026-10-31, mostly in feature lead chats (kind `chat`), one in a worker. Example: the lead of `workers-nest-under-their-feature` waited 45 minutes on 2026-11-14 for `python3 - <<'EOF' ...` editing preview.html. Others: compound `cd ... && git add ... && git commit -F - <<'EOF'`, a `for` loop over several repos, and `gh run view ...; git push ...` (the push matches the human's own ask rule).
- So something defeats bypass mode for some commands; find what (Claude Code's own checks that still ask, the adapter's mode handling, a mode reset mid-session, the human's ask rules, etc.).
- In-sandbox workers open in mode `auto` (`packages/server/src/workers/worker.ts`), and Codex workers in `on-request` with auto review (`workers/codex-setup.ts`). Anything they escalate goes to a human ask (`workers/permissions.ts`). This must stop too.
- Asks are answered in `threads/host.ts` (`onPermission`). A server-side backstop that answers any approval request itself is one option, if the agent CLIs cannot be told never to ask.
- The night in the note happened on another PC whose logs are not here; reproduce rather than reading that case.

## Must not swallow

- MCP elicitations and an agent's own questions to the human (those are the agent asking, not a command approval).
- Guards that deny (lead worktree guard, burn guard) stay: a deny is not a stall.
- No new notification or escalation machinery.

## Open

- The exact triggers, found by reproducing them with Claude Code and Codex.
- How to ignore the human's own ask rules inside runcastle sessions without touching their global settings file.

## Ordering

Independent; nothing waits on it.

Planning mode: automatic
