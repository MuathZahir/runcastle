import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  runDoctor,
  exitCodeFor,
  type ExecFn,
  type ExecOutcome,
  type ProbeResult,
} from '../src/doctor/doctor'

/**
 * A canned exec: maps `"cmd arg arg"` to an outcome. Anything not in the map is
 * a spawn failure (ENOENT) — i.e. the binary is not installed. This lets each
 * test describe an exact host environment without touching the real machine.
 */
function cannedExec(table: Record<string, Partial<ExecOutcome>>): ExecFn {
  return async (command, args) => {
    const key = [command, ...args].join(' ')
    const hit = table[key]
    if (!hit) return { ok: false, code: null, stdout: '', stderr: 'ENOENT' }
    return { ok: true, code: 0, stdout: '', stderr: '', ...hit }
  }
}

const ALL_HEALTHY: Record<string, Partial<ExecOutcome>> = {
  'bun --version': { stdout: '1.3.14' },
  'node --version': { stdout: 'v22.0.0' },
  'git --version': { stdout: 'git version 2.45.0' },
  'claude --version': { stdout: '1.0.0' },
  'claude auth status': { stdout: '{"loggedIn":true}' },
  'git config --get user.email': { stdout: 'dev@example.com' },
  'git config --get user.name': { stdout: 'Dev' },
  'docker --version': { stdout: 'Docker version 27.0.0' },
  'docker info': { stdout: 'Server: ...' },
  'docker image inspect --format {{.Created}} sandcastle:runcastle': {
    stdout: '2030-01-01T12:00:00Z',
  },
}

function byId(results: ProbeResult[], id: string): ProbeResult {
  const hit = results.find((r) => r.id === id)
  if (!hit) throw new Error(`no probe ${id}`)
  return hit
}

describe('runDoctor — canned environments', () => {
  const base = {
    env: { CLAUDE_CODE_OAUTH_TOKEN: 'sk-oauth-xxx' },
    platform: 'linux' as const,
    imageName: 'sandcastle:runcastle',
    fileMtime: () => new Date('2026-08-18T12:00:00Z'),
  }

  it('reports every probe healthy on a fully-provisioned host', async () => {
    const report = await runDoctor({ ...base, exec: cannedExec(ALL_HEALTHY) })
    // Codex is not installed here and no configured model runs on it, so its
    // probes ride along as `info` — they say what was found without failing.
    expect(report.results.filter((r) => r.severity === 'error').every((r) => r.status === 'ok')).toBe(
      true,
    )
    expect(report.ok).toBe(true)
    expect(report.tier1Ok).toBe(true)
  })

  it('every probe carries a label and an actionable fix line when not ok', async () => {
    const report = await runDoctor({ ...base, exec: cannedExec({}) })
    for (const r of report.results) {
      expect(r.label.length).toBeGreaterThan(0)
      if (r.status !== 'ok') expect(r.fix && r.fix.length).toBeTruthy()
    }
  })

  it('classifies a missing Tier-1 binary as missing (not-installed)', async () => {
    const table = { ...ALL_HEALTHY }
    delete table['git --version']
    const report = await runDoctor({ ...base, exec: cannedExec(table) })
    expect(byId(report.results, 'git').status).toBe('missing')
    expect(report.tier1Ok).toBe(false)
  })

  it('distinguishes a dead docker daemon from a missing binary', async () => {
    const table = { ...ALL_HEALTHY }
    delete table['docker info'] // CLI present, daemon not responding
    const report = await runDoctor({ ...base, exec: cannedExec(table) })
    const c = byId(report.results, 'container-runtime')
    expect(c.status).toBe('daemon-dead')
    expect(c.status).not.toBe('missing')
  })

  it('classifies a stopped podman machine as its own state', async () => {
    // Docker absent entirely; podman CLI present but its machine is not started.
    const table: Record<string, Partial<ExecOutcome>> = {
      ...ALL_HEALTHY,
      'podman --version': { stdout: 'podman version 5.0.0' },
    }
    delete table['docker --version']
    delete table['docker info']
    delete table['docker image inspect sandcastle:runcastle']
    // podman info returns non-zero -> machine not initialized/started
    const report = await runDoctor({ ...base, exec: cannedExec(table) })
    const c = byId(report.results, 'container-runtime')
    expect(c.status).toBe('machine-stopped')
    expect(c.fix).toMatch(/podman machine/i)
  })

  it('flags a container runtime that is completely absent as missing', async () => {
    const table = { ...ALL_HEALTHY }
    delete table['docker --version']
    delete table['docker info']
    delete table['docker image inspect sandcastle:runcastle']
    const report = await runDoctor({ ...base, exec: cannedExec(table) })
    expect(byId(report.results, 'container-runtime').status).toBe('missing')
  })

  it('detects unset git identity distinctly from a missing git binary', async () => {
    const table = { ...ALL_HEALTHY }
    delete table['git config --get user.email'] // unset at every level -> exit 1
    const report = await runDoctor({ ...base, exec: cannedExec(table) })
    expect(byId(report.results, 'git').status).toBe('ok')
    expect(byId(report.results, 'git-identity').status).toBe('unset')
  })

  it('reports a missing AFK token from the injected env, without spawning', async () => {
    const report = await runDoctor({
      ...base,
      env: {}, // no CLAUDE_CODE_OAUTH_TOKEN
      exec: cannedExec(ALL_HEALTHY),
    })
    expect(byId(report.results, 'afk-token').status).toBe('unset')
  })

  it('reports a missing sandcastle image when inspect fails', async () => {
    const table = { ...ALL_HEALTHY }
    delete table['docker image inspect --format {{.Created}} sandcastle:runcastle']
    const report = await runDoctor({ ...base, exec: cannedExec(table) })
    expect(byId(report.results, 'sandcastle-image').status).toBe('missing')
  })

  it('reports a sandcastle image as stale when the burner Dockerfile is newer', async () => {
    const table = {
      ...ALL_HEALTHY,
      'docker image inspect --format {{.Created}} sandcastle:runcastle': {
        stdout: '2026-08-20T12:00:00Z',
      },
    }
    const report = await runDoctor({
      ...base,
      exec: cannedExec(table),
      fileMtime: () => new Date('2026-08-21T12:00:00Z'),
    })
    const image = byId(report.results, 'sandcastle-image')
    expect(image.status).toBe('stale')
    expect(image.severity).toBe('error')
    expect(image.detail).toBe(
      'sandcastle:runcastle built 2026-08-20, burner Dockerfile changed 2026-08-21 — rebuild',
    )
    // Names the settings page the web deep-links from (decision 9).
    expect(image.fix).toBe('Open Settings → Burns (Rebuild image).')
    expect(report.ok).toBe(false)
  })
})

/**
 * Per-runtime readiness (decision 6). Both runtimes are always probed; a
 * runtime's gaps are only an ERROR when some configured model resolves to it,
 * so a Claude-only operator is never nagged about a Codex CLI they will never
 * run, and a Codex-only one is told plainly what is missing.
 */
describe('runDoctor — per-runtime readiness with conditional severity', () => {
  const base = {
    env: { CLAUDE_CODE_OAUTH_TOKEN: 'sk-oauth-xxx' },
    platform: 'linux' as const,
    imageName: 'sandcastle:runcastle',
    fileExists: () => false,
  }

  // Codex burns borrow the login `codex login` wrote (decision 4), so the login
  // IS the AFK credential — a third row asking for an API key would sell the
  // operator the setup step this feature exists to remove.
  it('reports codex as two checks and claude as three, tagged with runtime and question', async () => {
    const report = await runDoctor({ ...base, exec: cannedExec(ALL_HEALTHY) })
    const codex = report.results.filter((r) => r.runtime === 'codex')
    expect(codex.map((r) => r.check)).toEqual(['binary', 'auth'])
    const claude = report.results.filter((r) => r.runtime === 'claude-code')
    expect(claude.map((r) => r.check)).toEqual(['binary', 'auth', 'afk-key'])
    expect(report.results.some((r) => r.id === 'codex-api-key')).toBe(false)
  })

  it('stays green when codex is absent and nothing is configured to run on it', async () => {
    const report = await runDoctor({ ...base, exec: cannedExec(ALL_HEALTHY) })
    const codexCli = byId(report.results, 'codex')
    expect(codexCli.status).toBe('missing')
    expect(codexCli.severity).toBe('info')
    expect(report.ok).toBe(true)
    expect(exitCodeFor(report, 'diagnostic')).toBe(0)
  })

  it('turns the same absence into an error once a codex model is configured', async () => {
    const report = await runDoctor({
      ...base,
      runtimes: ['claude-code', 'codex'],
      exec: cannedExec(ALL_HEALTHY),
    })
    const codexCli = byId(report.results, 'codex')
    expect(codexCli.severity).toBe('error')
    expect(codexCli.status).toBe('missing')
    expect(codexCli.fix).toMatch(/install/i)
    expect(report.ok).toBe(false)
    expect(report.tier1Ok).toBe(false)
  })

  it('leaves the claude probes informational for a codex-only operator', async () => {
    const table = { ...ALL_HEALTHY }
    delete table['claude --version']
    delete table['claude auth status']
    const report = await runDoctor({
      ...base,
      runtimes: ['codex'],
      fileExists: (p) => p.endsWith('auth.json'),
      exec: cannedExec({ ...table, 'codex --version': {}, 'codex login status': {} }),
    })
    expect(byId(report.results, 'claude').severity).toBe('info')
    expect(byId(report.results, 'afk-token').severity).toBe('info')
    expect(byId(report.results, 'codex').status).toBe('ok')
    expect(byId(report.results, 'codex-auth').status).toBe('ok')
    // A codex-only operator who ran `codex login` is done — nothing else to set up.
    expect(report.ok).toBe(true)
  })

  it('reports a logged-out runtime distinctly from a missing one, with its login command', async () => {
    const report = await runDoctor({
      ...base,
      runtimes: ['claude-code', 'codex'],
      exec: cannedExec({
        ...ALL_HEALTHY,
        'claude auth status': { code: 1, stdout: '{"loggedIn":false}' },
        'codex --version': {},
        'codex login status': { code: 1, stdout: 'Not logged in' },
      }),
    })
    const claudeAuth = byId(report.results, 'claude-auth')
    expect(claudeAuth.status).toBe('unset')
    expect(claudeAuth.fix).toContain('claude auth login')
    const codexAuth = byId(report.results, 'codex-auth')
    expect(codexAuth.status).toBe('unset')
    expect(codexAuth.fix).toContain('codex login')
    // Login is a Tier-2 warning: the wizard that fixes it lives inside the app,
    // so a logged-out runtime must never hard-stop the boot gate.
    expect(report.tier1Ok).toBe(true)
  })

  it('reads the claude AFK token from its own env var', async () => {
    const report = await runDoctor({
      ...base,
      env: {},
      runtimes: ['claude-code', 'codex'],
      exec: cannedExec(ALL_HEALTHY),
    })
    const claudeKey = byId(report.results, 'afk-token')
    expect(claudeKey.status).toBe('unset')
    expect(claudeKey.detail).toContain('CLAUDE_CODE_OAUTH_TOKEN')
  })
})

/**
 * Decision 4: `auth.json` at the Codex home is the artifact every surface
 * borrows — the launcher copies it into a session's home, a burn copies it out
 * of a read-only mount — so its presence, not what `codex login status` says, is
 * what "Codex ready" means. Anything else lets the doctor call a host ready that
 * a burn then refuses to run on.
 */
describe('runDoctor — codex login is decided by the credentials file', () => {
  const base = {
    env: { CLAUDE_CODE_OAUTH_TOKEN: 'sk-oauth-xxx' },
    platform: 'linux' as const,
    imageName: 'sandcastle:runcastle',
    runtimes: ['codex'] as const,
  }
  const withStatus = (status: Partial<ExecOutcome>) =>
    cannedExec({ ...ALL_HEALTHY, 'codex --version': {}, 'codex login status': status })

  it('is ok when the file is there even though `codex login status` says logged out', async () => {
    const report = await runDoctor({
      ...base,
      exec: withStatus({ code: 1, stdout: 'Not logged in' }),
      fileExists: (p) => p.endsWith('auth.json'),
    })
    const auth = byId(report.results, 'codex-auth')
    expect(auth.status).toBe('ok')
    // The disagreement is reported, not hidden — it is the only clue an operator
    // gets that the CLI and the burn see different things.
    expect(auth.detail).toContain('auth.json')
    expect(auth.detail).toContain('codex login status')
    expect(report.ok).toBe(true)
  })

  it('is not ok when the file is absent even though `codex login status` exits 0', async () => {
    const report = await runDoctor({ ...base, exec: withStatus({}), fileExists: () => false })
    const auth = byId(report.results, 'codex-auth')
    expect(auth.status).toBe('unset')
    expect(auth.detail).toContain('auth.json')
    expect(auth.fix).toContain('codex login')
    // The one setup step is the login — never a credential to paste.
    expect(auth.fix).not.toContain('CODEX_API_KEY')
    expect(report.ok).toBe(false)
  })

  it('still decides by the file when the CLI is too old for `login status`', async () => {
    const exec = withStatus({ code: 1, stderr: "error: unrecognized subcommand 'status'" })
    const authed = await runDoctor({ ...base, exec, fileExists: (p) => p.endsWith('auth.json') })
    expect(byId(authed.results, 'codex-auth').status).toBe('ok')

    const loggedOut = await runDoctor({ ...base, exec, fileExists: () => false })
    expect(byId(loggedOut.results, 'codex-auth').status).toBe('unset')
    expect(byId(loggedOut.results, 'codex-auth').detail).toContain('auth.json')
  })

  it('honours CODEX_HOME when deciding where the credentials live', async () => {
    const looked: string[] = []
    const report = await runDoctor({
      ...base,
      env: { CODEX_HOME: '/custom/codex' },
      exec: withStatus({}),
      fileExists: (p) => {
        looked.push(p)
        return false
      },
    })
    expect(looked).toContain(join('/custom/codex', 'auth.json'))
    expect(byId(report.results, 'codex-auth').status).toBe('unset')
  })
})

describe('exitCodeFor — gate vs diagnostic', () => {
  const base = {
    env: { CLAUDE_CODE_OAUTH_TOKEN: 'sk-oauth-xxx' },
    platform: 'linux' as const,
    imageName: 'sandcastle:runcastle',
  }

  it('gate mode passes when only Tier-2/warning checks fail', async () => {
    const table = { ...ALL_HEALTHY }
    delete table['docker info'] // Tier-2 unhealthy only
    const report = await runDoctor({ ...base, exec: cannedExec(table) })
    expect(exitCodeFor(report, 'gate')).toBe(0)
    // ...but diagnostic mode reflects the degraded overall health.
    expect(exitCodeFor(report, 'diagnostic')).not.toBe(0)
  })

  it('gate mode fails when a Tier-1 binary is missing', async () => {
    const table = { ...ALL_HEALTHY }
    delete table['bun --version']
    const report = await runDoctor({ ...base, exec: cannedExec(table) })
    expect(exitCodeFor(report, 'gate')).not.toBe(0)
    expect(exitCodeFor(report, 'diagnostic')).not.toBe(0)
  })

  it('both modes pass a fully-healthy host', async () => {
    const report = await runDoctor({ ...base, exec: cannedExec(ALL_HEALTHY) })
    expect(exitCodeFor(report, 'gate')).toBe(0)
    expect(exitCodeFor(report, 'diagnostic')).toBe(0)
  })
})
