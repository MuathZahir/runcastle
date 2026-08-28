import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The `patches/@ai-hero%2Fsandcastle@0.12.0.patch` contract.
 *
 * Sandcastle 0.12.0 resolves every mount's `hostPath` against the host
 * filesystem and refuses one that does not exist, and its provider options have
 * no raw-argument escape hatch — so a Docker/Podman NAMED VOLUME, which has no
 * host path at all and is created on demand by the engine, cannot be mounted.
 * The patch adds a `volume` field that skips host-path resolution and reaches
 * `docker run` as the `-v <name>:<path>` pair the flag already accepts.
 *
 * These tests drive the compiled provider itself rather than a re-implementation
 * of it, because the patch's whole risk is that a `bun install` silently stops
 * applying it. `child_process` is mocked so the argv is observable without a
 * container engine on the machine: that is the seam the patch changes.
 */

/** Every `execFile` invocation the provider made, as `[binary, ...args]`. */
const execFileCalls: string[][] = []

vi.mock('node:child_process', async (importOriginal) => {
  type Callback = (error: Error | null, stdout: string, stderr: string) => void
  const execFile = (file: string, args: string[], ...rest: unknown[]): undefined => {
    execFileCalls.push([file, ...args])
    const callback = rest.find((arg): arg is Callback => typeof arg === 'function')
    // Every docker command a create() makes succeeds with empty output: no
    // container of this name exists, and the image declares no `User`.
    callback?.(null, '', '')
    return undefined
  }
  return { ...(await importOriginal<object>()), execFile, execFileSync: () => '' }
})

const { docker } = await import('@ai-hero/sandcastle/sandboxes/docker')

const SANDBOX_PATH = '/home/agent/cache'

/** The `create` arguments a real burn passes; only the mounts under test vary. */
const createOptions = {
  worktreePath: '/host/workspace',
  hostRepoPath: '/host/workspace',
  mounts: [{ hostPath: '/host/workspace', sandboxPath: '/home/agent/workspace' }],
  env: {},
}

/** The `-v` pairs of the `docker run` the provider emitted. */
function volumeFlagsOfDockerRun(): string[] {
  const run = execFileCalls.find((call) => call[0] === 'docker' && call[1] === 'run')
  if (!run) throw new Error(`no "docker run" was emitted; got ${JSON.stringify(execFileCalls)}`)
  return run.flatMap((arg, i) => (run[i - 1] === '-v' ? [arg] : []))
}

beforeEach(() => {
  execFileCalls.length = 0
})

describe('sandcastle named-volume mounts (patched)', () => {
  // The pair is bare: `:z` on a named volume asks the engine to relabel the
  // volume's entire tree on every container start, which is ruinous for a cache
  // measured in gigabytes and pointless for a volume the engine created itself.
  it('emits a bare -v <volume>:<sandboxPath> for a mount naming a volume', async () => {
    const provider = docker({
      imageName: 'sandcastle:runcastle',
      mounts: [{ volume: 'runcastle-proj_abcdef123456', sandboxPath: SANDBOX_PATH }],
    })

    const handle = await provider.create(createOptions)
    await handle.close()

    expect(volumeFlagsOfDockerRun()).toContain(`runcastle-proj_abcdef123456:${SANDBOX_PATH}`)
  })

  // A volume is engine-managed: there is nothing on the host to stat, and the
  // engine creates it on first use. Unpatched, this throws at `docker()` time.
  it('never checks the host filesystem for a volume mount', () => {
    expect(() =>
      docker({
        imageName: 'sandcastle:runcastle',
        mounts: [{ volume: 'runcastle-volume-that-is-not-a-host-path', sandboxPath: SANDBOX_PATH }],
      }),
    ).not.toThrow()
  })

  it('still rejects a host-path mount whose directory is missing', () => {
    expect(() =>
      docker({
        imageName: 'sandcastle:runcastle',
        mounts: [{ hostPath: '/no/such/directory/runcastle', sandboxPath: SANDBOX_PATH }],
      }),
    ).toThrow(/Mount hostPath does not exist/)
  })

  it('leaves an existing host-path mount formatted exactly as before', async () => {
    const provider = docker({
      imageName: 'sandcastle:runcastle',
      mounts: [{ hostPath: process.cwd(), sandboxPath: '/home/agent/host-cache' }],
    })

    const handle = await provider.create(createOptions)
    await handle.close()

    // `:z` — the SELinux shared label sandcastle applies to every bind mount.
    expect(volumeFlagsOfDockerRun()).toContain(`${process.cwd()}:/home/agent/host-cache:z`)
  })

  it('carries readonly through as a volume mount option', async () => {
    const provider = docker({
      imageName: 'sandcastle:runcastle',
      mounts: [{ volume: 'runcastle-cache', sandboxPath: SANDBOX_PATH, readonly: true }],
    })

    const handle = await provider.create(createOptions)
    await handle.close()

    expect(volumeFlagsOfDockerRun()).toContain(`runcastle-cache:${SANDBOX_PATH}:ro`)
  })
})
