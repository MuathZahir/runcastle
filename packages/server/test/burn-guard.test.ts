import { describe, expect, it } from 'vitest'
import {
  GUARD_RULES,
  GUARD_SCRIPT_PATH,
  buildGuardInstallCommand,
  evaluateGuard,
  renderGuardScript,
  renderGuardSettings,
} from '../src/workflows/burn-guard'

/**
 * `evaluateGuard` is the JS mirror of the `sh` script the sandbox actually
 * runs; both read the SAME pattern strings out of `GUARD_RULES`, so these cases
 * are the contract for both. Every expectation here was also executed against
 * the generated script in a real `node:22-bookworm` container with real `jq`
 * and real `grep -E` — which is where the two original bugs came from (a
 * pattern starting with `--` was eaten by grep's option parser, and a quoted
 * argument was read as a command).
 */
describe('burn guard rules', () => {
  const denied = (cmd: string) => evaluateGuard(cmd)?.id ?? null

  describe('git stash — only commits survive a burn', () => {
    it('denies a stash, wherever it sits in a chain', () => {
      expect(denied('git stash -u')).toBe('no-stash')
      expect(denied('cd /repo && git stash -u && pnpm test')).toBe('no-stash')
      expect(denied('git stash push -m wip; pnpm test')).toBe('no-stash')
    })

    it('allows searching for the string — an argument is not a command', () => {
      expect(denied('grep -rn "git stash" docs/')).toBeNull()
      expect(denied("rg 'git stash' --files-with-matches")).toBeNull()
    })

    it('allows other git verbs', () => {
      expect(denied('git add -A && git commit -m x')).toBeNull()
      expect(denied('git show HEAD:src/a.ts')).toBeNull()
    })
  })

  describe('test-runner concurrency overrides', () => {
    it('denies every flag that serialises a suite', () => {
      for (const cmd of [
        'pnpm vitest run --maxWorkers=2 src/',
        'npx vitest --shard=1/4',
        'pnpm jest --runInBand',
        'npx vitest --pool=forks',
        'npx vitest --poolOptions.forks.singleFork',
      ]) {
        expect(denied(cmd), cmd).toBe('no-serialised-tests')
      }
    })

    it('allows the repo test command as configured', () => {
      expect(denied('pnpm --filter web test')).toBeNull()
      expect(denied('pnpm test > /tmp/t.log 2>&1')).toBeNull()
      // Narrowing to the touched files is the sanctioned fallback under memory
      // pressure, and must stay allowed.
      expect(denied('pnpm vitest run src/features/a src/features/b')).toBeNull()
    })
  })

  describe('file edits through the shell', () => {
    it('denies rewriting a file through an interpreter heredoc', () => {
      expect(denied("cd /repo && python3 - <<'PY'\nopen('a','w')\nPY")).toBe(
        'no-interpreter-heredoc-edit',
      )
      expect(denied("node - <<'JS'\nx\nJS")).toBe('no-interpreter-heredoc-edit')
    })

    it('denies `cat > file <<EOF`', () => {
      expect(denied("cat > src/a.ts <<'EOF'\nx\nEOF")).toBe('no-cat-heredoc-edit')
      expect(denied("cat >> src/a.ts <<'EOF'\nx\nEOF")).toBe('no-cat-heredoc-edit')
    })

    it('allows the commit-message heredoc the burner prompt itself mandates', () => {
      // `git commit -F - <<'EOF'` is the documented commit convention; denying
      // it would block the one thing the guard exists to protect.
      expect(denied("git add -A && git commit -q -F - <<'EOF'\nticket(6): x\nEOF")).toBeNull()
    })

    it('allows reading and piping', () => {
      expect(denied('cat src/a.ts')).toBeNull()
      expect(denied('cat /tmp/test-run.log | grep -E "Tests"')).toBeNull()
    })
  })
})

describe('guard script generation', () => {
  it('ends grep option parsing so a `--` pattern still matches', () => {
    // Regression: without `--`, grep read `--maxWorkers|…` as an unknown flag
    // and the rule silently never fired.
    expect(renderGuardScript()).toContain('grep -Eq -- ')
  })

  it('blanks quoted spans before matching', () => {
    expect(renderGuardScript()).toMatch(/sed "s\/'\[\^'\]\*'\//)
  })

  it('fails open at every step — a guard must never wedge a burn', () => {
    const script = renderGuardScript()
    expect(script).toContain('command -v jq >/dev/null 2>&1 || exit 0') // no jq → allow
    expect(script).toContain('[ "$tool" = "Bash" ] || exit 0') // other tools → allow
    expect(script).toContain('[ -n "$payload" ] || exit 0') // no stdin → allow
    expect(script.trimEnd().endsWith('exit 0')).toBe(true) // no rule matched → allow
  })

  it('single-quotes every rule string so no reason or pattern can break the script', () => {
    const script = renderGuardScript([
      { id: 'quoted', pattern: "it's", reason: "don't do that" },
    ])
    expect(script).toContain(`'it'\\''s'`)
    expect(script).toContain(`'don'\\''t do that'`)
  })

  it('registers a PreToolUse hook scoped to Bash', () => {
    const settings = renderGuardSettings()
    const entry = settings.hooks.PreToolUse[0]!
    expect(entry.matcher).toBe('Bash')
    expect(entry.hooks[0]!.command).toBe(`sh ${GUARD_SCRIPT_PATH}`)
  })
})

describe('guard install command', () => {
  it('delivers both files base64-encoded, so rule text can never break the shell', () => {
    const cmd = buildGuardInstallCommand()
    expect(cmd).toContain('mkdir -p "$HOME/.claude/hooks"')
    expect(cmd).toContain('base64 -d')
    // The literal rule text must not leak into the setup command.
    for (const rule of GUARD_RULES) expect(cmd).not.toContain(rule.reason)
  })

  it('round-trips the script through its own base64 payload', () => {
    const cmd = buildGuardInstallCommand()
    const encoded = /printf %s '([A-Za-z0-9+/=]+)' \| base64 -d > "\$HOME\/\.claude\/hooks/.exec(cmd)
    expect(encoded).not.toBeNull()
    expect(Buffer.from(encoded![1]!, 'base64').toString('utf8')).toBe(renderGuardScript())
  })
})
