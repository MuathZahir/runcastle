import { describe, expect, it } from 'vitest'
import { isOlderVersion, minimumCliVersion, type ReadPackageJson } from '../src/doctor/adapter-requirements'
import { runDoctor, type ExecFn } from '../src/doctor/doctor'
import { formatReport } from '../src/doctor/report'

describe('minimumCliVersion', () => {
  it('reads Codex from the adapter dependency range', () => {
    const read: ReadPackageJson = (name) =>
      name === '@agentclientprotocol/codex-acp'
        ? { dir: '/x', json: { dependencies: { '@openai/codex': '^0.164.0' } } }
        : null
    expect(minimumCliVersion('codex', read)).toBe('0.164.0')
  })

  it('reads Claude Code from the SDK the adapter resolves, looked up from the adapter dir', () => {
    const seen: Array<string | undefined> = []
    const read: ReadPackageJson = (name, from) => {
      seen.push(from)
      if (name === '@agentclientprotocol/claude-agent-acp') return { dir: '/adapter', json: {} }
      if (name === '@anthropic-ai/claude-agent-sdk') return { dir: '/sdk', json: { version: '0.3.310', claudeCodeVersion: '2.1.281' } }
      return null
    }
    expect(minimumCliVersion('claude-code', read)).toBe('2.1.281')
    expect(seen).toContain('/adapter')
  })

  it('has no floor when the packages are unreadable', () => {
    expect(minimumCliVersion('codex', () => null)).toBeNull()
    expect(minimumCliVersion('claude-code', () => null)).toBeNull()
  })

  it('reads the real installed codex-acp pin', () => {
    expect(minimumCliVersion('codex')).toMatch(/^\d+\.\d+\.\d+$/)
  })
})

describe('isOlderVersion', () => {
  it('compares numerically', () => {
    expect(isOlderVersion('0.9.0', '0.164.0')).toBe(true)
    expect(isOlderVersion('2.1.280', '2.1.281')).toBe(true)
    expect(isOlderVersion('2.1.281', '2.1.281')).toBe(false)
    expect(isOlderVersion('2.2.0', '2.1.999')).toBe(false)
  })
})

describe('doctor adapter-version rows', () => {
  const exec = (table: Record<string, string>): ExecFn => async (command, args) => {
    const out = table[[command, ...args].join(' ')]
    return out === undefined
      ? { ok: false, code: null, stdout: '', stderr: 'ENOENT' }
      : { ok: true, code: 0, stdout: out, stderr: '' }
  }
  const minimumCliVersion = (runtime: string) => (runtime === 'codex' ? '0.164.0' : '2.1.281')

  it('warns, naming installed and needed versions, when a CLI is older than the adapter needs', async () => {
    const report = await runDoctor({
      exec: exec({ 'claude --version': '2.1.200 (Claude Code)', 'codex --version': 'codex-cli 0.150.0' }),
      runtimes: ['claude-code', 'codex'],
      minimumCliVersion,
    })
    const codex = report.results.find((r) => r.id === 'codex-adapter-version')
    const claude = report.results.find((r) => r.id === 'claude-adapter-version')
    expect(codex).toMatchObject({ status: 'stale', tier: 2 })
    expect(codex?.detail).toContain('0.150.0')
    expect(codex?.detail).toContain('0.164.0')
    expect(codex?.fix).toContain('Update Codex to 0.164.0 or newer')
    expect(claude?.detail).toContain('2.1.200')
    expect(claude?.fix).toContain('Update Claude Code to 2.1.281 or newer')
    expect(formatReport(report)).toContain('Update Codex to 0.164.0 or newer')
  })

  it('is ok for a new enough CLI and silent for a missing one', async () => {
    const report = await runDoctor({
      exec: exec({ 'claude --version': '2.1.281 (Claude Code)' }),
      runtimes: ['claude-code'],
      minimumCliVersion,
    })
    expect(report.results.find((r) => r.id === 'claude-adapter-version')?.status).toBe('ok')
    expect(report.results.find((r) => r.id === 'codex-adapter-version')).toBeUndefined()
  })
})
