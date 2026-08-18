import { existsSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import type { ExecFn, ExecOutcome } from '../src/doctor/doctor'
import {
  CODEX_API_KEY,
  createCredentialVerifier,
  resolveRuntime,
  resolveSandcastleBin,
  runtimeInstallGuide,
  saveAfkCredential,
  seedRuntimeFor,
  terminalSpec,
  upsertEnvVar,
  writeGitIdentity,
  type AfkTokenIo,
} from '../src/services/setup'

/**
 * Issue #50 — the first-run wizard + Enable-AFK card lean on a small, injected
 * setup service: it writes git identity (the wizard's one hard step), captures
 * the AFK token into the data-dir env file with a validity check, and hands the
 * embedded-terminal flows their exact command. Everything IO is injected so the
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

describe('upsertEnvVar', () => {
  it('appends to an empty file with a trailing newline', () => {
    expect(upsertEnvVar('', 'CLAUDE_CODE_OAUTH_TOKEN', 'sk-1')).toBe('CLAUDE_CODE_OAUTH_TOKEN=sk-1\n')
  })

  it('replaces an existing value, preserving other lines', () => {
    const before = '# comment\nOTHER=keep\nCLAUDE_CODE_OAUTH_TOKEN=old\n'
    const after = upsertEnvVar(before, 'CLAUDE_CODE_OAUTH_TOKEN', 'new')
    expect(after).toContain('OTHER=keep')
    expect(after).toContain('CLAUDE_CODE_OAUTH_TOKEN=new')
    expect(after).not.toContain('=old')
    expect(after).not.toContain('# comment\n# comment')
  })

  it('tolerates a leading `export ` on the existing line', () => {
    const after = upsertEnvVar('export CLAUDE_CODE_OAUTH_TOKEN=old\n', 'CLAUDE_CODE_OAUTH_TOKEN', 'new')
    expect(after).toBe('export CLAUDE_CODE_OAUTH_TOKEN=new\n')
  })

  it('appends without duplicating the trailing newline', () => {
    const after = upsertEnvVar('OTHER=1\n', 'CLAUDE_CODE_OAUTH_TOKEN', 'x')
    expect(after).toBe('OTHER=1\nCLAUDE_CODE_OAUTH_TOKEN=x\n')
  })
})

describe('saveAfkCredential', () => {
  function io(over: Partial<AfkTokenIo> & { seed?: string } = {}): AfkTokenIo & { written: () => string } {
    let content = over.seed ?? ''
    return {
      read: over.read ?? (() => content),
      write: over.write ?? ((c) => (content = c)),
      verify: over.verify ?? (async () => ({ valid: true, detail: 'token accepted' })),
      written: () => content,
    }
  }

  it('captures the token into the env file and reports the validity result', async () => {
    const deps = io()
    const res = await saveAfkCredential(deps, '  sk-ant-oat01-abc  ')
    expect(deps.written()).toBe('CLAUDE_CODE_OAUTH_TOKEN=sk-ant-oat01-abc\n')
    expect(res.valid).toBe(true)
    expect(res.detail).toBe('token accepted')
  })

  // Codex burns authenticate with an OpenAI API key, in the SAME env file the
  // Claude token lives in — one place for the operator to look, one for the
  // burner to read.
  it('captures a codex API key under CODEX_API_KEY, beside the claude token', async () => {
    const deps = io({ seed: 'CLAUDE_CODE_OAUTH_TOKEN=sk-ant-oat01-abc\n' })
    await saveAfkCredential(deps, 'sk-openai-abcdefgh', 'codex')
    expect(deps.written()).toContain('CLAUDE_CODE_OAUTH_TOKEN=sk-ant-oat01-abc')
    expect(deps.written()).toContain(`${CODEX_API_KEY}=sk-openai-abcdefgh`)
  })

  it('still saves but reports invalid when the live check rejects it', async () => {
    const deps = io({ verify: async () => ({ valid: false, detail: 'rejected by API' }) })
    const res = await saveAfkCredential(deps, 'sk-bad')
    expect(deps.written()).toContain('CLAUDE_CODE_OAUTH_TOKEN=sk-bad')
    expect(res.valid).toBe(false)
    expect(res.detail).toBe('rejected by API')
  })

  it('rejects an empty credential without touching the file, naming the runtime', async () => {
    let touched = false
    const deps = io({ write: () => (touched = true) })
    await expect(saveAfkCredential(deps, '   ')).rejects.toThrow()
    await expect(saveAfkCredential(deps, '  ', 'codex')).rejects.toThrow(/API key/)
    expect(touched).toBe(false)
  })

  it('rejects a token with an embedded newline without touching the file', async () => {
    let touched = false
    const deps = io({ write: () => (touched = true) })
    await expect(saveAfkCredential(deps, 'sk-ant-oat01-abc\nOTHER=evil')).rejects.toThrow()
    expect(touched).toBe(false)
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

/**
 * The verify step's verdict is the only feedback onboarding gives, so each
 * failure must be distinguishable and carry its own next step. The regression
 * this guards: a spawn failure (`ok:false` — a PATH the server can't see) and a
 * non-zero exit (`claude` ran and refused) both rendered as the same dead-end
 * "claude CLI not found", with no fix line and no hint the token was saved.
 */
describe('createCredentialVerifier', () => {
  const version = (out: Partial<ExecOutcome>): ExecFn => async () => ({
    ok: true,
    code: 0,
    stdout: '',
    stderr: '',
    ...out,
  })

  it('accepts a plausible token when claude runs', async () => {
    const res = await createCredentialVerifier(version({ stdout: '2.0.1' }))('sk-ant-oat01-abcdefgh')
    expect(res.valid).toBe(true)
    expect(res.fix).toBeUndefined()
  })

  it('blames PATH — not a missing install — when claude cannot be spawned', async () => {
    const res = await createCredentialVerifier(version({ ok: false, code: null, stderr: 'ENOENT' }))(
      'sk-ant-oat01-abcdefgh',
    )
    expect(res.valid).toBe(false)
    expect(res.detail).toContain('PATH')
    // The token IS on disk — the user must not be told to paste it again.
    expect(res.detail).toContain('~/.runcastle/.env')
    expect(res.fix).toContain('RUNCASTLE_CLAUDE_BIN')
  })

  it('reports a broken install distinctly when claude runs but exits non-zero', async () => {
    const res = await createCredentialVerifier(version({ code: 1, stderr: 'bad install\nmore' }))(
      'sk-ant-oat01-abcdefgh',
    )
    expect(res.valid).toBe(false)
    expect(res.detail).toContain('exited 1')
    expect(res.detail).toContain('bad install')
    // Distinct from the not-found case — opposite fix.
    expect(res.detail).not.toContain('PATH')
  })

  it('flags a too-short token without needing claude at all', async () => {
    let spawned = false
    const exec: ExecFn = async () => {
      spawned = true
      return { ok: true, code: 0, stdout: '', stderr: '' }
    }
    const res = await createCredentialVerifier(exec)('short')
    expect(res.valid).toBe(false)
    expect(res.detail).toContain('malformed')
    expect(spawned).toBe(false)
  })

  // The same verdicts for codex, spoken in codex's terms: its binary is what
  // gets probed, and its own override is what pins the path.
  it('verifies a codex key against the codex CLI, with codex wording', async () => {
    let probed = ''
    const exec: ExecFn = async (command) => {
      probed = command
      return { ok: false, code: null, stdout: '', stderr: 'ENOENT' }
    }
    const res = await createCredentialVerifier(exec, 'codex')('sk-openai-abcdefgh')
    expect(probed).toBe('codex')
    expect(res.valid).toBe(false)
    expect(res.detail).toContain('API key')
    expect(res.fix).toContain('RUNCASTLE_CODEX_BIN')
  })
})

describe('runtimeInstallGuide', () => {
  it('gives winget for Windows and mentions the machine init', () => {
    const g = runtimeInstallGuide('win32')
    expect(g.command).toContain('winget')
    expect(`${g.command} ${g.note}`).toContain('podman machine')
  })

  it('gives an apt/dnf command for Linux', () => {
    const g = runtimeInstallGuide('linux')
    expect(g.command.toLowerCase()).toMatch(/apt|dnf|pacman/)
  })

  it('gives a macOS install command', () => {
    const g = runtimeInstallGuide('darwin')
    expect(g.command.length).toBeGreaterThan(0)
  })
})

describe('terminalSpec', () => {
  it('runs `claude setup-token` for the token flow', () => {
    expect(terminalSpec('setup-token', { runtime: 'docker', imageName: 'sandcastle:runcastle' })).toEqual({
      cmd: 'claude',
      args: ['setup-token'],
    })
  })

  it('runs each runtime own interactive login, the same way for both', () => {
    const opts = { runtime: 'docker' as const, imageName: 'sandcastle:runcastle' }
    expect(terminalSpec('claude-login', opts)).toEqual({ cmd: 'claude', args: ['auth', 'login'] })
    expect(terminalSpec('codex-login', opts)).toEqual({ cmd: 'codex', args: ['login'] })
  })

  it('launches the resolved sandcastle CLI under node with a pinned image name', () => {
    // The vendored CLI is a transitive dep never on PATH in a global install, so
    // build-image runs `node <resolved-cli> <runtime> build-image …`, not a bare
    // `sandcastle`.
    const sandcastleBin = '/opt/rc/node_modules/@ai-hero/sandcastle/dist/main.js'
    expect(
      terminalSpec('build-image', { runtime: 'podman', imageName: 'sandcastle:runcastle', sandcastleBin }),
    ).toEqual({
      cmd: 'node',
      args: [sandcastleBin, 'podman', 'build-image', '--image-name', 'sandcastle:runcastle'],
    })
  })

  it('fails loudly when the bundled sandcastle CLI cannot be resolved', () => {
    expect(() =>
      terminalSpec('build-image', { runtime: 'docker', imageName: 'sandcastle:runcastle' }),
    ).toThrow(/sandcastle CLI/)
  })
})

describe('resolveSandcastleBin', () => {
  it('resolves the bundled @ai-hero/sandcastle CLI to a real file via module resolution', () => {
    // The regression this guards: sandcastle is a transitive dep, so its bin is
    // never on PATH in a `bun add -g runcastle` install. Module resolution finds
    // it regardless of hoisting — the same path the build-image flow launches.
    const bin = resolveSandcastleBin()
    expect(bin).not.toBeNull()
    expect(bin).toMatch(/sandcastle/)
    expect(existsSync(bin as string)).toBe(true)
  })
})

describe('resolveRuntime', () => {
  /** A fake exec where only the named runtimes answer `--version` with code 0. */
  function present(...bins: string[]): ExecFn {
    return async (command): Promise<ExecOutcome> =>
      bins.includes(command)
        ? { ok: true, code: 0, stdout: `${command} 1.0`, stderr: '' }
        : { ok: false, code: null, stdout: '', stderr: 'ENOENT' }
  }

  it('keeps the preferred runtime when it is installed', async () => {
    expect(await resolveRuntime(present('podman'), 'podman')).toBe('podman')
  })

  it('falls back to the other runtime when the preferred one is missing', async () => {
    expect(await resolveRuntime(present('docker'), 'podman')).toBe('docker')
  })

  it('returns the preference as a last resort when neither is present', async () => {
    expect(await resolveRuntime(present(), 'docker')).toBe('docker')
  })
})
