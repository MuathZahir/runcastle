import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { reviewWalkthroughPath } from '@runcastle/core/paths'
import { describe, expect, it, vi } from 'vitest'
import type { RecorderReapDeps } from '../src/workflows/recorder-reap'
import { reapRecorder, runCommand } from '../src/workflows/recorder-reap'

function deps(overrides: Partial<RecorderReapDeps> = {}): RecorderReapDeps {
  return {
    findBrowser: () => '/bin/agent-browser',
    fileExists: () => true,
    runCommand: async () => true,
    handleReleased: () => true,
    ...overrides,
  }
}

describe('reapRecorder', () => {
  it('stops recording, closes the derived session, and confirms the released handle', async () => {
    const calls: { bin: string; args: readonly string[] }[] = []
    const probes: string[] = []
    const outcome = await reapRecorder('tkt_abc', {
      deps: deps({
        runCommand: async (bin, args) => {
          calls.push({ bin, args })
          return true
        },
        handleReleased: (path) => {
          probes.push(path)
          return true
        },
      }),
    })

    expect(outcome).toEqual({ confirmed: true })
    expect(calls).toEqual([
      { bin: '/bin/agent-browser', args: ['--session', 'review-tkt_abc', 'record', 'stop'] },
      { bin: '/bin/agent-browser', args: ['--session', 'review-tkt_abc', 'close'] },
    ])
    expect(probes).toEqual([reviewWalkthroughPath('tkt_abc')])
  })

  it.each([
    ['agent-browser is absent', { findBrowser: () => undefined }],
    ['the walkthrough is absent', { fileExists: () => false }],
  ] satisfies [string, Partial<RecorderReapDeps>][])('does nothing when %s', async (_label, override) => {
    const runCommand = vi.fn(async () => true)

    await expect(reapRecorder('tkt_none', { deps: deps({ ...override, runCommand }) })).resolves.toEqual({
      confirmed: true,
    })
    expect(runCommand).not.toHaveBeenCalled()
  })

  it('returns unconfirmed at the deadline and leaves a recorder breadcrumb', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const outcome = await reapRecorder('tkt_locked', {
      timeoutMs: 15,
      pollIntervalMs: 1,
      deps: deps({ handleReleased: () => false }),
    })

    expect(outcome).toEqual({ confirmed: false })
    expect(consoleError).toHaveBeenCalledWith(expect.stringContaining('[recorder-reap]'))
    expect(consoleError).toHaveBeenCalledWith(expect.stringContaining('recorder may still be running'))
    consoleError.mockRestore()
  })

  it('never rejects when a dependency throws', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    await expect(reapRecorder('tkt_broken', {
      deps: deps({ runCommand: async () => { throw new Error('boom') } }),
    })).resolves.toEqual({ confirmed: false })
    consoleError.mockRestore()
  })
})

// The real command runner, against the shim npm installs on Windows: a `.CMD`
// that cannot be spawned directly. Before it went through its interpreter, every
// stop/close failed silently with EINVAL and the recording was never finalized.
describe.runIf(process.platform === 'win32')('runCommand against an npm .cmd shim', () => {
  it('runs it, from a path with a space, with its arguments intact', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'rc shim '))
    try {
      const shim = join(dir, 'agent-browser.CMD')
      writeFileSync(shim, '@if "%~1 %~2 %~3 %~4"=="--session review-tkt_abc record stop" (exit /b 0) else (exit /b 9)\r\n')
      expect(await runCommand(shim, ['--session', 'review-tkt_abc', 'record', 'stop'])).toBe(true)
      expect(await runCommand(shim, ['--session', 'review-tkt_abc', 'close'])).toBe(false)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
