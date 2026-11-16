# Agents never stop for approval

## Problem

The human left an epic on autopilot and went home; one agent stopped on the
command approval dialog (a command with Allow / Reject in its chat) and the run
sat there all night. Runcastle's agents are meant to run without approvals, yet
this machine's logs hold 14 approval asks since 2026-10-31, mostly in feature
lead chats, one in a worker. The lead of `workers-nest-under-their-feature`
waited 45 minutes on a short `python3 - <<'EOF'` edit.

## Approach

From the human's side: no runcastle conversation ever shows the approval
dialog again, and the dialog leaves the app. Work that would have waited on a
click goes on by itself. An agent's own questions, MCP servers asking for
input, and the guards that refuse a command are unchanged.

### Why bypass mode still asks

Runcastle starts the orchestrator, leads, host-side drive workers and the
other host chats in Claude Code's no-approval mode (`bypassPermissions`),
through the Claude Code ACP adapter (`@agentclientprotocol/claude-agent-acp`).
The adapter and Claude Code still send a permission request to the host in
these cases, by design (the adapter's own comment: "a request that still
reaches this callback is deliberately bypass-immune"):

- **Claude Code's own safety checks**, which bypass mode does not skip: some
  delete commands, and commands it cannot fully analyse (heredocs feeding a
  script, compound `cd … && …` chains). Every ask in the logs looks like this
  class.
- **The human's ask rules** (`permissions.ask`, today `Bash(git push *)`),
  which win over bypass mode. The request then carries `matchedAskRule`.
- **Bypass mode switched off under the session.** The adapter clamps
  `bypassPermissions` to `default` when the process runs as root outside a
  sandbox (`IS_SANDBOX` unset), or when settings disable bypass mode. On such
  a machine (a VPS run as root, say) every write and command asks. This may be
  what happened on the other PC; reproduce it in the build.
- **Tools that need the user**, such as leaving plan mode (`ExitPlanMode`).

Codex sessions ask through their approval policy, and sandbox workers in
Claude Code's `auto` mode ask whatever the checker model and the rules above
leave over (decision 6).

### The change: the host answers every permission request

Every permission request from every runcastle conversation reaches one place:
the thread host's permission handler (`onPermission`), which today opens an
`approval` ask and waits on the human. It becomes a policy that never waits:

1. Pick the option that runs the action once (`allow_once`; never an
   `allow_always`, so nothing is written to any settings file). A request with
   no allow-once option (the plan-exit ask offers mode choices) picks the
   option that leaves plan mode into the session's no-approval mode, or else
   the first allowing option.
2. Append a quiet record to the thread log (`permission_allowed`: the tool
   call's title and, where the adapter sends it, the reason Claude Code gave)
   so a later investigation can see what was answered. The chat shows the
   tool call as it shows any other; no new UI.
3. Return at once. No ask is opened, nothing changes the agent's waiting
   state, nothing pings.

This replaces three branches that exist today:

- the human ask (the `approval` ask kind);
- the worker's own answer in the fallback mode, which already allowed every
  sandbox tool but asked the human before an MCP call (`workerAllowsItself`);
  MCP calls are now allowed too, since decision 1 covers them;
- the reject that planning-alone runs (`purpose: self-plan`) give today. A
  reject is not a stall, but one rule everywhere is simpler and a planning run
  has no reason to be refused a command its build run would be allowed.

The human's settings files are never written: decision 2 is met by answering
the asks their rules raise, not by removing the rules.

Codex: codex-acp asks through `session/request_permission` the same way, so
the same handler answers it. Sandbox Codex workers keep the policy and
auto-review the human chose (`interactive-workers` decision 11); their MCP
asks (`is_mcp_tool_approval`) are allowed like any other.

Host-side Codex sessions (a Codex lead, orchestrator or host worker) are meant
to run with approvals off: runcastle writes `approval_policy="never"` to their
Codex config. But their launch names no session mode, so codex-acp likely
opens them in its default `agent` mode (on-request approvals with auto review),
and that mode is sent with every turn, over the config. The launch sets the
session mode that matches the config (no approvals, full access), so these
sessions stop asking at the source; the handler covers anything left. Verify
the default-mode behaviour in the reproduction before relying on it.

Deny paths are untouched: the lead worktree guard and burn guard are hooks
that deny before any permission request, and auto mode's checker blocks are
denies the worker explains in its chat.

### The dialog leaves the app

With no producer, the `approval` ask kind goes from the live path:

- the web chat's approval dock and the phone view's approval card, and their
  design-page states;
- the server's approval-answer path and the "needs you" reason built from an
  approval ask;
- the core ask union keeps parsing old `approval` entries in existing thread
  logs, so history still replays, but nothing writes a new one. An approval ask
  left open in an old log (a server that died mid-ask) reads as resolved.

### Root and bypass

Runcastle applies bypass mode with a mode switch after the session opens,
skipped when the adapter does not offer bypass, and a resumed session starts
in its transcript's last mode until then. The handler makes all of that, and
an unavailable bypass mode, harmless, at the cost of one
local round-trip per action. The launch also logs, once per session, when the
adapter reports a mode other than the one asked for, so a root install shows
up in the server log. Setting `IS_SANDBOX` to win bypass back as root is not
done: it changes Claude Code's behaviour in other ways.

## Seams

- **Existing: the thread host's permission handler**, driven by a fake ACP
  agent the way host tests already drive sessions. Feed it permission
  requests of each shape (safety-check Bash, a request with `matchedAskRule`,
  a plan-exit request, a Codex MCP approval, a worker in fallback mode, a
  self-plan session) and observe the response option and that no ask was
  opened. The one seam that proves the feature.
- **Existing: the thread log.** After any session, no `ask` entry of kind
  `approval` exists; a `permission_allowed` record does.
- **New, by hand: a real reproduction.** Start a lead from the branch's own
  server (drive machinery runs the installed version, so hand-start it) and
  have it run a heredoc Python edit, a `git push` with the human's ask rule in
  place, and a delete Claude Code flags; then start one as root without
  `IS_SANDBOX`. None stops; each shows a `permission_allowed` record. Same for
  one Codex worker.

## Out of scope

- An agent's own questions (`AskUserQuestion`) and MCP elicitations: still
  asks (decision 5).
- Guards that deny, and auto mode's checker blocks: unchanged.
- The human's own Claude Code outside runcastle and their settings files.
- Any new notification, escalation or approval log screen (decision 3).

## Open questions

- Which exact safety check raised each logged ask; the reproduction records
  the `decisionReason` it sees, but the fix does not depend on it.
- Whether the other PC ran as root; the fix covers it either way.
