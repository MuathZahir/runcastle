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
})
