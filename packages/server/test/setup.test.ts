import { describe, expect, it } from 'vitest'
import type { ExecFn, ExecOutcome } from '../src/doctor/doctor'
import { seedRuntimeFor, terminalSpec, writeGitIdentity } from '../src/services/setup'

/**
 * Issue #50 — the first-run wizard leans on a small, injected setup service: it
 * writes git identity (the wizard's one hard step) and hands the embedded
 * sign-in terminals their exact command. Everything IO is injected so the
 * host is never touched.
 */

/** A stateful fake `git` exec: `config --global KEY V` writes, `--get KEY` reads. */
function gitExec(seed: Record<string, string> = {}): ExecFn {
  const store: Record<string, string> = { ...seed }
  return async (command, args): Promise<ExecOutcome> => {
    if (command !== 'git') return { ok: false, code: null, stdout: '', stderr: 'ENOENT' }
    if (args[0] === 'config' && args[1] === '--global' && args.length === 4) {
      store[args[2]] = args[3]
      return { ok: true, code: 0, stdout: '', stderr: '' }
    }
    if (args[0] === 'config' && args[1] === '--get') {
      const v = store[args[2]]
      return v ? { ok: true, code: 0, stdout: v, stderr: '' } : { ok: true, code: 1, stdout: '', stderr: '' }
    }
    // git identity probe uses `-C cwd config --get KEY`
    if (args[0] === '-C' && args[2] === 'config' && args[3] === '--get') {
      const v = store[args[4]]
      return v ? { ok: true, code: 0, stdout: v, stderr: '' } : { ok: true, code: 1, stdout: '', stderr: '' }
    }
    return { ok: true, code: 0, stdout: '', stderr: '' }
  }
}

describe('writeGitIdentity', () => {
  it('writes user.name and user.email globally and re-probes as ok', async () => {
    const exec = gitExec()
    const probe = await writeGitIdentity(exec, { name: 'Ada Lovelace', email: 'ada@example.com' })
    expect(probe.id).toBe('git-identity')
    expect(probe.status).toBe('ok')
    expect(probe.detail).toContain('Ada Lovelace')
    expect(probe.detail).toContain('ada@example.com')
  })

  it('trims whitespace before writing', async () => {
    const exec = gitExec()
    const probe = await writeGitIdentity(exec, { name: '  Grace  ', email: '  g@h.io  ' })
    expect(probe.detail).toBe('Grace <g@h.io>')
  })

  it('rejects an empty name', async () => {
    await expect(writeGitIdentity(gitExec(), { name: '   ', email: 'a@b.io' })).rejects.toThrow()
  })

  it('rejects an email without an @', async () => {
    await expect(writeGitIdentity(gitExec(), { name: 'Nam', email: 'nope' })).rejects.toThrow()
  })
})

/**
 * Decision 7: onboarding seeds the global defaults from a runtime the operator
 * actually authed — hardcoded Claude defaults are dead values for a Codex-only
 * one, and an operator with both keeps today's behaviour.
 */
describe('seedRuntimeFor', () => {
  it('prefers Claude Code when it is authed, alone or alongside codex', () => {
    expect(seedRuntimeFor(['claude-code'])).toBe('claude-code')
    expect(seedRuntimeFor(['codex', 'claude-code'])).toBe('claude-code')
  })

  it('seeds from codex for a codex-only operator', () => {
    expect(seedRuntimeFor(['codex'])).toBe('codex')
  })

  it('has nothing to seed from when no runtime is ready', () => {
    expect(seedRuntimeFor([])).toBeUndefined()
  })
})

describe('terminalSpec', () => {
  it('runs each runtime own interactive login, the same way for both', () => {
    expect(terminalSpec('claude-login')).toEqual({ cmd: 'claude', args: ['auth', 'login'] })
    expect(terminalSpec('codex-login')).toEqual({ cmd: 'codex', args: ['login'] })
  })
})

