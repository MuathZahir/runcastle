import { describe, expect, it, vi } from 'vitest'
import {
  createKillRegistry,
  killRegistry,
  registerHostChildren,
  type KillRegistryDeps,
} from '../src/workflows/kill-registry'

/**
 * The kill-handle registry — the seam between "abort the run" and "the process
 * is actually dead".
 *
 * Aborting a sandcastle run interrupts a fiber and nothing else, so runcastle
 * kills the process itself: `docker rm -f <name>` for a containerised agent, the
 * proven `killProcessTree` for a host one. What the registry owes its caller is
 * narrower than "it ran a command" — it owes an honest answer to "is it dead
 * yet", bounded, and it must never reject, because a stop that throws leaves the
 * UI in the same lie it started in.
 *
 * Both system calls are injected, so every case here runs without a container
 * engine and without killing anything real.
 */

/** A registry whose docker calls are recorded and answered by `existsAfterRemove`. */
function withDocker(opts: {
  /** How many `inspect` probes still report the container alive after `rm -f`. */
  aliveProbes?: number
  /** Never dies — every probe reports the container still there. */
  immortal?: boolean
}): { registry: ReturnType<typeof createKillRegistry>; calls: string[][] } {
  const calls: string[][] = []
  let remaining = opts.aliveProbes ?? 0
  const deps: KillRegistryDeps = {
    runDocker: async (args) => {
      calls.push(args)
      if (args[0] !== 'inspect') return true
      if (opts.immortal) return true
      if (remaining > 0) {
        remaining -= 1
        return true
      }
      return false
    },
    killTree: async () => {},
  }
  return { registry: createKillRegistry(deps), calls }
}

/** A registry whose tree-kills are recorded; docker is never expected to run. */
function withHost(killTree?: (pid: number) => Promise<void>): {
  registry: ReturnType<typeof createKillRegistry>
  killed: number[]
} {
  const killed: number[] = []
  const deps: KillRegistryDeps = {
    runDocker: async (args) => {
      throw new Error(`docker must not run for a host lane; got ${JSON.stringify(args)}`)
    },
    killTree: async (pid) => {
      killed.push(pid)
      await killTree?.(pid)
    },
  }
  return { registry: createKillRegistry(deps), killed }
}

describe('killAndWait — a containerised lane', () => {
  it('removes the container by name and confirms it is gone', async () => {
    const { registry, calls } = withDocker({})
    registry.registerContainer('ticket_abc', 'runcastle-run_1-t3')

    await expect(registry.killAndWait('ticket_abc')).resolves.toEqual({ confirmed: true })

    // `rm -f` — an immediate SIGKILL and removal. `docker stop` would spend ten
    // seconds asking an agent mid-burn to wind down politely first.
    expect(calls[0]).toEqual(['rm', '-f', 'runcastle-run_1-t3'])
    expect(calls.slice(1).every((call) => call[0] === 'inspect')).toBe(true)
  })

  it('keeps probing until the container actually vanishes', async () => {
    // Removal is asynchronous engine-side: the container outlives `rm -f` by a
    // beat, and reporting death on the command's exit code would be the same
    // optimistic lie this whole feature removes.
    const { registry, calls } = withDocker({ aliveProbes: 3 })
    registry.registerContainer('ticket_abc', 'runcastle-run_1-t3')

    await expect(registry.killAndWait('ticket_abc')).resolves.toEqual({ confirmed: true })

    expect(calls.filter((call) => call[0] === 'inspect')).toHaveLength(4)
  })

  it('resolves unconfirmed — never rejects — when the container outlives the deadline', async () => {
    const { registry } = withDocker({ immortal: true })
    registry.registerContainer('ticket_abc', 'runcastle-run_1-t3')

    const started = Date.now()
    await expect(registry.killAndWait('ticket_abc', { timeoutMs: 300 })).resolves.toEqual({
      confirmed: false,
    })
    // Bounded: the caller gets its answer at the deadline, not whenever docker
    // feels like it. The UI's honesty depends on this returning at all.
    expect(Date.now() - started).toBeLessThan(3000)
  })

  it('keeps the handle after an unconfirmed kill, so a retry kills again', async () => {
    const { registry } = withDocker({ immortal: true })
    registry.registerContainer('ticket_abc', 'runcastle-run_1-t3')

    await registry.killAndWait('ticket_abc', { timeoutMs: 200 })

    // Dropping it would make the retry report a clean `confirmed: true` for a
    // lane whose container is demonstrably still running.
    expect(registry.keys()).toEqual(['ticket_abc'])
  })
})

describe('killAndWait — a host lane', () => {
  it('reaps the registered pid tree and confirms death', async () => {
    const { registry, killed } = withHost()
    registry.registerHostPid('run_xyz', 4242)

    await expect(registry.killAndWait('run_xyz')).resolves.toEqual({ confirmed: true })

    expect(killed).toEqual([4242])
  })

  it('kills the LATEST pid — the host provider spawns a fresh child per exec', async () => {
    const { registry, killed } = withHost()
    registry.registerHostPid('run_xyz', 111)
    registry.registerHostPid('run_xyz', 222)
    registry.registerHostPid('run_xyz', 333)

    await registry.killAndWait('run_xyz')

    // 111 and 222 have long since exited; taskkilling one of them reaches a
    // stranger's tree if the OS reused the pid, and never the live agent.
    expect(killed).toEqual([333])
  })

  it('resolves unconfirmed when the tree-kill itself outlives the deadline', async () => {
    const { registry } = withHost(() => new Promise(() => {}))
    registry.registerHostPid('run_xyz', 4242)

    await expect(registry.killAndWait('run_xyz', { timeoutMs: 200 })).resolves.toEqual({
      confirmed: false,
    })
  })
})

describe('the lane lifecycle', () => {
  it('resolves confirmed for a lane nobody registered — there is nothing to kill', async () => {
    const { registry, calls } = withDocker({})

    await expect(registry.killAndWait('ticket_never_launched')).resolves.toEqual({ confirmed: true })

    expect(calls).toEqual([])
  })

  it('forgets a released lane, so a later stop is a no-op', async () => {
    const { registry, calls } = withDocker({})
    registry.registerContainer('ticket_abc', 'runcastle-run_1-t3')
    registry.release('ticket_abc')

    await expect(registry.killAndWait('ticket_abc')).resolves.toEqual({ confirmed: true })

    expect(registry.keys()).toEqual([])
    expect(calls).toEqual([])
  })

  it('forgets a lane it confirmed dead', async () => {
    const { registry } = withDocker({})
    registry.registerContainer('ticket_abc', 'runcastle-run_1-t3')

    await registry.killAndWait('ticket_abc')

    expect(registry.keys()).toEqual([])
  })

  it('replaces a lane handle rather than accumulating one per kind', async () => {
    // A lane is either containerised or on the host; re-registering it as the
    // other must not leave the first handle behind to be killed instead.
    const { registry, killed } = withHost()
    registry.registerContainer('ticket_abc', 'runcastle-run_1-t3')
    registry.registerHostPid('ticket_abc', 4242)

    await expect(registry.killAndWait('ticket_abc')).resolves.toEqual({ confirmed: true })

    expect(killed).toEqual([4242])
  })

  it('names the lane, the handle and ms-to-settle on stderr', async () => {
    const errs: string[] = []
    const spy = vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
      errs.push(args.map(String).join(' '))
    })
    try {
      const { registry } = withDocker({})
      registry.registerContainer('ticket_abc', 'runcastle-run_1-t3')
      await registry.killAndWait('ticket_abc')
    } finally {
      spy.mockRestore()
    }

    const line = errs.find((l) => l.includes('killAndWait'))
    expect(line, `no kill breadcrumb. Saw: ${JSON.stringify(errs)}`).toBeDefined()
    expect(line).toContain('[kill-registry]')
    expect(line).toContain('lane=ticket_abc')
    expect(line).toContain('container=runcastle-run_1-t3')
    expect(line).toMatch(/after \d+ms/)
  })
})

describe('killAllForRun — Cancel run', () => {
  it('kills every lane the run owns and leaves other runs alone', async () => {
    const { registry, calls } = withDocker({})
    registry.registerContainer('ticket_a', 'runcastle-run_1-t1', { runId: 'run_1' })
    registry.registerContainer('ticket_b', 'runcastle-run_1-t2', { runId: 'run_1' })
    registry.registerContainer('ticket_c', 'runcastle-run_2-t1', { runId: 'run_2' })

    await expect(registry.killAllForRun('run_1')).resolves.toEqual({ confirmed: true })

    const removed = calls.filter((call) => call[0] === 'rm').map((call) => call[2])
    expect(removed.sort()).toEqual(['runcastle-run_1-t1', 'runcastle-run_1-t2'])
    expect(registry.keys()).toEqual(['ticket_c'])
  })

  it('is unconfirmed when any one of the run lanes outlives the deadline', async () => {
    // Honest reporting is the whole point: one container that will not die means
    // the run is not confirmed stopped, however many of its siblings went.
    const { registry } = withDocker({ immortal: true })
    registry.registerContainer('ticket_a', 'runcastle-run_1-t1', { runId: 'run_1' })

    await expect(registry.killAllForRun('run_1', { timeoutMs: 200 })).resolves.toEqual({
      confirmed: false,
    })
  })

  it('resolves confirmed for a run with nothing left registered', async () => {
    const { registry, calls } = withDocker({})
    registry.registerContainer('ticket_a', 'runcastle-run_1-t1', { runId: 'run_1' })

    await expect(registry.killAllForRun('run_other')).resolves.toEqual({ confirmed: true })

    expect(calls).toEqual([])
  })

  it('reaches a run-scoped host lane registered under the run id', async () => {
    // The review/research agents run on the host with the run as their lane key
    // — Cancel run must still find them, so ownership is recorded either way.
    const { registry, killed } = withHost()
    registry.registerHostPid('run_1', 4242, { runId: 'run_1' })

    await expect(registry.killAllForRun('run_1')).resolves.toEqual({ confirmed: true })

    expect(killed).toEqual([4242])
  })
})

describe('whenKillSettled — the gate a terminal write waits behind', () => {
  /**
   * A stop aborts the run and waits for the kill second, and the abort is what
   * makes the run reject — so the failure path that writes "stopped" is running
   * WHILE the container is still being removed. The registry is what that path
   * asks "is it gone yet", and these cases pin the two answers it owes: pending
   * for as long as the target is alive, resolved the moment it is not.
   */

  /** A registry whose container refuses to vanish until `letItDie()` is called. */
  function withHeldContainer(): {
    registry: ReturnType<typeof createKillRegistry>
    letItDie: () => void
  } {
    let alive = true
    const deps: KillRegistryDeps = {
      runDocker: async (args) => (args[0] === 'inspect' ? alive : true),
      killTree: async () => {},
    }
    return { registry: createKillRegistry(deps), letItDie: () => (alive = false) }
  }

  /** Yield the microtask queue, the way the burner's own continuations would. */
  async function flush(): Promise<void> {
    for (let i = 0; i < 20; i++) await Promise.resolve()
  }

  it('stays pending while the container is still there, and resolves when it goes', async () => {
    const { registry, letItDie } = withHeldContainer()
    registry.registerContainer('ticket_abc', 'runcastle-run_1-t3', { runId: 'run_1' })

    const kill = registry.killAndWait('ticket_abc')
    let gateOpened = false
    void registry.whenKillSettled('ticket_abc').then(() => {
      gateOpened = true
    })

    await flush()
    expect(gateOpened).toBe(false)

    letItDie()
    await kill
    await flush()
    expect(gateOpened).toBe(true)
  })

  it('resolves at once for a lane with no kill in flight — every ordinary finish', async () => {
    const { registry } = withHeldContainer()

    await expect(registry.whenKillSettled('ticket_never_stopped')).resolves.toBeUndefined()
  })

  it('opens when an unkillable process runs out its deadline, not before', async () => {
    // The gate must not wedge on a container that will never die: the deadline
    // releases the write, and saying it timed out is then the caller's job.
    const { registry } = withDocker({ immortal: true })
    registry.registerContainer('ticket_abc', 'runcastle-run_1-t3')

    const kill = registry.killAndWait('ticket_abc', { timeoutMs: 200 })
    const started = Date.now()
    await registry.whenKillSettled('ticket_abc')

    expect(Date.now() - started).toBeGreaterThanOrEqual(150)
    await expect(kill).resolves.toEqual({ confirmed: false })
  })

  it('waits for every lane of a run, so Cancel run finalizes behind all of them', async () => {
    const { registry, letItDie } = withHeldContainer()
    registry.registerContainer('ticket_a', 'runcastle-run_1-t1', { runId: 'run_1' })
    registry.registerContainer('ticket_b', 'runcastle-run_1-t2', { runId: 'run_1' })

    const kills = registry.killAllForRun('run_1')
    let gateOpened = false
    void registry.whenRunKillsSettled('run_1').then(() => {
      gateOpened = true
    })

    await flush()
    expect(gateOpened).toBe(false)

    letItDie()
    await kills
    await flush()
    expect(gateOpened).toBe(true)
  })

  it('does not hold one run behind another run’s kill', async () => {
    const { registry } = withHeldContainer()
    registry.registerContainer('ticket_a', 'runcastle-run_1-t1', { runId: 'run_1' })
    const kill = registry.killAndWait('ticket_a', { timeoutMs: 100 })

    await expect(registry.whenRunKillsSettled('run_other')).resolves.toBeUndefined()

    await kill
  })
})

describe('killRegistry()', () => {
  it('is one process-wide instance, so a hot reload cannot strand a live handle', () => {
    expect(killRegistry()).toBe(killRegistry())
  })
})

describe('registerHostChildren — what a host agent hands sandcastle', () => {
  // The callback has to land on the PROCESS-WIDE registry: a lane registered
  // anywhere else is a lane `stopTicketRun` and `cancelRun` cannot find, which
  // is precisely the silence this feature exists to end.
  it('puts every child it is told about on the lane the stop looks up', () => {
    const onChildSpawn = registerHostChildren('tkt_host', { runId: 'run_9' })

    onChildSpawn(4242)
    expect(killRegistry().keys()).toContain('tkt_host')

    // A fresh child per exec — the lane stays one lane, holding the newest.
    onChildSpawn(4243)
    expect(killRegistry().keys().filter((key) => key === 'tkt_host')).toHaveLength(1)

    killRegistry().release('tkt_host')
    expect(killRegistry().keys()).not.toContain('tkt_host')
  })
})
