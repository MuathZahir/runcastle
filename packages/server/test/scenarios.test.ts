import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { simpleGit } from 'simple-git'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { listScenarios, runScenario } from '../src/services/scenarios'
import { resolveBun } from './helpers/bun'
import { rmTemp, tmpRepo } from './helpers/fixtures'

/**
 * The scenario service at its seam: paths listed from git, and a real runner
 * (`bun {file}`) running tiny TS scripts that print the contract lines.
 */

const BUN = resolveBun()
const RUNNER = BUN ? `"${BUN}" {file}` : undefined

let repo: string

function put(rel: string, body: string): void {
  const abs = join(repo, ...rel.split('/'))
  mkdirSync(dirname(abs), { recursive: true })
  writeFileSync(abs, body)
}

async function commitAll(message: string): Promise<void> {
  const g = simpleGit(repo)
  await g.add('.')
  await g.commit(message)
}

beforeEach(async () => {
  repo = tmpRepo()
  const g = simpleGit(repo)
  await g.init(['-b', 'main'])
  await g.addConfig('user.name', 'test')
  await g.addConfig('user.email', 'test@example.com')
  await g.addConfig('commit.gpgsign', 'false')
})

afterEach(() => rmTemp(repo))

describe('listScenarios', () => {
  it('lists scenarios at a ref, grouped and named from paths, own first', async () => {
    put('README.md', 'x')
    put('.runcastle/scenarios/checkout/expired-coupon.ts', '')
    put('.runcastle/scenarios/auth/signed_out.ts', '')
    put('.runcastle/scenarios/empty-cart.ts', '')
    put('.runcastle/scenarios/_fixtures/buyer.ts', '')
    put('.runcastle/scenarios/checkout/_helpers.ts', '')
    put('.runcastle/drive-setup.ts', '')
    await commitAll('base')
    await simpleGit(repo).checkoutLocalBranch('feature/x')
    put('.runcastle/scenarios/checkout/deep/gift-card.ts', '')
    put('.runcastle/scenarios/admin/refund.ts', '')
    await commitAll('feature')
    // Back on main: the feature's scenarios are still listed, from git.
    await simpleGit(repo).checkout('main')

    const list = await listScenarios(repo, { ref: 'feature/x', baseBranch: 'main' })
    expect(list).toEqual([
      { file: '.runcastle/scenarios/admin/refund.ts', group: 'Admin', name: 'Refund', own: true },
      {
        file: '.runcastle/scenarios/checkout/deep/gift-card.ts',
        group: 'Checkout',
        name: 'Gift card',
        own: true,
      },
      { file: '.runcastle/scenarios/auth/signed_out.ts', group: 'Auth', name: 'Signed out', own: false },
      {
        file: '.runcastle/scenarios/checkout/expired-coupon.ts',
        group: 'Checkout',
        name: 'Expired coupon',
        own: false,
      },
      { file: '.runcastle/scenarios/empty-cart.ts', name: 'Empty cart', own: false },
    ])
  })

  it('marks nothing own without a base, and lists nothing for a ref without scenarios', async () => {
    put('.runcastle/scenarios/a.ts', '')
    await commitAll('base')
    expect(await listScenarios(repo, { ref: 'HEAD' })).toEqual([
      { file: '.runcastle/scenarios/a.ts', name: 'A', own: false },
    ])
    expect(await listScenarios(repo, { ref: 'no-such-branch' })).toEqual([])
  })
})

describe.skipIf(!RUNNER)('runScenario (real bun runner)', () => {
  const run = (file: string, extra: Partial<Parameters<typeof runScenario>[0]> = {}) =>
    runScenario({
      runner: RUNNER,
      file,
      cwd: repo,
      env: { RUNCASTLE_SLUG: 'demo', DATABASE_URL: 'sqlite://drive.db' },
      driveUrl: 'http://localhost:5199/',
      ...extra,
    })

  it('lands on the last ENTRY_URL, resolved against the drive URL', async () => {
    put(
      '.runcastle/scenarios/two.ts',
      [
        "console.log('ENTRY_URL=/first')",
        "console.log('TOKEN=abc')",
        "console.log('ENTRY_URL=/__drive/login?token=t&to=/cart  ')",
        "console.error('seeded')",
      ].join('\n'),
    )
    const res = await run('.runcastle/scenarios/two.ts')
    expect(res).toEqual({
      ok: true,
      entryUrl: 'http://localhost:5199/__drive/login?token=t&to=/cart',
      outputTail: expect.stringContaining('seeded'),
    })
  }, 30_000)

  it('keeps an absolute ENTRY_URL as is', async () => {
    put('.runcastle/scenarios/abs.ts', "console.log('ENTRY_URL=http://127.0.0.1:9000/x')")
    const res = await run('.runcastle/scenarios/abs.ts')
    expect(res.ok && res.entryUrl).toBe('http://127.0.0.1:9000/x')
  }, 30_000)

  it('passes the drive env plus a fresh RUNCASTLE_SCENARIO_RUN, and streams output', async () => {
    put(
      '.runcastle/scenarios/env.ts',
      [
        'const e = process.env',
        'console.log(`seen ${e.RUNCASTLE_SLUG} ${e.DATABASE_URL} run=${e.RUNCASTLE_SCENARIO_RUN}`)',
        "console.log('ENTRY_URL=/')",
      ].join('\n'),
    )
    const streamed: string[] = []
    const first = await run('.runcastle/scenarios/env.ts', { onOutput: (t) => streamed.push(t) })
    const second = await run('.runcastle/scenarios/env.ts')
    const runOf = (r: typeof first) => (r.ok ? /run=([0-9a-f]+)/.exec(r.outputTail)?.[1] : undefined)
    expect(first.ok && first.outputTail).toContain('seen demo sqlite://drive.db run=')
    expect(runOf(first)).toMatch(/^[0-9a-f]{6}$/)
    expect(runOf(second)).not.toBe(runOf(first))
    expect(streamed.join('\n')).toContain('seen demo')
  }, 30_000)

  it('fails with the exit code and the output tail on a non-zero exit', async () => {
    put('.runcastle/scenarios/boom.ts', "console.log('no buyer table'); process.exit(3)")
    expect(await run('.runcastle/scenarios/boom.ts')).toEqual({
      ok: false,
      failure: { reason: 'exit', exitCode: 3, outputTail: expect.stringContaining('no buyer table') },
    })
  }, 30_000)

  it('fails as no-entry-url when it exits 0 without printing one', async () => {
    put('.runcastle/scenarios/quiet.ts', "console.log('done, forgot the url')")
    expect(await run('.runcastle/scenarios/quiet.ts')).toEqual({
      ok: false,
      failure: { reason: 'no-entry-url', exitCode: 0, outputTail: 'done, forgot the url' },
    })
  }, 30_000)

  it('is killed and fails as timeout past its limit', async () => {
    put('.runcastle/scenarios/slow.ts', "console.log('waiting'); await Bun.sleep(20_000)")
    const res = await run('.runcastle/scenarios/slow.ts', { timeoutMs: 1_500 })
    expect(res.ok).toBe(false)
    expect(!res.ok && res.failure.reason).toBe('timeout')
  }, 30_000)
})

describe('runScenario without a runner', () => {
  it('fails as no-runner without running anything', async () => {
    expect(
      await runScenario({ runner: undefined, file: 'x', cwd: repo, env: {}, driveUrl: 'http://localhost/' }),
    ).toEqual({ ok: false, failure: { reason: 'no-runner', exitCode: null, outputTail: '' } })
  })
})
