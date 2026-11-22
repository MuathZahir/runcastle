import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { loadConfig, migrateCollapsedModelSteps } from '../src/config-load'

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
   * A fixed host memory (16 GiB, so the default is 4), so `burnConcurrency`'s
   * fallback here is the number this table asserts rather than whatever the
   * machine running the suite happens to have. The resolver itself is tested below.
   */
  const WIDE_HOST = 16 * 1024 ** 3

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
    { envVar: 'RUNCASTLE_BURN_CONCURRENCY', field: 'burnConcurrency', set: '6', fallback: 4 },
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

  it("rejects a '0' the schema forbids instead of silently ignoring it", () => {
    expect(() => loadConfig({ RUNCASTLE_BURN_CONCURRENCY: '0' })).toThrow()
  })

  it('ignores the retired sandbox, image, CPU, guard and cache env vars', () => {
    const cfg = loadConfig({
      RUNCASTLE_SANDBOX: 'podman',
      RUNCASTLE_SANDBOX_IMAGE: 'x:y',
      RUNCASTLE_BURN_CPUS: 'nope',
      RUNCASTLE_BURN_GUARD: '0',
      RUNCASTLE_BURN_CACHE: 'nope',
    }) as unknown as Record<string, unknown>
    for (const key of ['sandbox', 'sandboxImage', 'burnCpus', 'burnGuard', 'burnCache']) {
      expect(key in cfg).toBe(false)
    }
  })

  it('loads a config file that still carries the retired keys', () => {
    writeFileSync(
      join(dataDir, 'config.json'),
      JSON.stringify({ sandbox: 'docker', sandboxImage: 'a:b', burnCpus: 2, burnGuard: false, burnCache: 'off', burnConcurrency: 2 }),
    )
    try {
      const cfg = loadConfig({}) as unknown as Record<string, unknown>
      expect(cfg.burnConcurrency).toBe(2)
      expect('sandbox' in cfg).toBe(false)
    } finally {
      rmSync(join(dataDir, 'config.json'), { force: true })
    }
  })
})

/**
 * `burnConcurrency` is the one default that depends on the machine: one worker
 * per 4 GB of memory, between 2 and 8. The rule lives in core's pure
 * `resolveDefaultWorkersAtOnce`; what these pin down is that the loader
 * applies it, and that anything the operator actually chose still wins.
 */
describe('loadConfig — host-aware burnConcurrency default', () => {
  const GIB = 1024 ** 3
  let dataDir: string
  let previousDataDir: string | undefined

  beforeAll(() => {
    dataDir = mkdtempSync(join(tmpdir(), 'runcastle-mem-'))
    previousDataDir = process.env.RUNCASTLE_DATA_DIR
    process.env.RUNCASTLE_DATA_DIR = dataDir
  })

  afterAll(() => {
    if (previousDataDir === undefined) delete process.env.RUNCASTLE_DATA_DIR
    else process.env.RUNCASTLE_DATA_DIR = previousDataDir
    rmSync(dataDir, { recursive: true, force: true })
  })

  it('gives 2 on a small host and scales up to 8 on a big one', () => {
    expect(loadConfig({}, 6 * GIB).burnConcurrency).toBe(2)
    expect(loadConfig({}, 12 * GIB).burnConcurrency).toBe(3)
    expect(loadConfig({}, 32 * GIB).burnConcurrency).toBe(8)
    expect(loadConfig({}, 64 * GIB).burnConcurrency).toBe(8)
  })

  it('lets an env number win on a small host', () => {
    expect(loadConfig({ RUNCASTLE_BURN_CONCURRENCY: '12' }, 6 * GIB).burnConcurrency).toBe(12)
  })

  it('lets a config-file number win on a small host', () => {
    const file = join(dataDir, 'config.json')
    writeFileSync(file, JSON.stringify({ burnConcurrency: 3 }))
    try {
      expect(loadConfig({}, 6 * GIB).burnConcurrency).toBe(3)
    } finally {
      rmSync(file, { force: true })
    }
  })

  it('reads the host itself when no figure is supplied', () => {
    const n = loadConfig({}).burnConcurrency
    expect(n).toBeGreaterThanOrEqual(2)
    expect(n).toBeLessThanOrEqual(8)
  })
})

describe('loadConfig — collapsed chat step read-compat', () => {
  let dataDir: string
  let previousDataDir: string | undefined

  beforeAll(() => {
    dataDir = mkdtempSync(join(tmpdir(), 'runcastle-chat-step-'))
    previousDataDir = process.env.RUNCASTLE_DATA_DIR
    process.env.RUNCASTLE_DATA_DIR = dataDir
  })

  afterAll(() => {
    if (previousDataDir === undefined) delete process.env.RUNCASTLE_DATA_DIR
    else process.env.RUNCASTLE_DATA_DIR = previousDataDir
    rmSync(dataDir, { recursive: true, force: true })
  })

  it('moves a persisted ideation model to chat without changing current steps', () => {
    writeFileSync(
      join(dataDir, 'config.json'),
      JSON.stringify({
        stepModels: {
          ideation: 'claude-opus-5',
          smoke: 'claude-haiku-4-5-20251001',
        },
      }),
    )

    expect(loadConfig({}, 16 * 1024 ** 3).stepModels).toEqual({
      chat: 'claude-opus-5',
      smoke: 'claude-haiku-4-5-20251001',
    })
  })

  it('silently drops persisted qa and revisit models', () => {
    writeFileSync(
      join(dataDir, 'config.json'),
      JSON.stringify({ stepModels: { qa: 'qa-model', revisit: 'revisit-model' } }),
    )

    expect(loadConfig({}, 16 * 1024 ** 3).stepModels).toEqual({})
  })

  it('keeps an explicit chat model instead of the persisted ideation model', () => {
    writeFileSync(
      join(dataDir, 'config.json'),
      JSON.stringify({ stepModels: { chat: 'chat-model', ideation: 'ideation-model' } }),
    )

    expect(loadConfig({}, 16 * 1024 ** 3).stepModels).toEqual({ chat: 'chat-model' })
  })

  it('is the exported migration, leaving every key outside stepModels untouched', () => {
    expect(
      migrateCollapsedModelSteps({ model: 'm', stepModels: { ideation: 'i', qa: 'q' } }),
    ).toEqual({ model: 'm', stepModels: { chat: 'i' } })
  })
})
