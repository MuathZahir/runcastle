import { describe, expect, it, vi } from 'vitest'
import { createSystemExec } from '../src/doctor/system-exec'
import type { Containment } from '../src/pty/job-object'
import { killProcessTree } from '../src/pty/kill-tree'

// The real tree walk, observed: which kill path a timed-out command took.
vi.mock('../src/pty/kill-tree', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/pty/kill-tree')>()
  return { ...actual, killProcessTree: vi.fn(actual.killProcessTree) }
})

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

describe('createSystemExec — the Job Object each command runs in (win32)', () => {
  /** A recording fake of the job; `killsRoot` ends the command the way a real job would. */
  function fakeJobs(opts: { killsRoot?: boolean } = {}): {
    containFn: (pid: number) => Containment
    contained: number[]
    killed: number[]
  } {
    const contained: number[] = []
    const killed: number[] = []
    const containFn = (pid: number): Containment => {
      contained.push(pid)
      let killing: Promise<boolean> | undefined
      return {
        pid,
        // Idempotent, like the real one: a second kill resolves the first's result.
        kill: () =>
          (killing ??= (async () => {
            killed.push(pid)
            if (opts.killsRoot) process.kill(pid, 'SIGKILL')
            return true
          })()),
      }
    }
    return { containFn, contained, killed }
  }

  it('contains the command and closes its job once it exits', async () => {
    const jobs = fakeJobs()
    const out = await createSystemExec({ containFn: jobs.containFn })('git', ['--version'])
    expect(out.code).toBe(0)
    expect(jobs.contained).toHaveLength(1)
    expect(jobs.killed).toEqual(jobs.contained)
  })

  it('never contains a binary that did not spawn', async () => {
    const jobs = fakeJobs()
    const out = await createSystemExec({ containFn: jobs.containFn })('runcastle-definitely-not-a-real-binary', [])
    expect(out.ok).toBe(false)
    expect(jobs.contained).toEqual([])
  })

  it('kills a command that never answers through its job, not the tree walk', async () => {
    const jobs = fakeJobs({ killsRoot: true })
    vi.mocked(killProcessTree).mockClear()
    const out = await createSystemExec({ timeoutMs: 500, containFn: jobs.containFn })('node', [
      '-e',
      'setTimeout(() => {}, 30000)',
    ])
    expect(out.timedOut).toBe(true)
    expect(jobs.killed[0]).toBe(jobs.contained[0])
    expect(killProcessTree).not.toHaveBeenCalled()
  })

  it('falls back to the tree walk when the command could not be contained', async () => {
    vi.mocked(killProcessTree).mockClear()
    const out = await createSystemExec({ timeoutMs: 500, containFn: () => null })('node', [
      '-e',
      'setTimeout(() => {}, 30000)',
    ])
    expect(out.timedOut).toBe(true)
    expect(killProcessTree).toHaveBeenCalledTimes(1)
  })
})
