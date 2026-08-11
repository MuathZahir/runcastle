import type { AgentStreamEvent } from '@ai-hero/sandcastle'
import type { Feature, Ticket } from '@runcastle/core'
import { describe, expect, it } from 'vitest'
import {
  ISOLATED_REPO_PATH,
  SANDBOX_WORKSPACE_PATH,
  buildConflictFilesBlock,
  buildDocsDigest,
  buildFeatureBrief,
  buildIsolatedSetupCommand,
  buildOtherSideBlock,
  buildSandboxOptions,
  buildTicketJson,
  buildVerifyNotes,
  buildWorkspaceNotes,
  cacheMountFor,
  classifyTicketRunError,
  classifyToolCall,
  createToolTimer,
  formatTimingSummary,
  createSerialQueue,
  createStreamThrottle,
  detectCycle,
  detectPackageManager,
  indexBySeq,
  interpretRunResult,
  isMergeConflictError,
  isWorktreeTeardownError,
  landWithResolve,
  parseEnvFile,
  renderTemplate,
  renderTicketPrompt,
  resolveBurnWorkspaceMode,
  resolveMergeCommand,
  resolveSetupCommand,
  selectSandbox,
} from '../src/workflows/ticket-burner'
import type {
  LandDeps,
  RepoToolchain,
  ResolveAttemptResult,
} from '../src/workflows/ticket-burner'
import type { TempBranchMergeResult } from '../src/services/git'
import { DEFAULT_SANDBOX_IMAGE, type RuncastleConfig } from '@runcastle/core'

function ticket(seq: number, blockedBy: number[] = [], overrides: Partial<Ticket> = {}): Ticket {
  return {
    id: `tkt_${seq}`,
    featureId: 'feat_1',
    seq,
    title: `Ticket ${seq}`,
    goal: `goal ${seq}`,
    context: `context ${seq}`,
    acceptanceCriteria: [`criterion ${seq}`],
    seams: [`seam ${seq}`],
    blockedBy,
    status: 'pending',
    commits: [],
    ...overrides,
  }
}

const feature: Feature = {
  id: 'feat_1',
  projectId: 'proj_1',
  slug: 'my-feature',
  title: 'My Feature',
  oneLiner: 'does a thing',
  mapped: false,
  phase: 'implementation',
  branch: 'feature/my-feature',
  status: 'active',
  createdAt: 0,
}

function textEvent(message: string, iteration = 0): AgentStreamEvent {
  return { type: 'text', message, iteration, timestamp: new Date() }
}
function toolEvent(name: string, formattedArgs: string, iteration = 0): AgentStreamEvent {
  return { type: 'toolCall', name, formattedArgs, iteration, timestamp: new Date() }
}

describe('indexBySeq (seq→ticket resolution)', () => {
  it('resolves each global seq to its ticket, and blockers via the index', () => {
    const tickets = [ticket(1), ticket(2, [1]), ticket(3, [1, 2])]
    const bySeq = indexBySeq(tickets)
    expect(bySeq.get(2)?.id).toBe('tkt_2')
    expect(tickets[2].blockedBy.map((s) => bySeq.get(s)?.id)).toEqual(['tkt_1', 'tkt_2'])
    expect(bySeq.get(99)).toBeUndefined()
  })
})

describe('detectCycle', () => {
  it('returns null for an acyclic graph', () => {
    expect(detectCycle([ticket(1), ticket(2, [1]), ticket(3, [1, 2])])).toBeNull()
  })

  it('detects a 2-cycle', () => {
    const cycle = detectCycle([ticket(1, [2]), ticket(2, [1])])
    expect(cycle).not.toBeNull()
    expect(new Set(cycle)).toEqual(new Set([1, 2]))
  })

  it('detects a 3-cycle', () => {
    const cycle = detectCycle([ticket(1, [3]), ticket(2, [1]), ticket(3, [2])])
    expect(cycle).not.toBeNull()
    expect(new Set(cycle)).toEqual(new Set([1, 2, 3]))
  })

  it('ignores edges to seqs outside the ticket set', () => {
    expect(detectCycle([ticket(1, [99]), ticket(2, [1])])).toBeNull()
  })
})

describe('renderTicketPrompt', () => {
  const template = [
    '# Ticket',
    '```json',
    '{{TICKET_JSON}}',
    '```',
    '## Brief',
    '{{FEATURE_BRIEF}}',
    '## Docs',
    '{{DOCS_DIGEST}}',
    'Commit: `{{COMMIT_CONVENTION}}`',
    'Work: {{WORKSPACE_NOTES}}',
    'Verify: {{VERIFY_NOTES}}',
  ].join('\n')

  it('replaces every placeholder and leaves no stray {{ }}', () => {
    const out = renderTicketPrompt(template, {
      TICKET_JSON: buildTicketJson(ticket(4)),
      FEATURE_BRIEF: buildFeatureBrief(feature),
      DOCS_DIGEST: buildDocsDigest([{ name: 'spec.md', content: '# Spec\nbody' }]),
      COMMIT_CONVENTION: 'ticket(4): <summary>',
      WORKSPACE_NOTES: buildWorkspaceNotes('mounted'),
      VERIFY_NOTES: buildVerifyNotes({ verifyCommands: 'bun test' }),
    })
    expect(out).not.toContain('{{')
    expect(out).not.toContain('}}')
    expect(out).toContain('"seq": 4')
    expect(out).toContain('My Feature')
    expect(out).toContain('feature/my-feature')
    expect(out).toContain('### spec.md')
    expect(out).toContain('ticket(4): <summary>')
    expect(out).toContain('Work in the current directory')
    expect(out).toContain('bun test')
  })

  it('renders values containing $ and special chars safely', () => {
    const out = renderTicketPrompt('{{TICKET_JSON}}', {
      TICKET_JSON: 'cost is $5 & rising',
      FEATURE_BRIEF: '',
      DOCS_DIGEST: '',
      COMMIT_CONVENTION: '',
      WORKSPACE_NOTES: '',
      VERIFY_NOTES: '',
    })
    expect(out).toBe('cost is $5 & rising')
  })

  it('buildDocsDigest notes when no docs are present', () => {
    expect(buildDocsDigest([])).toMatch(/No feature docs/i)
  })
})

describe('parseEnvFile', () => {
  it('parses KEY=VALUE, skipping comments and blanks, stripping quotes and export', () => {
    const env = parseEnvFile(
      [
        '# a comment',
        '',
        'CLAUDE_CODE_OAUTH_TOKEN=abc123',
        'export QUOTED="hello world"',
        "SINGLE='sq'",
        'WITH_EQUALS=a=b=c',
        '   # indented comment',
        'SPACED = spaced value ',
      ].join('\n'),
    )
    expect(env.CLAUDE_CODE_OAUTH_TOKEN).toBe('abc123')
    expect(env.QUOTED).toBe('hello world')
    expect(env.SINGLE).toBe('sq')
    expect(env.WITH_EQUALS).toBe('a=b=c')
    expect(env.SPACED).toBe('spaced value')
  })

  it('ignores lines without an =', () => {
    expect(parseEnvFile('JUST_A_KEY\n=novalue')).toEqual({})
  })
})

describe('createStreamThrottle', () => {
  it('buffers text under the thresholds and flushes on demand', () => {
    const emitted: { type: string; message: string }[] = []
    const th = createStreamThrottle((e) => emitted.push(e), { now: () => 1000 })
    th.onEvent(textEvent('aa'))
    th.onEvent(textEvent('bb'))
    expect(emitted).toHaveLength(0)
    th.flush()
    expect(emitted).toHaveLength(1)
    expect(emitted[0]).toMatchObject({ type: 'burn.text', message: 'aabb' })
  })

  it('flushes text once it exceeds maxChars', () => {
    const emitted: { type: string; message: string }[] = []
    const th = createStreamThrottle((e) => emitted.push(e), { maxChars: 5, now: () => 0 })
    th.onEvent(textEvent('123456'))
    expect(emitted).toHaveLength(1)
    expect(emitted[0].message).toBe('123456')
  })

  it('flushes text after the interval elapses', () => {
    const emitted: { type: string; message: string }[] = []
    let t = 0
    const th = createStreamThrottle((e) => emitted.push(e), { intervalMs: 2000, now: () => t })
    th.onEvent(textEvent('a'))
    expect(emitted).toHaveLength(0)
    t = 2001
    th.onEvent(textEvent('b'))
    expect(emitted).toHaveLength(1)
    expect(emitted[0].message).toBe('ab')
  })

  it('emits a toolCall immediately, flushing pending text first (never per-token)', () => {
    const emitted: { type: string; message: string }[] = []
    const th = createStreamThrottle((e) => emitted.push(e), { now: () => 0 })
    th.onEvent(textEvent('thinking'))
    th.onEvent(toolEvent('Edit', '{"file":"a.ts"}'))
    expect(emitted.map((e) => e.type)).toEqual(['burn.text', 'burn.tool'])
    expect(emitted[1].message).toContain('Edit')
  })
})

describe('interpretRunResult', () => {
  it('marks done when commits landed', () => {
    expect(interpretRunResult({ commits: [{ sha: 'a1' }, { sha: 'b2' }] }, undefined)).toEqual({
      status: 'done',
      commits: ['a1', 'b2'],
    })
  })

  it('marks failed with BLOCKED.md content on zero commits', () => {
    const out = interpretRunResult({ commits: [] }, 'need the API key')
    expect(out.status).toBe('failed')
    expect(out.status === 'failed' && out.error).toContain('need the API key')
  })

  it('marks failed "agent made no commits" on zero commits + no BLOCKED.md', () => {
    expect(interpretRunResult({ commits: [] }, undefined)).toEqual({
      status: 'failed',
      error: 'agent made no commits',
    })
  })
})

describe('isMergeConflictError', () => {
  it('recognises conflict-shaped error messages', () => {
    expect(isMergeConflictError(new Error('CONFLICT (content): merge failed'))).toBe(true)
    expect(isMergeConflictError(new Error('resolve then run: git branch -D sandcastle/x'))).toBe(
      true,
    )
    expect(isMergeConflictError(new Error('Automatic merge failed; fix conflicts'))).toBe(true)
  })

  it('does not flag unrelated errors', () => {
    expect(isMergeConflictError(new Error('image not found locally'))).toBe(false)
    expect(isMergeConflictError('boom')).toBe(false)
  })
})

describe('isWorktreeTeardownError', () => {
  it('recognises sandcastle failing to remove its worktree after the run', () => {
    // The real one, from a Windows burn: git's stderr, verbatim.
    expect(
      isWorktreeTeardownError(
        new Error(
          "error: failed to delete 'C:/Users/me/Projects/helix/.sandcastle/worktrees/runcastle-ticket-make-act-1-more-6-gX46ogOP': Directory not empty",
        ),
      ),
    ).toBe(true)
    expect(
      isWorktreeTeardownError(
        new Error(
          'ENOTEMPTY: directory not empty, rmdir ' +
            'C:\\repo\\.sandcastle\\worktrees\\runcastle-ticket-x-1-abc',
        ),
      ),
    ).toBe(true)
    expect(
      isWorktreeTeardownError(
        new Error("fatal: '/repo/.sandcastle/worktrees/runcastle-ticket-x-1-abc' is not a working tree"),
      ),
    ).toBe(true)
    expect(
      isWorktreeTeardownError(
        new Error('EBUSY: resource busy or locked, unlink /repo/.sandcastle/worktrees/wt-1/node_modules/.bin/x'),
      ),
    ).toBe(true)
  })

  it('needs BOTH the worktree path and a removal failure — never an agent failure', () => {
    // Removal wording without the worktree path: some other dir entirely.
    expect(isWorktreeTeardownError(new Error('ENOTEMPTY: directory not empty, rmdir /tmp/x'))).toBe(
      false,
    )
    // The worktree path without removal wording: a mid-run failure quoting it.
    expect(
      isWorktreeTeardownError(
        new Error('claude-code exited with code 1: cwd /repo/.sandcastle/worktrees/wt-1'),
      ),
    ).toBe(false)
    expect(isWorktreeTeardownError(new Error('authentication_error: unauthorized'))).toBe(false)
    expect(isWorktreeTeardownError('boom')).toBe(false)
    expect(isWorktreeTeardownError(undefined)).toBe(false)
  })

  it('stays FATAL under classifyTicketRunError — so the teardown check must come first', () => {
    // Documents why the burner tests this before classifying: a blind retry
    // would re-run an agent over work that is already committed.
    const err = new Error(
      "error: failed to delete '/repo/.sandcastle/worktrees/wt-1': Directory not empty",
    )
    expect(classifyTicketRunError(err)).toBe('fatal')
    expect(isWorktreeTeardownError(err)).toBe(true)
  })
})

describe('selectSandbox — provider for the configured sandbox', () => {
  const config = (sandbox: RuncastleConfig['sandbox']): RuncastleConfig => ({
    serverPort: 4512,
    model: 'm',
    stepModels: {},
    sandbox,
    mainBranch: 'main',
  })

  it('maps each choice to its sandcastle provider', () => {
    expect(selectSandbox(config('docker')).name).toBe('docker')
    expect(selectSandbox(config('podman')).name).toBe('podman')
    expect(selectSandbox(config('noSandbox')).name).toBe('no-sandbox')
  })

  it('refuses a sandbox it has no provider for instead of falling back to the host', () => {
    // A sandbox choice that reaches config without a provider here used to fall
    // through to `noSandbox()` — the agent ran on the operator's machine, and
    // nothing in the run said so.
    const unsupported = { ...config('docker'), sandbox: 'kata' } as unknown as RuncastleConfig
    expect(() => selectSandbox(unsupported)).toThrow(/refusing to run the agent unsandboxed/)
  })

  describe('buildSandboxOptions — container resource wiring', () => {
    it('omits cpus entirely when burnCpus is unset (unconstrained default)', () => {
      const opts = buildSandboxOptions(config('docker'))
      expect('cpus' in opts).toBe(false)
      expect(opts.imageName).toBe(DEFAULT_SANDBOX_IMAGE)
    })

    it('passes burnCpus through as the provider --cpus ceiling', () => {
      expect(buildSandboxOptions({ ...config('docker'), burnCpus: 2.5 }).cpus).toBe(2.5)
    })

    it('keeps cache mounts alongside the cpu ceiling', () => {
      const mount = { hostPath: '/host/cache', sandboxPath: '~/.npm' }
      const opts = buildSandboxOptions({ ...config('docker'), burnCpus: 1 }, [mount])
      expect(opts.mounts).toEqual([mount])
      expect(opts.cpus).toBe(1)
    })

    it('omits mounts when there are none, so the provider default applies', () => {
      expect('mounts' in buildSandboxOptions(config('docker'))).toBe(false)
    })
  })
})

describe('classifyToolCall — where a burn spends its wall-clock', () => {
  const bash = (cmd: string) => classifyToolCall('Bash', cmd)

  it('maps the non-Bash file tools by name', () => {
    expect(classifyToolCall('Read', 'src/a.ts')).toBe('file-read')
    expect(classifyToolCall('Grep', 'pattern')).toBe('search')
    expect(classifyToolCall('Edit', 'src/a.ts')).toBe('file-edit')
    expect(classifyToolCall('Write', 'src/a.ts')).toBe('file-edit')
    expect(classifyToolCall('Task', 'explore')).toBe('other')
  })

  it('charges a chained command to its dominant cost, not its first word', () => {
    // Burn agents chain hard; the suite is what the line costs, not the grep.
    expect(bash('cd /repo && pnpm test > /tmp/t.log 2>&1; grep -E "Tests" /tmp/t.log')).toBe('tests')
    expect(bash('cd /repo && git stash -u && pnpm --filter web test')).toBe('tests')
    expect(bash('cat pkg.json && pnpm typecheck')).toBe('typecheck')
  })

  it('does not read a filename as the tool being run', () => {
    // Regression: `\bvitest\b` matched inside `vitest.config.ts`, charging a
    // grep of the test CONFIG to the test suite.
    expect(bash('grep -n "setupFiles" vite.config.ts vitest.config.ts | head -20')).toBe('search')
    expect(bash('wc -l src/build.ts')).toBe('file-read')
    expect(bash('pnpm vitest run src/a.test.ts')).toBe('tests')
    expect(bash('npx vitest --shard=1/4')).toBe('tests')
    // A test-ish FILE argument to a different tool is not a test run.
    expect(bash('npx prettier --write src/a.test.ts')).toBe('lint')
  })

  it('recognises a workspace-filtered test script, the form this repo uses', () => {
    expect(bash('pnpm --filter web test')).toBe('tests')
    expect(bash('pnpm --filter @acme/api run test')).toBe('tests')
    // …but never across a command separator into an unrelated segment.
    expect(bash('pnpm --filter web typecheck && cat test.ts')).toBe('typecheck')
  })

  it('does not read a quoted argument as the command', () => {
    expect(bash('grep -rn "pnpm test" src/')).toBe('search')
    expect(bash("grep -n 'eslint' package.json")).toBe('search')
  })

  it('ignores heredoc bodies but keeps the heredoc itself as an edit', () => {
    const cmd = [
      "cd /repo && python3 - <<'PY'",
      "p = 'src/a.test.ts'",
      "open(p,'w').write('vitest describe eslint build')",
      'PY',
    ].join('\n')
    // The body writes a spec mentioning three other categories; the cost here
    // is the file rewrite.
    expect(bash(cmd)).toBe('file-edit')
  })

  it('separates shell reading from shell searching, so each prompt rule is measurable', () => {
    expect(bash('cd /repo && cat src/a.ts')).toBe('file-read')
    expect(bash('cd /repo && sed -n "1,80p" src/a.ts')).toBe('file-read')
    expect(bash('cd /repo && rg --files-with-matches foo')).toBe('search')
    expect(bash('cd /repo && git log --oneline -15')).toBe('git')
    expect(bash('corepack pnpm install --frozen-lockfile')).toBe('install')
    expect(bash('echo hi')).toBe('other')
  })
})

describe('createToolTimer — category shares from the sandcastle stream', () => {
  const at = (ms: number) => new Date(1_000_000 + ms)
  const tool = (name: string, args: string, ms: number, iteration = 1) =>
    ({ type: 'toolCall', name, formattedArgs: args, iteration, timestamp: at(ms) }) as const
  const text = (ms: number, iteration = 1) =>
    ({ type: 'text', message: 'thinking', iteration, timestamp: at(ms) }) as const

  it('charges each gap to the event that opened it', () => {
    const t = createToolTimer()
    t.onEvent(tool('Bash', 'pnpm test', 0)) // 10s of tests
    t.onEvent(text(10_000)) //  2s of model
    t.onEvent(tool('Bash', 'cat a.ts', 12_000)) //  1s of file-read
    t.onEvent(text(13_000))
    const s = t.summary()
    expect(s.byCategory.tests).toEqual({ calls: 1, ms: 10_000 })
    expect(s.byCategory.model).toEqual({ calls: 0, ms: 2_000 })
    expect(s.byCategory['file-read']).toEqual({ calls: 1, ms: 1_000 })
    expect(s.calls).toBe(2)
    expect(s.totalMs).toBe(13_000)
  })

  it('drops the gap across an iteration boundary — that is a container rebuild', () => {
    const t = createToolTimer()
    t.onEvent(tool('Bash', 'pnpm test', 0, 1))
    t.onEvent(tool('Bash', 'git log', 500_000, 2)) // new container, not 8min of tests
    expect(t.summary().byCategory.tests?.ms).toBe(0) // the call is counted, its 8min gap is not
    expect(t.summary().byCategory.tests?.calls).toBe(1)
  })

  it('drops an implausibly long single gap rather than letting a stall swamp the shares', () => {
    const t = createToolTimer()
    t.onEvent(tool('Bash', 'pnpm test', 0))
    t.onEvent(text(45 * 60_000))
    expect(t.summary().totalMs).toBe(0)
  })

  it('ignores raw lines and counts calls even when no time is attributable', () => {
    const t = createToolTimer()
    t.onEvent({ type: 'raw', line: 'noise', iteration: 1, timestamp: at(0) })
    t.onEvent(tool('Bash', 'pnpm test', 0))
    const s = t.summary()
    expect(s.calls).toBe(1)
    expect(s.totalMs).toBe(0)
  })

  it('formats a share digest ordered by cost', () => {
    const t = createToolTimer()
    t.onEvent(tool('Bash', 'pnpm test', 0))
    t.onEvent(tool('Bash', 'cat a.ts', 60_000))
    t.onEvent(text(80_000))
    expect(formatTimingSummary(t.summary())).toMatch(/tests 75%/)
    expect(formatTimingSummary({ totalMs: 0, calls: 0, byCategory: {} })).toMatch(/no measurable/)
  })
})

describe('buildVerifyNotes — the prompt block that bounds verification spend', () => {
  it('states configured commands verbatim and forbids hunting for alternatives', () => {
    const out = buildVerifyNotes({ verifyCommands: 'pnpm --filter @acme/web test' })
    expect(out).toContain('pnpm --filter @acme/web test')
    // The point of configuring commands is that agents stop guessing filter
    // names by running whole suites that error out.
    expect(out).toMatch(/do not go looking for alternatives|guess/i)
  })

  it('tells the agent to derive commands once when none are configured', () => {
    const out = buildVerifyNotes({})
    expect(out).toMatch(/ONCE/)
    expect(out).toMatch(/package\.json/i)
  })

  it('renders a configured baseline and retires the pre-work full-suite run', () => {
    const out = buildVerifyNotes({ knownFailures: '13 failures across 6 suites (credits, threads)' })
    expect(out).toContain('13 failures across 6 suites')
    expect(out).toMatch(/do NOT spend a run establishing it yourself/)
  })

  it('falls back to capture-the-baseline-once when none is configured', () => {
    const out = buildVerifyNotes({})
    expect(out).toMatch(/capture the baseline ONCE/i)
    expect(out).toMatch(/Never re-run a whole suite/i)
  })

  it('covers both halves independently — one configured, one not', () => {
    const out = buildVerifyNotes({ verifyCommands: 'bun test' })
    expect(out).toContain('bun test')
    expect(out).toMatch(/No pre-existing-failure baseline is configured/)
  })

  it('treats whitespace-only config as unset', () => {
    expect(buildVerifyNotes({ verifyCommands: '   \n ', knownFailures: '  ' })).toBe(
      buildVerifyNotes({}),
    )
  })
})

describe('setup-command detection (deps install before the agent starts)', () => {
  const tc = (over: Partial<RepoToolchain> = {}): RepoToolchain => ({
    hasPackageJson: true,
    lockfiles: { bun: false, pnpm: false, yarn: false, npm: false },
    ...over,
  })
  const locks = (over: Partial<RepoToolchain['lockfiles']>): RepoToolchain['lockfiles'] => ({
    bun: false,
    pnpm: false,
    yarn: false,
    npm: false,
    ...over,
  })

  it('the packageManager field (corepack pin) wins over lockfiles', () => {
    const t = tc({ packageManagerField: 'pnpm@9.6.0', lockfiles: locks({ yarn: true }) })
    expect(detectPackageManager(t)).toBe('pnpm')
  })

  it('falls back to lockfile presence in bun → pnpm → yarn → npm order', () => {
    expect(detectPackageManager(tc({ lockfiles: locks({ bun: true, pnpm: true }) }))).toBe('bun')
    expect(detectPackageManager(tc({ lockfiles: locks({ pnpm: true, yarn: true }) }))).toBe('pnpm')
    expect(detectPackageManager(tc({ lockfiles: locks({ yarn: true, npm: true }) }))).toBe('yarn')
    expect(detectPackageManager(tc({ lockfiles: locks({ npm: true }) }))).toBe('npm')
  })

  it('an unknown packageManager field falls back to lockfiles', () => {
    const t = tc({ packageManagerField: 'deno@2.0.0', lockfiles: locks({ pnpm: true }) })
    expect(detectPackageManager(t)).toBe('pnpm')
  })

  it('a bare package.json defaults to npm; no package.json means no toolchain', () => {
    expect(detectPackageManager(tc())).toBe('npm')
    expect(detectPackageManager(tc({ hasPackageJson: false }))).toBeUndefined()
  })

  it('uses frozen installs only when the matching lockfile exists', () => {
    expect(resolveSetupCommand(tc({ lockfiles: locks({ bun: true }) }))).toBe(
      '( bun install --frozen-lockfile || bun install )',
    )
    expect(resolveSetupCommand(tc({ lockfiles: locks({ pnpm: true }) }))).toBe(
      '( corepack pnpm install --frozen-lockfile || corepack pnpm install )',
    )
    expect(resolveSetupCommand(tc({ lockfiles: locks({ yarn: true }) }))).toBe(
      '( corepack yarn install --frozen-lockfile || corepack yarn install )',
    )
    expect(resolveSetupCommand(tc({ lockfiles: locks({ npm: true }) }))).toBe(
      '( npm ci || npm install )',
    )
    expect(resolveSetupCommand(tc())).toBe('npm install')
    expect(resolveSetupCommand(tc({ packageManagerField: 'pnpm@9.0.0' }))).toBe(
      'corepack pnpm install',
    )
  })

  /**
   * Regression — both halves measured against real repos on 2026-07-28, each of
   * which killed a preparation run in the pre-agent install hook:
   *
   * - `exam-forge`: `package-lock.json` present on the host but UNTRACKED, so
   *   the `isolated`-mode `git clone` did not carry it and `npm ci` died with
   *   EUSAGE before the agent ran once.
   * - `wasla`: `package-lock.json` tracked but out of sync with package.json,
   *   so `npm ci` refused it ("Missing: @emnapi/runtime@1.11.3 from lock file").
   *
   * Both are recoverable by the permissive install, so neither may be fatal.
   */
  it('falls back to a permissive install when the strict one cannot hold', () => {
    const cmd = resolveSetupCommand(tc({ lockfiles: locks({ npm: true }) }))
    expect(cmd).toContain('npm ci')
    expect(cmd).toContain('|| npm install')
    // Parenthesised: callers join with ` && `, and `&&`/`||` bind left-to-right,
    // so an unwrapped fallback would take the whole preceding chain as its left
    // operand and install in the wrong directory.
    expect(cmd?.startsWith('(')).toBe(true)
    expect(cmd?.endsWith(')')).toBe(true)
  })

  it('never wraps an explicit override — a typed command keeps its own semantics', () => {
    expect(resolveSetupCommand(tc({ lockfiles: locks({ npm: true }) }), 'npm ci')).toBe('npm ci')
  })

  it('a config override wins — even with no package.json (non-JS bootstrap)', () => {
    expect(resolveSetupCommand(tc({ lockfiles: locks({ pnpm: true }) }), 'make deps')).toBe(
      'make deps',
    )
    expect(resolveSetupCommand(tc({ hasPackageJson: false }), 'make deps')).toBe('make deps')
    // whitespace-only override is treated as unset
    expect(resolveSetupCommand(tc({ hasPackageJson: false }), '   ')).toBeUndefined()
  })

  it('returns undefined for a repo with no JS toolchain and no override', () => {
    expect(resolveSetupCommand(tc({ hasPackageJson: false }))).toBeUndefined()
  })
})

describe('cacheMountFor — package-manager cache bind-mounts', () => {
  it('maps download-cache managers to their in-sandbox cache path', () => {
    expect(cacheMountFor('bun', '/host/bun')).toEqual({
      hostPath: '/host/bun',
      sandboxPath: '~/.bun/install/cache',
    })
    expect(cacheMountFor('yarn', '/host/yarn')).toEqual({
      hostPath: '/host/yarn',
      sandboxPath: '~/.cache/yarn',
    })
    expect(cacheMountFor('npm', '/host/npm')).toEqual({
      hostPath: '/host/npm',
      sandboxPath: '~/.npm',
    })
  })

  // pnpm's store is hardlink-based, and a bind mount is always a different
  // filesystem from the container's overlayfs — mounting it forces a full copy
  // of every package instead of linking, on every host OS. Better unmounted.
  it('returns undefined for pnpm so its store stays inside the container', () => {
    expect(cacheMountFor('pnpm', '/host/pnpm')).toBeUndefined()
  })
})

describe('burn workspace mode (ADR-0005 — keep the hot path off the mount)', () => {
  const cfg = (
    sandbox: RuncastleConfig['sandbox'],
    burnWorkspace: RuncastleConfig['burnWorkspace'],
  ) => ({ sandbox, burnWorkspace })

  it('auto isolates on win32/darwin container hosts, stays mounted on linux', () => {
    expect(resolveBurnWorkspaceMode(cfg('docker', 'auto'), 'win32')).toBe('isolated')
    expect(resolveBurnWorkspaceMode(cfg('docker', 'auto'), 'darwin')).toBe('isolated')
    expect(resolveBurnWorkspaceMode(cfg('podman', 'auto'), 'win32')).toBe('isolated')
    expect(resolveBurnWorkspaceMode(cfg('docker', 'auto'), 'linux')).toBe('mounted')
  })

  it('an explicit setting wins over the platform', () => {
    expect(resolveBurnWorkspaceMode(cfg('docker', 'isolated'), 'linux')).toBe('isolated')
    expect(resolveBurnWorkspaceMode(cfg('docker', 'mounted'), 'win32')).toBe('mounted')
  })

  it('noSandbox is always mounted — no container, nothing to isolate from', () => {
    expect(resolveBurnWorkspaceMode(cfg('noSandbox', 'auto'), 'win32')).toBe('mounted')
    expect(resolveBurnWorkspaceMode(cfg('noSandbox', 'isolated'), 'win32')).toBe('mounted')
  })
})

describe('buildIsolatedSetupCommand — clone + auto-sync wiring for the sandbox hook', () => {
  const branch = 'runcastle/ticket/my-feature/4-ab12cd34'

  it('whitelists safe.directory, wires the clone and a post-commit push hook, then installs in the clone', () => {
    const cmd = buildIsolatedSetupCommand(branch, 'corepack pnpm install --frozen-lockfile')
    const steps = cmd.split(' && ')
    // Container-local wildcard: the worktree's gitdir resolves into the parent
    // .git mount, which sandcastle ≤0.12.0 leaves outside safe.directory —
    // without this the clone dies with "dubious ownership".
    expect(steps[0]).toBe(`git config --global --add safe.directory '*'`)
    expect(steps[1]).toBe(`git clone ${SANDBOX_WORKSPACE_PATH} ${ISOLATED_REPO_PATH}`)
    // the post-commit hook pushes HEAD to the ticket's temp branch (ref-only —
    // receive.denyCurrentBranch=ignore host-side) and then hard-resets the
    // mounted workspace checkout to it, so the worktree tracks the branch and
    // sandcastle's dirty check stays clean. Sync requires no agent discipline.
    // (Asserted on `cmd`, not a ' && '-split step: the hook body itself
    // contains ' && '.)
    expect(cmd).toContain(`HEAD:%s`)
    expect(cmd).toContain(`git -C ${SANDBOX_WORKSPACE_PATH} reset --hard --quiet %s`)
    // git exports GIT_DIR & co to hooks — without unsetting them the -C reset
    // would operate on the clone's repo, not the workspace
    expect(cmd).toContain('unset GIT_DIR GIT_WORK_TREE GIT_INDEX_FILE')
    expect(cmd).toContain(`'${branch}' '${branch}'`)
    expect(cmd).toContain(`> ${ISOLATED_REPO_PATH}/.git/hooks/post-commit`)
    expect(cmd).toContain(`chmod +x ${ISOLATED_REPO_PATH}/.git/hooks/post-commit`)
    // install runs INSIDE the clone, on the container's native filesystem
    expect(cmd).toContain(`cd ${ISOLATED_REPO_PATH} && corepack pnpm install --frozen-lockfile`)
  })

  it('re-pins core.hooksPath to .git/hooks AFTER the install — husky must not disarm the sync hook', () => {
    // A husky `prepare` script run by the install sets core.hooksPath=.husky/_,
    // which makes git ignore .git/hooks/post-commit — commits then stay trapped
    // in the clone and the ticket fails "agent made no commits" despite
    // completed work (observed on a real burn). Last writer wins, so the
    // re-pin must be the final step.
    const cmd = buildIsolatedSetupCommand(branch, 'corepack pnpm install --frozen-lockfile', 'pnpm')
    const rePin = `git -C ${ISOLATED_REPO_PATH} config core.hooksPath ${ISOLATED_REPO_PATH}/.git/hooks`
    expect(cmd.endsWith(rePin)).toBe(true)
    expect(cmd.indexOf(rePin)).toBeGreaterThan(cmd.indexOf('install --frozen-lockfile'))
  })

  it('shims pnpm/yarn onto ~/.local/bin — only corepack ships in the image', () => {
    // Real-burn agents each independently rediscovered `pnpm: command not
    // found` and hand-wrote this exact shim; do it once in setup instead.
    const pnpmCmd = buildIsolatedSetupCommand(branch, 'corepack pnpm install', 'pnpm')
    expect(pnpmCmd).toContain(`printf '#!/bin/sh\\nexec corepack pnpm "$@"\\n' > "$HOME/.local/bin/pnpm"`)
    expect(pnpmCmd).toContain(`chmod +x "$HOME/.local/bin/pnpm"`)
    const yarnCmd = buildIsolatedSetupCommand(branch, 'corepack yarn install', 'yarn')
    expect(yarnCmd).toContain(`> "$HOME/.local/bin/yarn"`)
    // bun/npm binaries exist in the image already — no shim
    expect(buildIsolatedSetupCommand(branch, 'npm ci', 'npm')).not.toContain('.local/bin')
    expect(buildIsolatedSetupCommand(branch, 'bun install', 'bun')).not.toContain('.local/bin')
    expect(buildIsolatedSetupCommand(branch, undefined)).not.toContain('.local/bin')
  })

  it('does NOT write receive.denyCurrentBranch in-sandbox — that is a host-side, once-per-burn write', () => {
    // A worktree shares its parent repo's .git/config; N sandboxes running the
    // write concurrently race on the shared config.lock and kill setup. The
    // host writes it once via allowPushToCheckedOutBranches before tickets spawn.
    const cmd = buildIsolatedSetupCommand(branch, 'npm ci')
    expect(cmd).not.toContain('receive.denyCurrentBranch')
  })

  it('still emits the clone/sync wiring when there is nothing to install', () => {
    const cmd = buildIsolatedSetupCommand(branch, undefined)
    expect(cmd).toContain('git clone')
    expect(cmd).toContain('post-commit')
    expect(cmd).not.toContain(' cd ')
  })
})

describe('buildWorkspaceNotes — the {{WORKSPACE_NOTES}} prompt block', () => {
  it('mounted mode points at the current directory', () => {
    expect(buildWorkspaceNotes('mounted')).toContain('current directory')
  })

  it('isolated mode redirects work, forbids the mirror, and routes BLOCKED.md to both', () => {
    const notes = buildWorkspaceNotes('isolated')
    expect(notes).toContain(ISOLATED_REPO_PATH)
    expect(notes).toContain(SANDBOX_WORKSPACE_PATH)
    expect(notes).toContain('BLOCKED.md')
    expect(notes).toMatch(/never edit/i)
  })
})

describe('createSerialQueue — one task at a time, in order', () => {
  it('runs tasks strictly serially in submission order', async () => {
    const queue = createSerialQueue()
    const log: string[] = []
    let active = 0

    const task = (name: string, delay: number) => async () => {
      active += 1
      expect(active).toBe(1) // never overlaps
      log.push(`start ${name}`)
      await new Promise((r) => setTimeout(r, delay))
      log.push(`end ${name}`)
      active -= 1
      return name
    }

    // Submit concurrently; the slow first task must fully finish before the fast second starts.
    const [a, b, c] = await Promise.all([
      queue(task('a', 20)),
      queue(task('b', 1)),
      queue(task('c', 1)),
    ])

    expect([a, b, c]).toEqual(['a', 'b', 'c'])
    expect(log).toEqual(['start a', 'end a', 'start b', 'end b', 'start c', 'end c'])
  })

  it('a rejection reaches its submitter without wedging later tasks', async () => {
    const queue = createSerialQueue()

    const failing = queue(async () => {
      throw new Error('merge failed')
    })
    const after = queue(async () => 'still runs')

    await expect(failing).rejects.toThrow('merge failed')
    await expect(after).resolves.toBe('still runs')
  })
})

describe('landWithResolve — conflicts are resolved in-loop, not handed to the human', () => {
  /** A `LandDeps` whose merge/resolve behaviour is scripted per call. */
  function deps(
    merges: TempBranchMergeResult[],
    resolves: ResolveAttemptResult[],
    maxResolveAttempts = 2,
  ) {
    const events: { type: string; message: string; data?: unknown }[] = []
    const merged: string[] = []
    const resolved: { branch: string; files: string[]; attempt: number }[] = []
    const landDeps: LandDeps = {
      merge: (branch) => {
        merged.push(branch)
        return Promise.resolve(merges[merged.length - 1] ?? { ok: false, error: 'unscripted merge' })
      },
      resolve: (input) => {
        resolved.push({ branch: input.branch, files: input.files, attempt: input.attempt })
        return Promise.resolve(
          resolves[resolved.length - 1] ?? { ok: false, branch: input.branch, error: 'unscripted' },
        )
      },
      maxResolveAttempts,
      emit: (e) => events.push(e),
      label: 'ticket 3',
      featureBranch: 'feature/demo',
    }
    return { landDeps, events, merged, resolved }
  }

  it('lands directly when the merge is clean — no resolver agent is spawned', async () => {
    const d = deps([{ ok: true }], [])
    const out = await landWithResolve('tkt/3-a', d.landDeps)

    expect(out).toEqual({ status: 'landed', branch: 'tkt/3-a' })
    expect(d.resolved).toEqual([])
    expect(d.events).toEqual([])
  })

  it('resolves a conflict and lands the resolver’s branch', async () => {
    const d = deps(
      [{ ok: false, conflict: true, files: ['a.ts', 'b.ts'], error: 'CONFLICTS: a.ts, b.ts' }, { ok: true }],
      [{ ok: true, branch: 'tkt/3-resolved' }],
    )
    const out = await landWithResolve('tkt/3-a', d.landDeps)

    expect(out).toEqual({ status: 'landed', branch: 'tkt/3-resolved' })
    // the resolver was briefed with the conflicting files git reported…
    expect(d.resolved).toEqual([{ branch: 'tkt/3-a', files: ['a.ts', 'b.ts'], attempt: 1 }])
    // …and the SECOND merge lands the resolved branch, not the original
    expect(d.merged).toEqual(['tkt/3-a', 'tkt/3-resolved'])
    expect(d.events.map((e) => e.type)).toEqual([
      'merge.conflict.resolving',
      'merge.conflict.resolved',
    ])
  })

  it('loops when the feature tip moves again mid-resolve, up to the attempt budget', async () => {
    const d = deps(
      [
        { ok: false, conflict: true, files: ['a.ts'], error: 'c1' },
        { ok: false, conflict: true, files: ['c.ts'], error: 'c2' },
        { ok: true },
      ],
      [
        { ok: true, branch: 'tkt/3-r1' },
        { ok: true, branch: 'tkt/3-r2' },
      ],
    )
    const out = await landWithResolve('tkt/3-a', d.landDeps)

    expect(out).toEqual({ status: 'landed', branch: 'tkt/3-r2' })
    // each pass re-reads the CURRENT conflict rather than reusing the first list
    expect(d.resolved).toEqual([
      { branch: 'tkt/3-a', files: ['a.ts'], attempt: 1 },
      { branch: 'tkt/3-r1', files: ['c.ts'], attempt: 2 },
    ])
  })

  it('gives up for a human once the budget is spent, reporting the live conflict', async () => {
    const d = deps(
      [
        { ok: false, conflict: true, files: ['a.ts'], error: 'c1' },
        { ok: false, conflict: true, files: ['a.ts', 'd.ts'], error: 'c2' },
      ],
      [{ ok: true, branch: 'tkt/3-r1' }],
      1,
    )
    const out = await landWithResolve('tkt/3-a', d.landDeps)

    // the branch carried forward is the resolver's (it holds the most work) and
    // the files are the ones that STILL conflict, not the original list
    expect(out).toEqual({
      status: 'conflict',
      branch: 'tkt/3-r1',
      files: ['a.ts', 'd.ts'],
      error: 'c2',
    })
  })

  it('a resolver that fails still carries its branch forward, with its own error', async () => {
    const d = deps(
      [{ ok: false, conflict: true, files: ['a.ts'], error: 'c1' }],
      [{ ok: false, branch: 'tkt/3-r1', error: 'resolver reported BLOCKED:\ncontradictory specs' }],
    )
    const out = await landWithResolve('tkt/3-a', d.landDeps)

    expect(out).toEqual({
      status: 'conflict',
      branch: 'tkt/3-r1',
      files: ['a.ts'],
      error: 'resolver reported BLOCKED:\ncontradictory specs',
    })
    expect(d.merged).toEqual(['tkt/3-a']) // no second merge after a failed resolve
  })

  it('never resolves when the budget is 0 (resolver disabled)', async () => {
    const d = deps([{ ok: false, conflict: true, files: ['a.ts'], error: 'c1' }], [], 0)
    const out = await landWithResolve('tkt/3-a', d.landDeps)

    expect(out).toEqual({ status: 'conflict', branch: 'tkt/3-a', files: ['a.ts'], error: 'c1' })
    expect(d.resolved).toEqual([])
  })

  it('a non-conflict landing failure is never handed to a resolver', async () => {
    const d = deps([{ ok: false, error: 'could not lock ref' }], [])
    const out = await landWithResolve('tkt/3-a', d.landDeps)

    expect(out).toEqual({ status: 'failed', branch: 'tkt/3-a', error: 'could not lock ref' })
    expect(d.resolved).toEqual([])
  })
})

describe('resolver prompt blocks', () => {
  it('renders the conflicting files, falling back to a git instruction', () => {
    expect(buildConflictFilesBlock(['src/a.ts', 'src/b.ts'])).toBe('- `src/a.ts`\n- `src/b.ts`')
    expect(buildConflictFilesBlock([])).toMatch(/git status/)
  })

  it('renders the other side of the merge, falling back to a git instruction', () => {
    expect(buildOtherSideBlock(['abc1234 ticket(2): add staging', 'def5678 ticket(4): wire it'])).toBe(
      '- abc1234 ticket(2): add staging\n- def5678 ticket(4): wire it',
    )
    expect(buildOtherSideBlock([])).toMatch(/git log/)
  })

  it('names the feature branch directly when mounted, and via a fetch when isolated', () => {
    // isolated mode works in a container-native CLONE, where the feature branch
    // is only a remote ref — a bare `git merge feature/x` would fail there
    expect(resolveMergeCommand('mounted', 'feature/x')).toBe('git merge --no-edit feature/x')
    expect(resolveMergeCommand('isolated', 'feature/x')).toBe(
      'git fetch origin feature/x && git merge --no-edit FETCH_HEAD',
    )
  })

  it('renderTemplate leaves placeholders it was given no value for alone', () => {
    expect(renderTemplate('{{A}} and {{B}} and {{A}}', { A: 'x' })).toBe('x and {{B}} and x')
  })
})
