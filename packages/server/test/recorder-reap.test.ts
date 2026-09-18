import { reviewWalkthroughPath } from '@runcastle/core/paths'
import { describe, expect, it, vi } from 'vitest'
import type { RecorderReapDeps } from '../src/workflows/recorder-reap'
import { reapRecorder } from '../src/workflows/recorder-reap'

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
