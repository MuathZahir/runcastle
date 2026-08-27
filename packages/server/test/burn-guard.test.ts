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

  describe('long sleeps and verification polling', () => {
    it('denies sleep durations above 30 seconds', () => {
      expect(denied('sleep 31')).toBe('no-long-sleep')
      expect(denied('cd /repo && sleep 120 && bun test')).toBe('no-long-sleep')
      expect(denied('sleep 31s')).toBe('no-long-sleep')
      expect(denied('sleep 1m')).toBe('no-long-sleep')
    })

    it('allows short sleeps', () => {
      expect(denied('sleep 5')).toBeNull()
      expect(denied('sleep 30')).toBeNull()
    })

    it('denies until and while loops that poll verification commands', () => {
      expect(denied('until bun run typecheck; do sleep 20; done')).toBe(
        'no-verification-polling-loop',
      )
      expect(denied('while ! pnpm test; do sleep 5; done')).toBe(
        'no-verification-polling-loop',
      )
      expect(denied('while true; do\n  bun vitest run\n  sleep 5\ndone')).toBe(
        'no-verification-polling-loop',
      )
      expect(denied('until turbo run test; do echo waiting; done')).toBe(
        'no-verification-polling-loop',
      )
      expect(denied('while bun test; do echo retrying; done')).toBe(
        'no-verification-polling-loop',
      )
    })

    it('allows a while-read loop over a file', () => {
      expect(denied('while read -r line; do echo "$line"; done < file.txt')).toBeNull()
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

    it('denies interpreter one-liners used to edit files', () => {
      expect(denied(`node -e "const fs = require('fs'); fs.writeFileSync('a', 'x')"`)).toBe(
        'no-interpreter-inline-edit',
      )
      expect(denied("perl -0pi -e 's/old/new/g' src/a.ts")).toBe('no-perl-in-place-edit')
      expect(denied("perl -i -pe 's/old/new/g' src/a.ts")).toBe('no-perl-in-place-edit')
    })

    it('denies multi-range sed in-place surgery', () => {
      expect(denied("sed -i '10,20d;30,40d' src/a.ts")).toBe('no-sed-multi-range-edit')
      expect(denied("cd /repo && sed -i.bak '/start/,/end/d;/left/,/right/d' src/a.ts")).toBe(
        'no-sed-multi-range-edit',
      )
    })

    it('allows non-editing interpreter and sed commands', () => {
      expect(denied('node script.js')).toBeNull()
      expect(denied("perl -e 'print 1'")).toBeNull()
      expect(denied("sed -n '10,20p' src/a.ts")).toBeNull()
      expect(denied("while read line; do printf '%s\\n' \"$line\"; done < src/a.ts")).toBeNull()
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

/**
 * A codex burn must be guarded exactly as tightly as a claude one — same rules,
 * same reasons — installed into the home codex actually reads. Codex's hook
 * protocol is Claude-shaped (same stdin payload, same deny verdict), so the twin
 * is the same script under a different path plus a `hooks.json` instead of a
 * `settings.json`; the rules themselves are never transcribed twice.
 */
describe('the codex guard twin', () => {
  it('installs the SAME script, under the codex home', () => {
    const cmd = buildGuardInstallCommand('codex')
    expect(cmd).toContain('mkdir -p "$HOME/.codex/hooks"')
    expect(cmd).toContain('> "$HOME/.codex/hooks/burn-guard.sh"')
    expect(cmd).toContain('> "$HOME/.codex/hooks.json"')
    expect(cmd).not.toContain('.claude')

    const encoded = /printf %s '([A-Za-z0-9+/=]+)' \| base64 -d > "\$HOME\/\.codex\/hooks\//.exec(cmd)
    expect(encoded).not.toBeNull()
    // Byte-identical to Claude's: one script, two installs.
    expect(Buffer.from(encoded![1]!, 'base64').toString('utf8')).toBe(renderGuardScript())
  })

  it('registers PreToolUse in codex hooks.json, matching Bash as a regex', () => {
    const hooks = renderGuardSettings('codex')
    const entry = hooks.hooks.PreToolUse[0]!
    expect(entry.matcher).toBe('^Bash$')
    expect(entry.hooks[0]!.command).toBe('sh $HOME/.codex/hooks/burn-guard.sh')
    expect(entry.hooks[0]!.type).toBe('command')
  })

  it('carries every rule — pattern and reason — into both renderings', () => {
    /** The guard script as it actually lands inside the container. */
    const installedScript = (runtime: 'claude-code' | 'codex'): string => {
      const cmd = buildGuardInstallCommand(runtime)
      const encoded = /printf %s '([A-Za-z0-9+/=]+)' \| base64 -d > "[^"]*burn-guard\.sh"/.exec(cmd)
      expect(encoded, `no script payload in the ${runtime} install`).not.toBeNull()
      return Buffer.from(encoded![1]!, 'base64').toString('utf8')
    }

    for (const script of [installedScript('claude-code'), installedScript('codex')]) {
      for (const rule of GUARD_RULES) {
        expect(script).toContain(rule.pattern)
        // As the script quotes it: reasons contain apostrophes, which `sh`
        // single-quoting escapes as '\''.
        expect(script).toContain(rule.reason.split("'").join(`'\\''`))
      }
      // Both emit the one deny verdict claude AND codex understand — same
      // hookSpecificOutput shape on exit 0 (verified against codex-rs).
      expect(script).toContain('permissionDecision:"deny"')
      expect(script).toContain('hookEventName:"PreToolUse"')
    }
  })

  it('denies the same commands whichever runtime is burning', () => {
    // The decision is the rule set's, not the rendering's — one evaluator backs
    // both installs, so a command denied for claude is denied for codex.
    for (const command of [
      'git stash',
      'bun test --maxWorkers=1',
      "python3 - <<'PY'",
      "cat > src/index.ts <<'EOF'",
    ]) {
      expect(evaluateGuard(command), `${command} must be denied`).not.toBeNull()
    }
  })
})
