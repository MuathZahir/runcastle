import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  type BuildStepCall,
  type BuildStepOutcome,
  runImageBuild,
  spawnBuildStep,
  tryImageBuildSlot,
  waitForImageBuildSlot,
} from '../src/services/image-build'
import type { ImageBuildPlan, ImageBuildStep } from '../src/services/sandbox-image'

type StepsPlan = Extract<ImageBuildPlan, { steps: ImageBuildStep[] }>

const step = (tag: string): ImageBuildStep => ({
  tag,
  context: tmpdir(),
  dockerfileHash: 'abc',
  buildArgs: { AGENT_UID: '1001' },
  labels: { 'runcastle.claude-code-version': '2.1.0' },
})
const chain: StepsPlan = {
  kind: 'chain',
  projectTag: 'sandcastle:runcastle-p1',
  steps: [step('sandcastle:runcastle'), step('sandcastle:runcastle-p1')],
}

/** A runner that answers each step in turn, printing its lines first. */
function scripted(steps: { lines?: string[]; outcome: BuildStepOutcome }[]) {
  const calls: BuildStepCall[] = []
  const runStep = async (call: BuildStepCall) => {
    const next = steps[calls.length]
    calls.push(call)
    if (!next) throw new Error('more steps than the script holds')
    next.lines?.forEach(call.onLine)
    return next.outcome
  }
  return { calls, runStep }
}

describe('runImageBuild', () => {
  it('runs each step in order with the plan’s tags, labels and args', async () => {
    const { calls, runStep } = scripted([{ outcome: { code: 0 } }, { outcome: { code: 0 } }])

    const result = await runImageBuild(chain, { runtime: 'docker', runStep })

    expect(result).toEqual({ ok: true })
    expect(calls.map((c) => c.command)).toEqual(['docker', 'docker'])
    expect(calls[0]?.args).toEqual([
      'build',
      '-t',
      'sandcastle:runcastle',
      '--label',
      'runcastle.dockerfile-hash=abc',
      '--label',
      'runcastle.claude-code-version=2.1.0',
      '--build-arg',
      'AGENT_UID=1001',
      tmpdir(),
    ])
    expect(calls[1]?.args[2]).toBe('sandcastle:runcastle-p1')
  })

  it('stops at the first failed step and names the last line that reads like a failure', async () => {
    const { calls, runStep } = scripted([
      {
        lines: ['#5 [2/9] RUN apt-get update', 'write /var/lib: no space left on device', 'ERROR: failed to solve', '------'],
        outcome: { code: 1 },
      },
    ])

    const result = await runImageBuild(chain, { runtime: 'docker', runStep })

    expect(calls).toHaveLength(1)
    expect(result).toMatchObject({ ok: false, aborted: false, cause: 'ERROR: failed to solve' })
  })

  it('says the build went quiet rather than reading a cause into its output', async () => {
    const { runStep } = scripted([{ lines: ['#1 pulling'], outcome: { code: null, stopped: 'quiet' } }])

    const result = await runImageBuild(chain, { runtime: 'docker', runStep, quietMs: 600_000 })

    expect(result).toMatchObject({
      ok: false,
      aborted: false,
      cause: 'the build of sandcastle:runcastle printed nothing for 10 minutes and was stopped',
    })
  })

  it('tells a stop from a failure', async () => {
    const { runStep } = scripted([{ outcome: { code: null, stopped: 'aborted' } }])
    expect(await runImageBuild(chain, { runtime: 'podman', runStep })).toMatchObject({ ok: false, aborted: true })
  })

  it('reports a binary that would not run', async () => {
    const { runStep } = scripted([{ outcome: { code: null, spawnError: 'ENOENT' } }])
    expect(await runImageBuild(chain, { runtime: 'docker', runStep })).toMatchObject({
      ok: false,
      cause: 'the build could not start: ENOENT',
    })
  })

  describe('log', () => {
    const dirs: string[] = []
    afterEach(() => {
      for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
    })

    it('writes every line, the commands included, to the log and to onLine', async () => {
      const dir = mkdtempSync(join(tmpdir(), 'runcastle-image-log-'))
      dirs.push(dir)
      const logPath = join(dir, 'nested', 'build.log')
      const { runStep } = scripted([{ lines: ['one', 'two'], outcome: { code: 0 } }, { outcome: { code: 0 } }])
      const heard: string[] = []

      await runImageBuild(chain, { runtime: 'docker', runStep, logPath, onLine: (l) => heard.push(l) })

      const lines = readFileSync(logPath, 'utf8').trim().split('\n')
      expect(lines).toEqual(heard)
      expect(lines[0]).toMatch(/^\$ docker build -t sandcastle:runcastle /)
      expect(lines).toContain('two')
    })

    it('still builds when the log cannot be opened', async () => {
      const dir = mkdtempSync(join(tmpdir(), 'runcastle-image-log-'))
      dirs.push(dir)
      const { runStep } = scripted([{ outcome: { code: 0 } }, { outcome: { code: 0 } }])
      // A directory, so the open fails.
      expect(await runImageBuild(chain, { runtime: 'docker', runStep, logPath: dir })).toEqual({ ok: true })
    })
  })
})

describe('spawnBuildStep', () => {
  const node = process.execPath
  const call = (script: string, over: Partial<BuildStepCall> = {}): BuildStepCall => ({
    command: node,
    args: ['-e', script],
    cwd: tmpdir(),
    quietMs: 30_000,
    onLine: () => {},
    ...over,
  })

  it('streams whole lines from both pipes and resolves with the exit code', async () => {
    const lines: string[] = []
    const outcome = await spawnBuildStep(
      call(`process.stdout.write('a\\nb'); process.stderr.write('c\\n'); process.exitCode = 3`, {
        onLine: (l) => lines.push(l),
      }),
    )
    expect(outcome).toEqual({ code: 3 })
    expect([...lines].sort()).toEqual(['a', 'b', 'c'])
  })

  it('ends a build that goes quiet', async () => {
    const outcome = await spawnBuildStep(call('setTimeout(() => {}, 60000)', { quietMs: 100 }))
    expect(outcome).toEqual({ code: null, stopped: 'quiet' })
  })

  it('ends a build when the run is stopped', async () => {
    const stop = new AbortController()
    const running = spawnBuildStep(call('setTimeout(() => {}, 60000)', { signal: stop.signal }))
    stop.abort()
    expect(await running).toEqual({ code: null, stopped: 'aborted' })
  })

  it('reports a binary that does not exist', async () => {
    const outcome = await spawnBuildStep(call('', { command: 'runcastle-no-such-binary' }))
    expect(outcome.code).toBeNull()
    expect(outcome.spawnError).toBeTruthy()
  })
})

describe('the image build slot', () => {
  it('refuses a second holder until the first lets go', () => {
    const release = tryImageBuildSlot()
    expect(release).not.toBeNull()
    expect(tryImageBuildSlot()).toBeNull()
    release?.()
    const again = tryImageBuildSlot()
    expect(again).not.toBeNull()
    again?.()
  })

  it('hands the slot to waiters in order', async () => {
    const first = await waitForImageBuildSlot()
    const order: string[] = []
    const second = waitForImageBuildSlot().then((release) => {
      order.push('second')
      return release
    })
    const third = waitForImageBuildSlot().then((release) => {
      order.push('third')
      return release
    })

    first()
    ;(await second)()
    ;(await third)()

    expect(order).toEqual(['second', 'third'])
    const free = tryImageBuildSlot()
    expect(free).not.toBeNull()
    free?.()
  })

  it('ignores a second release, which would free someone else’s turn', async () => {
    const first = await waitForImageBuildSlot()
    const second = waitForImageBuildSlot()
    first()
    first()
    expect(tryImageBuildSlot()).toBeNull()
    ;(await second)()
  })

  it('leaves the queue when a waiter is stopped', async () => {
    const first = await waitForImageBuildSlot()
    const stop = new AbortController()
    const stopped = waitForImageBuildSlot(stop.signal)
    const next = waitForImageBuildSlot()

    stop.abort(new Error('stopped'))
    await expect(stopped).rejects.toThrow('stopped')

    first()
    ;(await next)()
  })

  it('rejects at once for a run already stopped', async () => {
    const stop = new AbortController()
    stop.abort(new Error('stopped'))
    await expect(waitForImageBuildSlot(stop.signal)).rejects.toThrow('stopped')
    const free = tryImageBuildSlot()
    expect(free).not.toBeNull()
    free?.()
  })
})
