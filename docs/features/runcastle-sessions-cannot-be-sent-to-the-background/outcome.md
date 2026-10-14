# Outcome — Runcastle sessions cannot be sent to the background

Every Claude Code session runcastle launches is started with CLAUDE_CODE_DISABLE_AGENT_VIEW=1 in its environment, added to the env the Claude runtime adapter already returns (packages/server/src/launcher/runtimes/claude.ts, beside RUNCASTLE_SESSION_ID / RUNCASTLE_SERVER_URL). Why: Claude Code 2.1.x moves a conversation into a background session when the user presses the left arrow (it opens the agents view); pressing right to go back does not reattach it. When the embedded PTY then goes away, the conversation keeps running under Claude Code's background supervisor, and the next `claude --resume <id>` for that feature (e.g. Start lap from review, reopening the chat) is refused with: "Session <id> is running as a background session (<short>). Run `claude attach <short>` to open it, or `claude stop <short>` first to resume it here. Add --fork-session to branch off a copy instead." The terminal dies and every retry fails the same way. Per Claude Code's docs (code.claude.com/docs/en/agent-view, /en/env-vars), CLAUDE_CODE_DISABLE_AGENT_VIEW=1 turns off background agents and agent view entirely: `claude agents`, `--bg`, `/background` and the left-arrow backgrounding. It is equivalent to the `disableAgentView` setting; use the env var, since it does not depend on how the per-session --settings file merges. It must apply only to the processes runcastle spawns (interactive terminals and headless self-planning runs), never to the human's own config. Cover it with a unit test on the adapter's returned env.

- Shipped: 2026-10-14
- Laps run: 1

## What shipped

9 commits · 9 files

### Lap 1
- 5 tickets landed: #1 Every Claude Code session runcastle launches is started with…; #2 When a Claude Code `--resume` launch dies before going live because its…; #4 Short id is guessed from sessionId.slice(0, 8) although the agents listing gives it outright as `id` on background entries; #5 The new two-command way-out message shows in a banner that auto-dismisses after 8 seconds; #6 listClaudeAgents re-implements the shared createSystemExec runner, with a weaker timeout kill
- 0 waived
- 0 failed

## Review record

### Lap 1 · review

- Reviewed commit: c254fd601f70d9155f737120f8d6c79569b2358a
- Landed since: 3
- Outcome: done

### Lap 1 · verification

- Reviewed commit: c4b5463033db7bc778380a972aa96d317df3ed03
- Landed since: 0
- Outcome: done

- No findings

## Notes record

- No human notes

## Per-ticket digests

### Lap 1

#### 6. listClaudeAgents re-implements the shared createSystemExec runner, with a weaker timeout kill

## What was done
`listClaudeAgents` in packages/server/src/launcher/runtimes/claude.ts used its own spawn, settle-once logic and timer. It now runs `claude agents --json` through the shared `createSystemExec({ timeoutMs: 10_000 })` and parses the stdout. If the command doesn't run, times out or prints something that isn't JSON, it resolves `undefined`, wrapped in a try/catch, so it still never rejects. On timeout, `createSystemExec` uses Job Object containment or `killProcessTree`, so a hung listing behind a `.cmd` shim is killed along with the rest of its process tree. The probe now takes the command name `claude` instead of the resolved path, because `createSystemExec` calls `resolveTool` itself, and that honours `RUNCASTLE_CLAUDE_BIN` the same way `resolveBinary()` did. The `node:child_process` and `spawnTargetFor` imports were dropped from claude.ts.

## Surprises
None. I re-ran the reviewer's repro on the ticket branch (`grep -n "child?.kill()"` on claude.ts) and it matches nothing (grep exit 1). The `killProcessTree` grep on system-exec.ts still shows lines 3 and 67, so the probe now relies on that code.

## Left undone
- The short id is still `ccSessionId.slice(0, 8)` instead of the `id` field that the review found on background entries. That is a separate review finding.
- Banner duration: also a separate finding, not touched here.
- Drive machinery: no new service, env var or seed, so nothing to change there.

Gates: `bun run typecheck` was clean. `env -u GIT_ASKPASS bun run test` exited 0: 317 files passed (2 skipped), 4514 tests passed, 46 skipped.
