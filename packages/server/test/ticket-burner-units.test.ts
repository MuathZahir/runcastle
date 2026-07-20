import type { AgentStreamEvent } from '@ai-hero/sandcastle'
import type { Feature, Ticket } from '@runcastle/core'
import { describe, expect, it } from 'vitest'
import {
  ISOLATED_REPO_PATH,
  SANDBOX_WORKSPACE_PATH,
  buildDocsDigest,
  buildFeatureBrief,
  buildIsolatedSetupCommand,
  buildTicketJson,
  buildWorkspaceNotes,
  cacheMountFor,
  createSerialQueue,
  createStreamThrottle,
  detectCycle,
  detectPackageManager,
  indexBySeq,
  interpretRunResult,
  isMergeConflictError,
  parseEnvFile,
  renderTicketPrompt,
  resolveBurnWorkspaceMode,
  resolveSetupCommand,
  selectSandbox,
} from '../src/workflows/ticket-burner'
import type { RepoToolchain } from '../src/workflows/ticket-burner'
import type { RuncastleConfig } from '@runcastle/core'

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
  size: 'full',
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
  ].join('\n')

  it('replaces every placeholder and leaves no stray {{ }}', () => {
    const out = renderTicketPrompt(template, {
      TICKET_JSON: buildTicketJson(ticket(4)),
      FEATURE_BRIEF: buildFeatureBrief(feature),
      DOCS_DIGEST: buildDocsDigest([{ name: 'spec.md', content: '# Spec\nbody' }]),
      COMMIT_CONVENTION: 'ticket(4): <summary>',
      WORKSPACE_NOTES: buildWorkspaceNotes('mounted'),
    })
    expect(out).not.toContain('{{')
    expect(out).not.toContain('}}')
    expect(out).toContain('"seq": 4')
    expect(out).toContain('My Feature')
    expect(out).toContain('feature/my-feature')
    expect(out).toContain('### spec.md')
    expect(out).toContain('ticket(4): <summary>')
    expect(out).toContain('Work in the current directory')
  })

  it('renders values containing $ and special chars safely', () => {
    const out = renderTicketPrompt('{{TICKET_JSON}}', {
      TICKET_JSON: 'cost is $5 & rising',
      FEATURE_BRIEF: '',
      DOCS_DIGEST: '',
      COMMIT_CONVENTION: '',
      WORKSPACE_NOTES: '',
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
      'bun install --frozen-lockfile',
    )
    expect(resolveSetupCommand(tc({ lockfiles: locks({ pnpm: true }) }))).toBe(
      'corepack pnpm install --frozen-lockfile',
    )
    expect(resolveSetupCommand(tc({ lockfiles: locks({ yarn: true }) }))).toBe(
      'corepack yarn install --frozen-lockfile',
    )
    expect(resolveSetupCommand(tc({ lockfiles: locks({ npm: true }) }))).toBe('npm ci')
    expect(resolveSetupCommand(tc())).toBe('npm install')
    expect(resolveSetupCommand(tc({ packageManagerField: 'pnpm@9.0.0' }))).toBe(
      'corepack pnpm install',
    )
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

  it('wires updateInstead, the clone, and a post-commit push hook, then installs in the clone', () => {
    const cmd = buildIsolatedSetupCommand(branch, 'corepack pnpm install --frozen-lockfile')
    const steps = cmd.split(' && ')
    expect(steps[0]).toBe(
      `git -C ${SANDBOX_WORKSPACE_PATH} config receive.denyCurrentBranch updateInstead`,
    )
    expect(steps[1]).toBe(`git clone ${SANDBOX_WORKSPACE_PATH} ${ISOLATED_REPO_PATH}`)
    // the post-commit hook pushes HEAD to the ticket's temp branch — sync
    // requires no agent discipline at all
    expect(steps[2]).toContain(`HEAD:%s`)
    expect(steps[2]).toContain(`'${branch}'`)
    expect(steps[2]).toContain(`> ${ISOLATED_REPO_PATH}/.git/hooks/post-commit`)
    expect(steps[3]).toBe(`chmod +x ${ISOLATED_REPO_PATH}/.git/hooks/post-commit`)
    // install runs INSIDE the clone, on the container's native filesystem
    expect(cmd.endsWith(`cd ${ISOLATED_REPO_PATH} && corepack pnpm install --frozen-lockfile`)).toBe(
      true,
    )
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
