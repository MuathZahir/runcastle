import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { ExecOutcome } from '../src/doctor/doctor'
import { createSystemExec } from '../src/doctor/system-exec'
import {
  type CacheSnapshot,
  PROBE_CONFIG_FILE,
  type ProbeCommands,
  ProbeError,
  type ProbeRun,
  buildCacheRows,
  buildSnapshotCommand,
  createProbeScratchRepo,
  expectedCaches,
  formatCacheTable,
  parseProbeArgs,
  parseProbeCommands,
  parseSnapshot,
  preflightFailure,
  probeExitCode,
  probeProjectId,
} from '../src/workflows/burn-cache-probe'

/**
 * The probe's verdict, tested with fabricated measurements. What the containers
 * actually do is the review ticket's job — a cold→warm pair on a real engine is
 * the only thing that can prove a cache was hit, and no unit test substitutes
 * for it. What IS testable here is the half that decides: given two runs'
 * numbers, which rows appear, what they say, and whether the script exits 1.
 */

const EMPTY: CacheSnapshot = { tsbuildinfo: 0, vitest: 0, jest: 0, turbo: 0, storeLinks: 0 }

/** A run with everything hitting, so a test only states the field it is about. */
function run(overrides: Partial<ProbeRun> = {}): ProbeRun {
  return {
    cold: false,
    syncMs: 1_000,
    installMs: 5_000,
    before: { ...EMPTY },
    after: { ...EMPTY },
    commands: {},
    ...overrides,
  }
}

/** The canonical warm pair: every cache populated cold, every one faster warm. */
function warmPair(): [ProbeRun, ProbeRun] {
  const populated: CacheSnapshot = {
    tsbuildinfo: 2,
    vitest: 1,
    jest: 6,
    turbo: 6,
    storeLinks: 2,
  }
  const cold = run({
    cold: true,
    installMs: 90_000,
    after: populated,
    commands: {
      typecheck: { command: 'pnpm exec tsc -b', durationMs: 20_000, exitCode: 0, output: '' },
      test: { command: 'npx jest', durationMs: 30_000, exitCode: 0, output: '' },
      build: { command: 'pnpm exec turbo run build', durationMs: 9_000, exitCode: 0, output: '' },
    },
  })
  const warm = run({
    installMs: 4_000,
    before: populated,
    after: populated,
    commands: {
      typecheck: { command: 'pnpm exec tsc -b', durationMs: 6_000, exitCode: 0, output: '' },
      test: { command: 'npx jest', durationMs: 11_000, exitCode: 0, output: '' },
      build: {
        command: 'pnpm exec turbo run build',
        durationMs: 900,
        exitCode: 0,
        output: 'Tasks: 2 successful, 2 total\nCached: 2 cached, 2 total\nTime: 7ms >>> FULL TURBO',
      },
    },
  })
  return [cold, warm]
}

const ALL_CACHES = ['install', 'tsbuildinfo', 'vitest', 'jest', 'turbo', 'store-hardlinks'] as const

const hitOf = (rows: ReturnType<typeof buildCacheRows>, cache: string): boolean | undefined =>
  rows.find((row) => row.cache === cache)?.hit

describe('parseProbeArgs', () => {
  it('defaults to docker with the cache volume dropped afterwards', () => {
    expect(parseProbeArgs(['/repo'])).toEqual({ repoPath: '/repo', engine: 'docker', keep: false })
  })

  it('takes the engine and --keep in any order', () => {
    expect(parseProbeArgs(['--keep', '--engine', 'podman', '/repo'])).toEqual({
      repoPath: '/repo',
      engine: 'podman',
      keep: true,
    })
  })

  it('refuses an engine with no named volumes, rather than probing a cache that cannot exist', () => {
    expect(() => parseProbeArgs(['/repo', '--engine', 'noSandbox'])).toThrow(ProbeError)
  })

  it('refuses missing, unknown and surplus arguments', () => {
    expect(() => parseProbeArgs([])).toThrow(/missing <repoPath>/)
    expect(() => parseProbeArgs(['/repo', '--warm'])).toThrow(/unknown flag/)
    expect(() => parseProbeArgs(['/repo', '/other'])).toThrow(/unexpected argument/)
  })
})

describe('probeProjectId', () => {
  it('is stable per repo path, so --keep leaves a volume the next probe reuses', () => {
    expect(probeProjectId('/repos/thing')).toBe(probeProjectId('/repos/thing'))
    expect(probeProjectId('/repos/thing')).not.toBe(probeProjectId('/repos/other'))
  })

  it('is never a real project id, so a probe cannot clear a project cache', () => {
    // Volume names are `runcastle-<projectId>`; a `proj_…` id would collide
    // with the real project's volume and `--keep`-less cleanup would drop it.
    expect(probeProjectId('/repos/thing')).toMatch(/^probe-[0-9a-f]{12}$/)
  })
})

describe('parseProbeCommands', () => {
  it('reads the typecheck, test and optional build commands', () => {
    const commands = parseProbeCommands('{"typecheck":"tsc -b","test":"vitest run","build":"turbo run build"}')
    expect(commands).toEqual({ typecheck: 'tsc -b', test: 'vitest run', build: 'turbo run build' })
  })

  it('omits build entirely when the repo has none', () => {
    expect(parseProbeCommands('{"typecheck":"tsc -b","test":"jest"}')).toEqual({
      typecheck: 'tsc -b',
      test: 'jest',
    })
  })

  it('refuses a config with no typecheck or no test — both rows depend on them', () => {
    expect(() => parseProbeCommands('{"test":"jest"}')).toThrow(/"typecheck"/)
    expect(() => parseProbeCommands('{"typecheck":"tsc -b","test":"  "}')).toThrow(/"test"/)
    expect(() => parseProbeCommands('not json')).toThrow(/valid JSON/)
  })
})

describe('expectedCaches', () => {
  const commands = (over: Partial<ProbeCommands> = {}): ProbeCommands => ({
    typecheck: 'pnpm exec tsc -b',
    test: 'pnpm exec vitest run',
    build: 'pnpm exec turbo run build',
    ...over,
  })

  it('expects every cache a pnpm + tsc -b + vitest + turbo monorepo can produce', () => {
    // No jest row: one repo cannot run both test runners, so expecting both
    // would fail the probe on a healthy volume.
    expect(expectedCaches('pnpm', commands())).toEqual([
      'install',
      'tsbuildinfo',
      'vitest',
      'turbo',
      'store-hardlinks',
    ])
  })

  it('skips the tools the repo does not use', () => {
    // npm + jest + `tsc -b`: no vitest, no turbo — and npm extracts tarballs
    // rather than linking out of a store, so a link count proves nothing.
    expect(expectedCaches('npm', commands({ test: 'npx jest', build: undefined }))).toEqual([
      'install',
      'tsbuildinfo',
      'jest',
    ])
  })

  it('skips tsbuildinfo for a typecheck that does not build incrementally', () => {
    expect(expectedCaches('npm', commands({ typecheck: 'npx tsc --noEmit', build: undefined })))
      .not.toContain('tsbuildinfo')
  })

  it('expects no install for a repo with no package manager at all', () => {
    expect(expectedCaches(undefined, commands())).not.toContain('install')
  })
})

describe('buildSnapshotCommand', () => {
  it('counts files, never merely tests for the cache directory', () => {
    // A tool creates its cache dir on startup whether or not it writes to it,
    // so `test -d` is exactly the false positive this script exists to exclude.
    const command = buildSnapshotCommand('/home/agent/cache/slots/1/repo', 'pnpm')
    expect(command).toContain('-type f')
    expect(command).not.toContain('test -d')
  })

  it('globs the vitest results file, whose parent is a hash only the container knows', () => {
    expect(buildSnapshotCommand('/repo', 'pnpm')).toContain(
      "find /repo/node_modules/.vite/vitest -name results.json",
    )
  })

  it('reads the hard-link count from the store the detected manager links out of', () => {
    expect(buildSnapshotCommand('/repo', 'pnpm')).toContain('/repo/node_modules/.pnpm')
    expect(buildSnapshotCommand('/repo', 'bun')).toContain('BUN_INSTALL_CACHE_DIR')
    expect(buildSnapshotCommand('/repo', 'npm')).toContain('storeLinks=0')
  })
})

describe('parseSnapshot', () => {
  it('reads the counts the snapshot command printed', () => {
    expect(parseSnapshot('tsbuildinfo=2\nvitest=1\njest=6\nturbo=4\nstoreLinks=2\n')).toEqual({
      tsbuildinfo: 2,
      vitest: 1,
      jest: 6,
      turbo: 4,
      storeLinks: 2,
    })
  })

  it('treats an absent or unreadable count as zero, never as a hit', () => {
    expect(parseSnapshot('tsbuildinfo=2\nstoreLinks=\nnoise')).toEqual({ ...EMPTY, tsbuildinfo: 2 })
  })
})

describe('buildCacheRows', () => {
  it('reports every expected cache as hit on a genuine warm second run', () => {
    const [cold, warm] = warmPair()
    const rows = buildCacheRows(ALL_CACHES, cold, warm)
    expect(rows.map((row) => row.cache)).toEqual([...ALL_CACHES])
    expect(rows.every((row) => row.hit)).toBe(true)
  })

  it('emits only the expected caches, in table order', () => {
    const [cold, warm] = warmPair()
    expect(buildCacheRows(['jest', 'install'], cold, warm).map((row) => row.cache)).toEqual([
      'install',
      'jest',
    ])
  })

  it('misses install when the second run had to go cold again', () => {
    const [cold, warm] = warmPair()
    const rows = buildCacheRows(['install'], cold, { ...warm, cold: true, installMs: 4_000 })
    expect(hitOf(rows, 'install')).toBe(false)
    expect(rows[0]?.warm).toContain('cold slot')
  })

  it('misses tsbuildinfo when the file did not survive into the second container', () => {
    // The load-bearing claim: present BEFORE run 2 started, not merely rewritten
    // by run 2's own typecheck — which happens with no volume at all.
    const [cold, warm] = warmPair()
    const rows = buildCacheRows(['tsbuildinfo'], cold, { ...warm, before: { ...EMPTY } })
    expect(hitOf(rows, 'tsbuildinfo')).toBe(false)
  })

  it('misses tsbuildinfo when the warm typecheck was no faster', () => {
    const [cold, warm] = warmPair()
    const slow = {
      ...warm,
      commands: { ...warm.commands, typecheck: { ...warm.commands.typecheck!, durationMs: 25_000 } },
    }
    expect(hitOf(buildCacheRows(['tsbuildinfo'], cold, slow), 'tsbuildinfo')).toBe(false)
  })

  it('misses vitest when the first run never wrote a results file', () => {
    const [cold, warm] = warmPair()
    const rows = buildCacheRows(['vitest'], { ...cold, after: { ...cold.after, vitest: 0 } }, warm)
    expect(hitOf(rows, 'vitest')).toBe(false)
  })

  it('misses jest when its cache did not survive the container rebuild', () => {
    const [cold, warm] = warmPair()
    const rows = buildCacheRows(['jest'], cold, { ...warm, before: { ...warm.before, jest: 0 } })
    expect(hitOf(rows, 'jest')).toBe(false)
  })

  it('misses turbo when the warm run rebuilt instead of restoring', () => {
    const [cold, warm] = warmPair()
    const rebuilt = {
      ...warm,
      commands: {
        ...warm.commands,
        build: { ...warm.commands.build!, output: 'Cached: 0 cached, 2 total' },
      },
    }
    const rows = buildCacheRows(['turbo'], cold, rebuilt)
    expect(hitOf(rows, 'turbo')).toBe(false)
    expect(rows[0]?.warm).toContain('no cache hit')
  })

  it('reads turbo only from the command that ran turbo', () => {
    const [cold, warm] = warmPair()
    const elsewhere = {
      ...warm,
      commands: {
        ...warm.commands,
        test: { ...warm.commands.test!, output: 'restored from cache hit' },
        build: { ...warm.commands.build!, output: 'rebuilt everything' },
      },
    }
    expect(hitOf(buildCacheRows(['turbo'], cold, elsewhere), 'turbo')).toBe(false)
  })

  it('misses store-hardlinks when the store was copied rather than linked', () => {
    // ADR-0004's exact failure: pnpm cannot hardlink across a bind mount and
    // silently copies instead, which looks identical apart from this count.
    const [cold, warm] = warmPair()
    const copied = { ...cold, after: { ...cold.after, storeLinks: 1 } }
    expect(hitOf(buildCacheRows(['store-hardlinks'], copied, warm), 'store-hardlinks')).toBe(false)
  })
})

describe('probeExitCode', () => {
  it('is 0 when every expected cache hit', () => {
    const [cold, warm] = warmPair()
    expect(probeExitCode(buildCacheRows(ALL_CACHES, cold, warm))).toBe(0)
  })

  it('is 1 when any single expected cache missed', () => {
    const [cold, warm] = warmPair()
    const rows = buildCacheRows(ALL_CACHES, cold, { ...warm, before: { ...warm.before, jest: 0 } })
    expect(probeExitCode(rows)).toBe(1)
  })

  it('is 0 for a repo that expects nothing — there is nothing to have missed', () => {
    expect(probeExitCode([])).toBe(0)
  })
})

describe('formatCacheTable', () => {
  it('prints a cache | cold | warm | hit row per cache, aligned', () => {
    const [cold, warm] = warmPair()
    const lines = formatCacheTable(buildCacheRows(['install', 'jest'], cold, warm)).split('\n')
    expect(lines[0]).toMatch(/^cache\s+cold\s+warm\s+hit$/)
    expect(lines).toHaveLength(4)
    expect(lines[2]).toMatch(/^install\s+90\.0s \(cold slot\)\s+4\.0s\s+yes$/)
  })

  it('calls a missed row out in a word that cannot be skimmed past', () => {
    const [cold, warm] = warmPair()
    const rows = buildCacheRows(['jest'], cold, { ...warm, before: { ...warm.before, jest: 0 } })
    expect(formatCacheTable(rows)).toContain('MISS')
  })
})

describe('createProbeScratchRepo', () => {
  const scratches: string[] = []
  const exec = createSystemExec()
  const fixture = (name: string): string => join(import.meta.dirname, 'fixtures/burn-cache', name)

  afterEach(() => {
    for (const path of scratches.splice(0)) rmSync(path, { recursive: true, force: true })
  })

  const scratchOf = async (source: string): Promise<string> => {
    const path = await createProbeScratchRepo(source, exec)
    scratches.push(path)
    return path
  }

  it.each(['pnpm-monorepo', 'jest-app'])(
    'turns the %s fixture into a committed git repo the burn path can fork from',
    async (name) => {
      const scratch = await scratchOf(fixture(name))

      expect(existsSync(join(scratch, PROBE_CONFIG_FILE))).toBe(true)
      const head = await exec('git', ['-C', scratch, 'log', '--oneline', '-1'])
      expect(head.code).toBe(0)
      const branch = await exec('git', ['-C', scratch, 'branch', '--show-current'])
      expect(branch.stdout.trim()).toBe('main')
      const dirty = await exec('git', ['-C', scratch, 'status', '--porcelain'])
      expect(dirty.stdout.trim()).toBe('')
    },
  )

  it('leaves installs and build output behind, so run 1 is genuinely cold', async () => {
    const source = mkdtempSync(join(tmpdir(), 'probe-source-'))
    scratches.push(source)
    for (const dir of ['node_modules', 'dist', '.turbo']) mkdirSync(join(source, dir))
    writeFileSync(join(source, 'node_modules', 'installed.js'), '')
    writeFileSync(join(source, 'package.json'), '{"name":"x","private":true}')

    const scratch = await scratchOf(source)

    expect(existsSync(join(scratch, 'package.json'))).toBe(true)
    for (const dir of ['node_modules', 'dist', '.turbo']) {
      expect(existsSync(join(scratch, dir))).toBe(false)
    }
  })
})

describe('preflightFailure', () => {
  const good: ExecOutcome = { ok: true, code: 0, stdout: '', stderr: '' }
  const bad: ExecOutcome = { ok: true, code: 1, stdout: '', stderr: '' }
  const absent: ExecOutcome = { ok: false, code: null, stdout: '', stderr: '' }

  it('passes a host with the engine up and the image built', () => {
    expect(preflightFailure('docker', 'sandcastle:runcastle', { cli: good, info: good, image: good }))
      .toBeUndefined()
  })

  it('names the engine the caller asked for, not whichever one is installed', () => {
    const message = preflightFailure('podman', 'sandcastle:runcastle', {
      cli: absent,
      info: absent,
      image: absent,
    })
    expect(message).toContain('podman was not found')
    expect(message).not.toContain('docker was not found')
  })

  it('separates a dead daemon from a missing CLI, with the fix for each', () => {
    expect(preflightFailure('docker', 'img', { cli: good, info: bad, image: good })).toMatch(
      /daemon is not responding[\s\S]*Fix: start Docker Desktop/,
    )
    expect(preflightFailure('podman', 'img', { cli: good, info: bad, image: good })).toMatch(
      /machine is not initialized[\s\S]*podman machine init/,
    )
  })

  it('points a missing image at the one click that builds it', () => {
    expect(preflightFailure('docker', 'sandcastle:runcastle', {
      cli: good,
      info: good,
      image: bad,
    })).toMatch(/image sandcastle:runcastle not found locally[\s\S]*Build image/)
  })
})
