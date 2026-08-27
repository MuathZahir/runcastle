import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { loadConfig } from '../src/config-load'

/**
 * Env-override edge cases for `loadConfig`. The hazard these pin down is the
 * exported-but-EMPTY variable — `export RUNCASTLE_BURN_CONFLICT_ATTEMPTS=` in a
 * shell profile, or a CI matrix declaring a name without a value. It is not
 * `undefined`, so a presence check admits it, and `Number('')` is `0` — which
 * for that key means "disable the in-loop conflict resolver" and for the others
 * is out of range. An operator who set nothing must get the defaults.
 *
 * `loadConfig` also merges `~/.runcastle/config.json`, so these run against an
 * empty temp data dir: the values under test are then the env's alone.
 */
describe('loadConfig — numeric env overrides', () => {
  /**
   * A core count above the small-host threshold, so `burnConcurrency`'s fallback
   * here is the flat 3 this table asserts rather than whatever the machine
   * running the suite happens to have. The narrowing itself is tested below.
   */
  const WIDE_HOST = 16

  let dataDir: string
  let previousDataDir: string | undefined

  beforeAll(() => {
    dataDir = mkdtempSync(join(tmpdir(), 'runcastle-config-'))
    previousDataDir = process.env.RUNCASTLE_DATA_DIR
    process.env.RUNCASTLE_DATA_DIR = dataDir
  })

  afterAll(() => {
    if (previousDataDir === undefined) delete process.env.RUNCASTLE_DATA_DIR
    else process.env.RUNCASTLE_DATA_DIR = previousDataDir
    rmSync(dataDir, { recursive: true, force: true })
  })

  /** Every numeric burn knob, with a value the schema accepts and its default. */
  const KNOBS = [
    { envVar: 'RUNCASTLE_BURN_CONCURRENCY', field: 'burnConcurrency', set: '4', fallback: 3 },
    { envVar: 'RUNCASTLE_BURN_MAX_ITERATIONS', field: 'burnMaxIterations', set: '5', fallback: 3 },
    { envVar: 'RUNCASTLE_BURN_ATTEMPTS', field: 'burnAttempts', set: '2', fallback: 3 },
    {
      envVar: 'RUNCASTLE_BURN_CONFLICT_ATTEMPTS',
      field: 'burnConflictAttempts',
      set: '1',
      fallback: 2,
    },
    { envVar: 'RUNCASTLE_BURN_CPUS', field: 'burnCpus', set: '2.5', fallback: undefined },
  ] as const

  for (const { envVar, field, set, fallback } of KNOBS) {
    describe(envVar, () => {
      it('takes a number', () => {
        const cfg = loadConfig({ [envVar]: set }, WIDE_HOST) as unknown as Record<string, unknown>
        expect(cfg[field]).toBe(Number(set))
      })

      it('falls back to the default when unset', () => {
        const cfg = loadConfig({}, WIDE_HOST) as unknown as Record<string, unknown>
        expect(cfg[field]).toBe(fallback)
      })

      it('treats an exported-but-empty value as unset', () => {
        const cfg = loadConfig({ [envVar]: '' }, WIDE_HOST) as unknown as Record<string, unknown>
        expect(cfg[field]).toBe(fallback)
      })
    })
  }

  it("lets an explicit '0' through to disable the in-loop conflict resolver", () => {
    expect(loadConfig({ RUNCASTLE_BURN_CONFLICT_ATTEMPTS: '0' }).burnConflictAttempts).toBe(0)
  })

  it("rejects a '0' the schema forbids instead of silently ignoring it", () => {
    expect(() => loadConfig({ RUNCASTLE_BURN_CONCURRENCY: '0' })).toThrow()
  })

  it('treats an exported-but-empty burn guard as unset', () => {
    expect(loadConfig({ RUNCASTLE_BURN_GUARD: '' }).burnGuard).toBe(true)
    expect(loadConfig({ RUNCASTLE_BURN_GUARD: '0' }).burnGuard).toBe(false)
  })
})

/**
 * `burnConcurrency` is the one default that depends on the machine: three
 * parallel burns each size their worker pools from the full core count, so a
 * small host gets width 1. The rule lives in core's pure
 * `resolveDefaultBurnConcurrency`; what these pin down is that the loader
 * applies it, and that anything the operator actually chose still wins.
 */
describe('loadConfig — host-aware burnConcurrency default', () => {
  let dataDir: string
  let previousDataDir: string | undefined

  beforeAll(() => {
    dataDir = mkdtempSync(join(tmpdir(), 'runcastle-cores-'))
    previousDataDir = process.env.RUNCASTLE_DATA_DIR
    process.env.RUNCASTLE_DATA_DIR = dataDir
  })

  afterAll(() => {
    if (previousDataDir === undefined) delete process.env.RUNCASTLE_DATA_DIR
    else process.env.RUNCASTLE_DATA_DIR = previousDataDir
    rmSync(dataDir, { recursive: true, force: true })
  })

  it('narrows to 1 on a small host and keeps 3 on a wide one', () => {
    expect(loadConfig({}, 6).burnConcurrency).toBe(1)
    expect(loadConfig({}, 8).burnConcurrency).toBe(1)
    expect(loadConfig({}, 12).burnConcurrency).toBe(3)
    expect(loadConfig({}, 16).burnConcurrency).toBe(3)
  })

  it('lets an env width win on a small host', () => {
    expect(loadConfig({ RUNCASTLE_BURN_CONCURRENCY: '4' }, 6).burnConcurrency).toBe(4)
  })

  it('lets a config-file width win on a small host', () => {
    const file = join(dataDir, 'config.json')
    writeFileSync(file, JSON.stringify({ burnConcurrency: 3 }))
    try {
      expect(loadConfig({}, 6).burnConcurrency).toBe(3)
    } finally {
      rmSync(file, { force: true })
    }
  })

  it('reads the host itself when no count is supplied', () => {
    expect([1, 3]).toContain(loadConfig({}).burnConcurrency)
  })
})
