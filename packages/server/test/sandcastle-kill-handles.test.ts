import { describe, expect, it, vi } from 'vitest'

/**
 * The kill-handle half of `patches/@ai-hero%2Fsandcastle@0.12.0.patch`.
 *
 * Aborting a run only interrupts an Effect fiber: sandcastle never kills the
 * container it started, nor the shells its host provider spawns. Runcastle does
 * the killing itself, which it can only do if it knows WHAT to kill — so the
 * patch adds the two handles, and nothing else: `containerName` names the docker
 * container up front (`docker rm -f <name>` needs no discovery), and
 * `onChildSpawn` reports each host child's PID (a fresh one per exec, so a
 * callback is the only workable shape).
 *
 * Like `sandcastle-volume-mount.test.ts`, these drive the compiled providers
 * rather than a re-implementation, because the patch's standing risk is that a
 * `bun install` silently stops applying it. `execFile` is mocked so the docker
 * argv is observable without a container engine; `spawn` is left real, so the
 * host provider's PIDs are PIDs the OS actually handed out.
 */

/** Every `execFile` invocation a provider made, as `[binary, ...args]`. */
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
const { noSandbox } = await import('@ai-hero/sandcastle/sandboxes/no-sandbox')

/** The `create` arguments a real burn passes; only the options under test vary. */
const createOptions = {
  worktreePath: process.cwd(),
  hostRepoPath: process.cwd(),
  mounts: [{ hostPath: process.cwd(), sandboxPath: '/home/agent/workspace' }],
  env: {},
}

/** The `--name` of the `docker run` the provider emitted. */
function containerNameOfDockerRun(): string {
  const run = execFileCalls.find((call) => call[0] === 'docker' && call[1] === 'run')
  if (!run) throw new Error(`no "docker run" was emitted; got ${JSON.stringify(execFileCalls)}`)
  const at = run.indexOf('--name')
  if (at < 0) throw new Error(`"docker run" carried no --name; got ${JSON.stringify(run)}`)
  return run[at + 1] as string
}

describe('sandcastle docker containerName (patched)', () => {
  // The name is the whole handle: `docker rm -f runcastle-<runId>-t<seq>` at
  // abort time works only if the container is running under exactly that name.
  it('runs the container under the caller-supplied name, verbatim', async () => {
    execFileCalls.length = 0
    const provider = docker({
      imageName: 'sandcastle:runcastle',
      containerName: 'runcastle-run_abc123-t7',
    })

    const handle = await provider.create(createOptions)
    await handle.close()

    expect(containerNameOfDockerRun()).toBe('runcastle-run_abc123-t7')
  })

  it('falls back to sandcastle-<uuid> when no name is supplied', async () => {
    execFileCalls.length = 0
    const provider = docker({ imageName: 'sandcastle:runcastle' })

    const handle = await provider.create(createOptions)
    await handle.close()

    expect(containerNameOfDockerRun()).toMatch(/^sandcastle-[0-9a-f-]{36}$/)
  })
})

describe('sandcastle noSandbox onChildSpawn (patched)', () => {
  // A fresh shell per exec is why this is a callback and not a field: runcastle
  // keeps the latest PID, and that is the tree it kills.
  it('reports the PID of every child it spawns', async () => {
    const pids: number[] = []
    const provider = noSandbox({ onChildSpawn: (pid) => pids.push(pid) })
    const handle = await provider.create({ worktreePath: process.cwd(), env: {} })

    await handle.exec('echo runcastle-one')
    await handle.exec('echo runcastle-two')

    expect(pids).toHaveLength(2)
    for (const pid of pids) expect(pid).toBeGreaterThan(0)
    // Distinct children, so the "latest wins" the registry relies on is real.
    expect(pids[0]).not.toBe(pids[1])
  }, 15000)

  it('execs exactly as before when no callback is supplied', async () => {
    const provider = noSandbox()
    const handle = await provider.create({ worktreePath: process.cwd(), env: {} })

    const result = await handle.exec('echo runcastle-unchanged')

    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain('runcastle-unchanged')
  }, 15000)
})
