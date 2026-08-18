/**
 * The burn guard — a `PreToolUse` hook installed inside each burn sandbox, which
 * DENIES a small set of tool calls the burner prompt already forbids.
 *
 * Why a hook and not more prompt text: the prompt has told agents to "run any
 * full suite once" since before the performance work, and measurement showed
 * them running the same suite five, six and seven times inside a single ticket.
 * Prompt rules are advisory; a `PreToolUse` deny is not. Verified against the
 * Claude Code docs: PreToolUse hooks "fire before any permission-mode check and
 * can enforce policies by returning deny, even in bypassPermissions mode" —
 * which is the mode sandcastle runs AFK agents in, so this is the only layer
 * that binds. Hooks can only TIGHTEN, never loosen, so the guard cannot
 * accidentally grant an agent anything.
 *
 * Both runtimes get the same guard. Codex's hook protocol is Claude-shaped —
 * same `tool_name`/`tool_input` stdin payload, same
 * `hookSpecificOutput.permissionDecision: "deny"` verdict on exit 0 (verified
 * against codex-rs `hooks/src/events/pre_tool_use.rs`) — so the SCRIPT is
 * literally the same file; only where it is installed and which config file
 * registers it differ. One rule set, rendered twice.
 *
 * Scope discipline: every rule here is one an agent cannot reasonably need. A
 * false deny in an unattended agent is expensive — it burns turns arguing with
 * a wall — so "re-running a full suite" is deliberately NOT a rule (the prompt
 * explicitly permits a second run after a fix, and the guard cannot tell the
 * two apart). Kill switch: `burnGuard: false`.
 */

import type { AgentRuntime } from '@runcastle/core'

/** A single guard rule: an ERE pattern, and what to tell the agent instead. */
export interface GuardRule {
  readonly id: string
  /** POSIX ERE — used verbatim by `grep -E` in the container AND by the tests. */
  readonly pattern: string
  /** Shown to the agent as `permissionDecisionReason`; must name the alternative. */
  readonly reason: string
}

/**
 * The rules. Each pattern is written in POSIX ERE so the exact same string can
 * drive `grep -E` inside the sandbox and `new RegExp` in the unit tests — there
 * is no second transcription to drift.
 */
/**
 * Command position: start of line, or just after a separator. Without this,
 * `grep -rn "git stash" docs/` is denied — searching for a string is not
 * running it. Caught by running the generated script in a real container.
 */
const CMD_START = '(^|[;&|(]|&&)[[:space:]]*'

export const GUARD_RULES: readonly GuardRule[] = [
  {
    id: 'no-stash',
    pattern: `${CMD_START}git[[:space:]]+stash`,
    reason:
      'git stash is blocked in burns: stashed work is invisible to the orchestrator and unrecoverable if this process dies, and only commits survive. To compare against the pre-change state use `git show HEAD:<path>`, or the pre-existing-failure baseline in your prompt.',
  },
  {
    id: 'no-serialised-tests',
    // vitest/jest concurrency overrides. Safe to deny anywhere: no other tool
    // in a JS repo takes these flags.
    pattern: '--maxWorkers|--runInBand|--pool=|--shard=|singleFork|--poolOptions',
    reason:
      'Do not override the test runner\'s concurrency. Measured in this sandbox, a suite that runs in ~55s at its configured concurrency takes 10-20 minutes serialised, so this "safe" flag is the single most expensive habit in a burn. Run the repo\'s test command as configured. If it is killed for memory, run only the test files your change touches and say so in your final message.',
  },
  {
    id: 'no-interpreter-heredoc-edit',
    // `python3 - <<'PY' … PY` and friends: rewriting a file through an
    // interpreter. Deliberately does NOT match `git commit -F - <<'EOF'`, which
    // the burner's own commit convention uses.
    pattern: `${CMD_START}(python3?|node|bun|perl|ruby)[[:space:]]+-[[:space:]]*<<`,
    reason:
      'Do not rewrite files by piping a heredoc into an interpreter — individual such calls have been measured at 29s, 57s, 120s and 761s, and a half-written file survives if this process dies mid-command. Use the Edit tool, which is faster, atomic, and fails loudly when its target text is not found.',
  },
  {
    id: 'no-cat-heredoc-edit',
    pattern: `${CMD_START}cat[[:space:]]+>>?[[:space:]]*[^[:space:]|]+[[:space:]]*<<`,
    reason:
      'Do not write files with `cat > file <<EOF`. Use the Write tool for a new file, or Edit to change part of an existing one.',
  },
]

/**
 * Where each runtime's guard lives inside the container. Every runtime reads its
 * hooks out of its own home, so the twin is a matter of paths and one config
 * shape — never a second copy of the rules.
 */
export const GUARD_INSTALL_PATHS: Record<AgentRuntime, { script: string; config: string }> = {
  'claude-code': {
    script: '$HOME/.claude/hooks/burn-guard.sh',
    config: '$HOME/.claude/settings.json',
  },
  codex: {
    script: '$HOME/.codex/hooks/burn-guard.sh',
    config: '$HOME/.codex/hooks.json',
  },
}

/** The container path the Claude Code guard script is installed at. */
export const GUARD_SCRIPT_PATH = GUARD_INSTALL_PATHS['claude-code'].script
/** The container path of the settings file that registers the Claude Code hook. */
export const GUARD_SETTINGS_PATH = GUARD_INSTALL_PATHS['claude-code'].config

/**
 * Evaluate a Bash command against the rules — the same decision the in-sandbox
 * script makes, available to tests and callers without a container.
 * `null` means allowed.
 */
export function evaluateGuard(command: string): GuardRule | null {
  // Mirrors the script's `sed`: blank quoted spans before matching.
  const stripped = command.replace(/'[^']*'/g, ' ').replace(/"[^"]*"/g, ' ')
  for (const rule of GUARD_RULES) {
    // ERE is a subset of JS regex for the constructs used here; POSIX classes
    // are the one exception, so they are expanded for the JS engine.
    const js = rule.pattern
      .replace(/\[\[:space:\]\]/g, '[ \\t\\n]')
      .replace(/\[:space:\]/g, ' \\t\\n')
    if (new RegExp(js).test(stripped)) return rule
  }
  return null
}

/**
 * The guard script, as POSIX `sh`. Reads the hook payload on stdin, pulls the
 * Bash command out with `jq` (present in the burner image), and emits the
 * verified deny shape on a match. Anything else — a non-Bash tool, a missing
 * `jq`, malformed JSON — prints nothing and exits 0, which Claude Code reads as
 * "allow": the guard must never be able to wedge a burn.
 */
export function renderGuardScript(rules: readonly GuardRule[] = GUARD_RULES): string {
  const lines = [
    '#!/bin/sh',
    '# runcastle burn guard (PreToolUse). Generated — edit burn-guard.ts, not this.',
    'set -u',
    'payload=$(cat 2>/dev/null || true)',
    '[ -n "$payload" ] || exit 0',
    'command -v jq >/dev/null 2>&1 || exit 0',
    'tool=$(printf %s "$payload" | jq -r ".tool_name // empty" 2>/dev/null || true)',
    '[ "$tool" = "Bash" ] || exit 0',
    'cmd=$(printf %s "$payload" | jq -r ".tool_input.command // empty" 2>/dev/null || true)',
    '[ -n "$cmd" ] || exit 0',
    '',
    '# Match against the command with quoted spans blanked, so an argument is',
    '# never read as a command: `grep -rn "git stash" docs/` searches for a',
    '# string, it does not run one.',
    `cmd=$(printf %s "$cmd" | sed "s/'[^']*'/ /g; s/\\"[^\\"]*\\"/ /g")`,
    '',
    'deny() {',
    '  printf %s "$1" | jq -R -s \'{hookSpecificOutput:{hookEventName:"PreToolUse",permissionDecision:"deny",permissionDecisionReason:.}}\'',
    '  exit 0',
    '}',
    '',
  ]
  for (const rule of rules) {
    lines.push(
      `# ${rule.id}`,
      // `--` ends grep's option parsing: a pattern starting with `--` (the
      // test-concurrency flags) is otherwise read as an unknown flag and the
      // rule silently never fires. Found by running this in a container.
      `if printf %s "$cmd" | grep -Eq -- ${shSingleQuote(rule.pattern)}; then`,
      `  deny ${shSingleQuote(rule.reason)}`,
      'fi',
      '',
    )
  }
  lines.push('exit 0', '')
  return lines.join('\n')
}

/** Wrap a value in single quotes for `sh`, escaping any embedded quote. */
function shSingleQuote(value: string): string {
  return `'${value.split("'").join(`'\\''`)}'`
}

/** The hook registration both runtimes take — same shape, different matcher dialect. */
export interface GuardHookConfig {
  hooks: {
    PreToolUse: Array<{
      matcher: string
      hooks: Array<{ type: 'command'; command: string; timeout: number }>
    }>
  }
}

/**
 * How each runtime spells "every Bash tool call". Claude Code matches tool names
 * literally; Codex treats the matcher as a regex (its own fixtures use `^Bash$`).
 */
const GUARD_MATCHER: Record<AgentRuntime, string> = {
  'claude-code': 'Bash',
  codex: '^Bash$',
}

/**
 * The config registering the guard for every Bash call. Claude Code reads this
 * as `settings.json`, Codex as `hooks.json` — the object is the same either way,
 * which is why the twin costs a path and a matcher rather than a second format.
 */
export function renderGuardSettings(runtime: AgentRuntime = 'claude-code'): GuardHookConfig {
  return {
    hooks: {
      PreToolUse: [
        {
          matcher: GUARD_MATCHER[runtime],
          // 5s is far more than a few greps need; the script exits 0 on any
          // internal failure, so a timeout can only ever fail open.
          hooks: [
            { type: 'command', command: `sh ${GUARD_INSTALL_PATHS[runtime].script}`, timeout: 5 },
          ],
        },
      ],
    },
  }
}

/**
 * The shell that installs the guard inside the sandbox, for chaining into the
 * `onSandboxReady` hook. Both files are delivered base64-encoded so no amount
 * of quoting in a rule's pattern or reason can break the setup command.
 *
 * Installed for the runtime the burn is about to launch, into that runtime's
 * home. Container sandboxes ONLY — see the caller. On `noSandbox` this would
 * write over the human's real `~/.claude/settings.json` or `~/.codex/hooks.json`.
 *
 * Codex additionally ignores hooks it has no persisted trust for, so the burn
 * passes `--dangerously-bypass-hook-trust` alongside this — writing the file is
 * necessary but not sufficient there (see `BurnAgentOptions.bypassHookTrust`).
 */
export function buildGuardInstallCommand(runtime: AgentRuntime = 'claude-code'): string {
  const paths = GUARD_INSTALL_PATHS[runtime]
  const script = Buffer.from(renderGuardScript(), 'utf8').toString('base64')
  const settings = Buffer.from(
    JSON.stringify(renderGuardSettings(runtime), null, 2),
    'utf8',
  ).toString('base64')
  return [
    `mkdir -p "${posixDirname(paths.script)}" "${posixDirname(paths.config)}"`,
    `printf %s '${script}' | base64 -d > "${paths.script}"`,
    `chmod +x "${paths.script}"`,
    `printf %s '${settings}' | base64 -d > "${paths.config}"`,
  ].join(' && ')
}

/**
 * The directory part of a container path. Deliberately NOT `node:path` — these
 * are always-POSIX container paths carrying an unexpanded `$HOME`, and on a
 * Windows host `dirname` would hand back backslashes for the sandbox's `sh`.
 */
function posixDirname(path: string): string {
  return path.slice(0, path.lastIndexOf('/'))
}
