import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { runDoctor, exitCodeFor, type ExecFn, type ExecOutcome, type ProbeResult } from '../src/doctor/doctor'

/**
 * A canned exec: maps `"cmd arg arg"` to an outcome. Anything not in the map is
 * a spawn failure (ENOENT) — i.e. the binary is not installed.
 */
function cannedExec(table: Record<string, Partial<ExecOutcome>>): ExecFn {
  return async (command, args) => {
    const key = [command, ...args].join(' ')
    const hit = table[key]
    if (!hit) return { ok: false, code: null, stdout: '', stderr: 'ENOENT' }
    return { ok: true, code: 0, stdout: '', stderr: '', ...hit }
  }
}

/** The Claude Code version the canned host runs. */
const HOST_CLAUDE = '1.0.0'

const ALL_HEALTHY: Record<string, Partial<ExecOutcome>> = {
  'bun --version': { stdout: '1.3.14' },
  'git --version': { stdout: 'git version 2.45.0' },
  'claude --version': { stdout: `${HOST_CLAUDE} (Claude Code)` },
  'claude auth status': { stdout: '{"loggedIn":true}' },
  'git config --get user.email': { stdout: 'dev@example.com' },
  'git config --get user.name': { stdout: 'Dev' },
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

  // sessions-never-pick-up-a-project-s-api-key, decision 6: a key in the server's own
  // environment (so exported in the shell) is named, never failed on.
  it('notes when sessions will bill an exported API key, without failing the report', async () => {
    const report = await runDoctor({ ...base, sessionEnv: { ANTHROPIC_API_KEY: 'sk-ant-x' }, exec: cannedExec(ALL_HEALTHY) })
    const row = byId(report.results, 'api-key-billing')
    expect(row).toMatchObject({ status: 'api-key', severity: 'info', tier: 1 })
    expect(row.detail).toContain('ANTHROPIC_API_KEY')
    expect(row.detail).not.toContain('sk-ant-x')
    expect(report.ok).toBe(true)
    expect(report.tier1Ok).toBe(true)
  })

  it('names ANTHROPIC_AUTH_TOKEN too, and says the subscription is used when neither is set', async () => {
    const token = await runDoctor({ ...base, sessionEnv: { ANTHROPIC_AUTH_TOKEN: 't' }, exec: cannedExec(ALL_HEALTHY) })
    expect(byId(token.results, 'api-key-billing').detail).toContain('ANTHROPIC_AUTH_TOKEN')
    const none = await runDoctor({ ...base, sessionEnv: { ANTHROPIC_API_KEY: '' }, exec: cannedExec(ALL_HEALTHY) })
    expect(byId(none.results, 'api-key-billing')).toMatchObject({ status: 'ok', detail: 'Sessions use your Claude subscription.' })
  })

  it('reads the session environment, not the worker token file merged into env', async () => {
    // `env` carries ~/.runcastle/.env for the sandbox probes; sessions never see it.
    const report = await runDoctor({ ...base, env: { ...base.env, ANTHROPIC_API_KEY: 'x' }, sessionEnv: {}, exec: cannedExec(ALL_HEALTHY) })
    expect(byId(report.results, 'api-key-billing').status).toBe('ok')
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

  it.each(['linux', 'darwin', 'win32'] as const)(
    'does not ask for Node on %s: a machine without it passes the gate',
    async (platform) => {
      const report = await runDoctor({ ...base, platform, exec: cannedExec(ALL_HEALTHY) })
      expect(report.results.some((r) => r.id === 'node')).toBe(false)
      expect(report.tier1Ok).toBe(true)
    },
  )

  it('names the standalone installer for a CLI that is a Node script with no Node to run it', async () => {
    const table = { ...ALL_HEALTHY }
    delete table['claude --version']
    const report = await runDoctor({
      ...base,
      exec: cannedExec(table),
      needsMissingNode: (bin) => bin === 'claude',
    })
    const claude = byId(report.results, 'claude')
    expect(claude.status).toBe('missing')
    expect(claude.detail).toContain('Node script')
    expect(claude.fix).toContain('https://claude.ai/install.sh')
    // Only that runtime: Codex, also absent here, still reads as simply not installed.
    expect(byId(report.results, 'codex').detail).toContain('not found on PATH')
  })

  it('recommends the standalone Codex installer, not npm', async () => {
    const report = await runDoctor({ ...base, exec: cannedExec(ALL_HEALTHY) })
    const codex = byId(report.results, 'codex')
    expect(codex.fix).toContain('https://chatgpt.com/codex/install.sh')
    expect(codex.fix).not.toContain('npm')
  })

  it('detects unset git identity distinctly from a missing git binary', async () => {
    const table = { ...ALL_HEALTHY }
    delete table['git config --get user.email'] // unset at every level -> exit 1
    const report = await runDoctor({ ...base, exec: cannedExec(table) })
    expect(byId(report.results, 'git').status).toBe('ok')
    expect(byId(report.results, 'git-identity').status).toBe('unset')
  })

  })

describe('runDoctor — per-runtime readiness with conditional severity', () => {
  const base = {
    env: { CLAUDE_CODE_OAUTH_TOKEN: 'sk-oauth-xxx' },
    platform: 'linux' as const,
    fileExists: () => false,
  }

  // Codex workers borrow the login `codex login` wrote (decision 4), so the login
  // IS the AFK credential — a third row asking for an API key would sell the
  // operator the setup step this feature exists to remove.
  it('reports codex as two checks and claude as two, tagged with runtime and question', async () => {
    const report = await runDoctor({ ...base, exec: cannedExec(ALL_HEALTHY) })
    const codex = report.results.filter((r) => r.runtime === 'codex')
    expect(codex.map((r) => r.check)).toEqual(['binary', 'auth'])
    const claude = report.results.filter((r) => r.runtime === 'claude-code')
    expect(claude.map((r) => r.check)).toEqual(['binary', 'auth'])
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

})

describe('runDoctor — codex login is decided by the credentials file', () => {
  const base = {
    env: { CLAUDE_CODE_OAUTH_TOKEN: 'sk-oauth-xxx' },
    platform: 'linux' as const,
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
    // gets that the CLI and the round see different things.
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

/**
 * The doctor used to stat a Dockerfile path hand-built from its own bundle dir
 * (`../assets/sandcastle/Dockerfile`). That file is there in a contributor
 * checkout and nowhere in a published install, where the template is vendored as
 * `<pkgRoot>/sandcastle-template` — so `bun add -g runcastle` got an ENOENT out
 * of the tRPC doctor query and a home page stuck on "loading projects…".
 */
describe('runDoctor — no container runtime', () => {
  it('reports a machine without Docker as healthy and has no container probes', async () => {
    const report = await runDoctor({
      env: {},
      platform: 'linux',
      exec: cannedExec(ALL_HEALTHY),
    })
    expect(report.ok).toBe(true)
    const ids = report.results.map((r) => r.id)
    for (const gone of ['container-runtime', 'image', 'afk-token', 'burn-user', 'burn-cache']) {
      expect(ids).not.toContain(gone)
    }
  })
})

describe('exitCodeFor — gate vs diagnostic', () => {
  const base = {
    env: { CLAUDE_CODE_OAUTH_TOKEN: 'sk-oauth-xxx' },
    platform: 'linux' as const,
  }

  it('gate mode passes when only Tier-2/warning checks fail', async () => {
    const table = { ...ALL_HEALTHY }
    delete table['claude auth status'] // Tier-2 unhealthy only
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