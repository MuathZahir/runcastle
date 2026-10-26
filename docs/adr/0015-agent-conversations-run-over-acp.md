# ADR-0015: Agent conversations run over ACP, rendered by runcastle

- **Status:** accepted (2026-10-26)
- **Deciders:** Muath + the `chat-as-web-components` feature session
- **Supersedes, for agent conversations:** ADR-0009 (the opening briefing rides
  the CLI's argv and nothing is ever typed into a terminal)
- **Charter:** reverses `CONTEXT.md` #3 ("the app never rebuilds the chat UX")
  and narrows #13 (server-owned PTYs streamed to xterm); the project session
  amends the charter

## Context

Every conversation with an agent was the Claude Code or Codex CLI in a
server-owned PTY, streamed to an xterm view. Runcastle reached a running
conversation only through the side channels the terminal left it. The opening
briefing rode argv (ADR-0009), and later messages went through Claude's
asyncRewake hook or `codex queue`. Liveness, turn state and the conversation id
came from SessionStart, Stop and SessionEnd hooks. A conversation with no
terminal open ran as a separate headless process (`-p` / `exec`).

Opening a terminal costs a CLI start, which is why the app grew Resume screens,
auto-resume and "hasn't checked in yet" notices. Past conversations could be
read back but not continued in place.

Both CLIs speak the Agent Client Protocol through official adapters
(`@agentclientprotocol/claude-agent-acp`, built on the Agent SDK, and
`@agentclientprotocol/codex-acp`, built on `codex app-server`). These are the
adapters that Zed, JetBrains and VS Code clients use.

## Decision

1. **Agent conversations are ACP sessions owned by the server.** Each running
   thread is an adapter child process speaking ACP over stdio. The adapter runs
   the human's installed CLI (`CLAUDE_CODE_EXECUTABLE`, `CODEX_PATH`). The
   per-session briefing files are unchanged: settings with hooks and guards, the
   MCP config, the plugin dir and the system prompt (and Codex's per-session
   home). They reach the CLI through the adapter's session options.
2. **Runcastle renders the conversation.** ACP session updates become thread
   events in a log runcastle owns. A pure reducer in core folds them into what
   the web shows, so a thread opens from its log with no process running.
3. **Everything runcastle says to an agent is a prompt.** The kickoff is a
   thread's first prompt. Lead wakes, orchestrator lines and kickoff overrides
   are prompts queued to the turn's end. The headless lead path, the asyncRewake
   waiter and `codex queue` delivery are retired.
4. **Processes are lazy and invisible.** A thread's process starts on its first
   prompt and stops after 30 idle minutes, never while the agent waits on the
   human.
5. **PTYs remain for program output.** Dev-server panes, the design server's
   output and the Settings flows (`setup-token`, sign-in, image build) stay
   terminals.

## Consequences

- Hooks stop being the source of liveness and turn state. They remain for the
  PreToolUse guards and the UserPromptSubmit status line.
- Delivery is now observable: a prompt either reaches the ACP session or fails
  with the adapter's error. ADR-0009's "nothing confirms delivery" no longer
  applies to conversations.
- Two pinned dependencies we do not own sit between runcastle and each CLI. A
  doctor probe reports an installed CLI older than its adapter needs.
- One extra process runs per live thread, on top of the CLI itself.
