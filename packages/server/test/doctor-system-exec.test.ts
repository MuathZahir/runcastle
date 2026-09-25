import { describe, expect, it } from 'vitest'
import { createSystemExec } from '../src/doctor/system-exec'

describe('createSystemExec (real spawn)', () => {
  const exec = createSystemExec()

  it('resolves and runs a real binary on PATH', async () => {
    const out = await exec('git', ['--version'])
    expect(out.ok).toBe(true)
    expect(out.code).toBe(0)
    expect(out.stdout).toMatch(/git version/i)
  })

  it('reports ok:false (not present) for a binary that is not on PATH', async () => {
    const out = await exec('runcastle-definitely-not-a-real-binary', ['--version'])
    expect(out.ok).toBe(false)
    expect(out.code).toBeNull()
  })

  // A wedged Docker daemon leaves `docker info` blocked forever; unbounded, the
  // doctor query waiting on it never returned and held the app on its loader.
  it('gives up on a command that never answers: present, not healthy, timed out', async () => {
    const bounded = createSystemExec({ timeoutMs: 500 })
    const started = Date.now()
    const out = await bounded('node', ['-e', 'setTimeout(() => {}, 30000)'])
    expect(Date.now() - started).toBeLessThan(10_000)
    expect(out.ok).toBe(true)
    expect(out.code).toBeNull()
    expect(out.timedOut).toBe(true)
    expect(out.stderr).toMatch(/timed out after/)
  })
})
