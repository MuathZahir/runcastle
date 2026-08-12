import { mkdtempSync, rmSync } from 'node:fs'
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
        const cfg = loadConfig({ [envVar]: set }) as unknown as Record<string, unknown>
        expect(cfg[field]).toBe(Number(set))
      })

      it('falls back to the default when unset', () => {
        const cfg = loadConfig({}) as unknown as Record<string, unknown>
        expect(cfg[field]).toBe(fallback)
      })

      it('treats an exported-but-empty value as unset', () => {
        const cfg = loadConfig({ [envVar]: '' }) as unknown as Record<string, unknown>
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
