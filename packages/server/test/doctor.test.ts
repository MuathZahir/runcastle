import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  runDoctor,
  exitCodeFor,
  type ExecFn,
  type ExecOutcome,
  type ProbeResult,
  type ProjectImageEnv,
} from '../src/doctor/doctor'
import {
  ASSET_ENV,
  applyInstalledAssetEnv,
  sandcastleTemplateDir,
} from '../src/launcher/asset-paths'
import { DOCKERFILE_HASH_LABEL } from '../src/services/sandbox-image'

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

/** The sha256 of the stock burner Dockerfile, as the fake hash reader reports it. */
const STOCK_HASH = 'a'.repeat(64)

/** The canned-exec key for the label read the image probe makes (decision 4). */
function inspectKey(runtime: 'docker' | 'podman', tag: string): string {
  return `${runtime} image inspect --format {{index .Config.Labels "${DOCKERFILE_HASH_LABEL}"}} ${tag}`
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
  [inspectKey('docker', 'sandcastle:runcastle')]: { stdout: STOCK_HASH },
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
    dockerfileHash: () => STOCK_HASH,
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
    delete table[inspectKey('docker', 'sandcastle:runcastle')]
    const report = await runDoctor({ ...base, exec: cannedExec(table) })
    expect(byId(report.results, 'sandcastle-image').status).toBe('missing')
  })

  it('reports a sandcastle image as stale when its hash label is not the Dockerfile’s', async () => {
    const table = {
      ...ALL_HEALTHY,
      [inspectKey('docker', 'sandcastle:runcastle')]: { stdout: 'b'.repeat(64) },
    }
    const report = await runDoctor({ ...base, exec: cannedExec(table) })
    const image = byId(report.results, 'sandcastle-image')
    expect(image.status).toBe('stale')
    expect(image.severity).toBe('error')
    expect(image.detail).toBe(
      'sandcastle:runcastle no longer matches the burner Dockerfile — rebuild',
    )
    // Names the settings page the web deep-links from (decision 9).
    expect(image.fix).toBe('Open Settings → Burns (Rebuild image).')
    expect(report.ok).toBe(false)
  })

  // BuildKit layer-cache reuse keeps the old `Created` on a freshly rebuilt
  // image, which is what made the mtime comparison this replaces wrong in both
  // directions. An image built before the label existed cannot vouch for its
  // own content, so it reads as stale rather than as fine.
  it('reads an image with no hash label at all as stale', async () => {
    const table = {
      ...ALL_HEALTHY,
      // What both runtimes print for a label key the image does not carry.
      [inspectKey('docker', 'sandcastle:runcastle')]: { stdout: '<no value>' },
    }
    const report = await runDoctor({ ...base, exec: cannedExec(table) })
    expect(byId(report.results, 'sandcastle-image').status).toBe('stale')
  })

  it('never asks the image when it was built, only what it was built from', async () => {
    const asked: string[][] = []
    await runDoctor({
      ...base,
      exec: async (command, args) => {
        asked.push([command, ...args])
        return cannedExec(ALL_HEALTHY)(command, args)
      },
    })
    expect(asked.some((call) => call.join(' ').includes('{{.Created}}'))).toBe(false)
  })

  it('reports an image runcastle does not manage as custom, not as a defect', async () => {
    const report = await runDoctor({
      ...base,
      imageName: 'my-team/sandbox:latest',
      exec: cannedExec({
        ...ALL_HEALTHY,
        [inspectKey('docker', 'my-team/sandbox:latest')]: { stdout: '<no value>' },
      }),
    })
    const image = byId(report.results, 'sandcastle-image')
    expect(image.status).toBe('custom')
    expect(image.severity).toBe('info')
    expect(image.detail).toBe('my-team/sandbox:latest is a custom image, managed outside runcastle')
    expect(image.fix).toContain('clear the sandbox image setting')
    expect(image.fix).toContain('.runcastle/sandbox/Dockerfile')
    // `info` never fails a report: the operator's own image is not their bug,
    // and it carries no hash label runcastle could have judged it by anyway.
    expect(report.ok).toBe(true)
  })

  // Runcastle cannot build it, but it can still say a burn will not find it.
  it('still calls a custom image out when it is not built at all', async () => {
    const report = await runDoctor({
      ...base,
      imageName: 'my-team/sandbox:latest',
      exec: cannedExec(ALL_HEALTHY),
    })
    const image = byId(report.results, 'sandcastle-image')
    expect(image.status).toBe('custom')
    expect(image.severity).toBe('error')
    expect(image.detail).toContain('is not built locally')
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
    dockerfileHash: () => STOCK_HASH,
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
    dockerfileHash: () => STOCK_HASH,
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

/**
 * The doctor used to stat a Dockerfile path hand-built from its own bundle dir
 * (`../assets/sandcastle/Dockerfile`). That file is there in a contributor
 * checkout and nowhere in a published install, where the template is vendored as
 * `<pkgRoot>/sandcastle-template` — so `bun add -g runcastle` got an ENOENT out
 * of the tRPC doctor query and a home page stuck on "loading projects…".
 */
/**
 * A repo whose toolchain is not JavaScript ships `.runcastle/sandbox/Dockerfile`
 * and runcastle builds it `FROM` the stock image (decisions 5, 6, 8). The image
 * row is then about a chain, and the two questions it has to keep apart are
 * "which layer drifted" and "has this been built at all" — a runcastle upgrade
 * changes the stock Dockerfile, and every image built on it is out of date the
 * moment it does, however current its own label still is.
 */
describe('runDoctor — a project that ships its own sandbox Dockerfile', () => {
  const REPO = join('/repos', 'java-service')
  const PROJECT_DOCKERFILE = join(REPO, '.runcastle', 'sandbox', 'Dockerfile')
  const BURNER_DOCKERFILE = join('/assets', 'sandcastle', 'Dockerfile')
  const PROJECT_HASH = 'c'.repeat(64)
  const TAG = 'sandcastle:runcastle-p1'

  const base = {
    env: { CLAUDE_CODE_OAUTH_TOKEN: 'sk-oauth-xxx' },
    platform: 'linux' as const,
    imageName: 'sandcastle:runcastle',
    burnerDockerfile: BURNER_DOCKERFILE,
  }

  /** Hashes by path; a path this does not know is a file that is not there. */
  const hashes =
    (table: Record<string, string>) =>
    (path: string): string | null =>
      table[path] ?? null

  /** The stock Dockerfile alone — the state before a repo ships one of its own. */
  const stockOnly = { [BURNER_DOCKERFILE]: STOCK_HASH }
  const shipped = { ...stockOnly, [PROJECT_DOCKERFILE]: PROJECT_HASH }

  function project(over: Partial<ProjectImageEnv> = {}): ProjectImageEnv {
    return {
      id: 'p1',
      repoPath: REPO,
      stored: TAG,
      overwritable: true,
      clearStored: () => undefined,
      ...over,
    }
  }

  /** A host with both images built, each labelled with the hash given here. */
  const built = (stock: string, projectImage?: string) =>
    cannedExec({
      ...ALL_HEALTHY,
      [inspectKey('docker', 'sandcastle:runcastle')]: { stdout: stock },
      ...(projectImage === undefined
        ? {}
        : { [inspectKey('docker', TAG)]: { stdout: projectImage } }),
    })

  const imageRow = async (env: Parameters<typeof runDoctor>[0]) =>
    byId((await runDoctor(env)).results, 'sandcastle-image')

  it('is ok when both layers still match the Dockerfiles they were built from', async () => {
    const row = await imageRow({
      ...base,
      exec: built(STOCK_HASH, PROJECT_HASH),
      dockerfileHash: hashes({ ...shipped }),
      projectImage: project(),
    })
    expect(row.status).toBe('ok')
    expect(row.detail).toBe(`${TAG} built from .runcastle/sandbox/Dockerfile`)
  })

  it('names the project Dockerfile as the layer that drifted', async () => {
    const row = await imageRow({
      ...base,
      exec: built(STOCK_HASH, 'd'.repeat(64)),
      dockerfileHash: hashes({ ...shipped }),
      projectImage: project(),
    })
    expect(row.status).toBe('stale')
    expect(row.detail).toBe(`${TAG} no longer matches .runcastle/sandbox/Dockerfile — rebuild`)
    expect(row.fix).toBe('Open Settings → Burns (Rebuild image).')
  })

  // The silent hole a per-image label alone leaves: upgrade runcastle, and every
  // derived image stays "fresh" by its own hash while its base has moved.
  it('names the stock base as the layer that drifted', async () => {
    const row = await imageRow({
      ...base,
      exec: built('d'.repeat(64), PROJECT_HASH),
      dockerfileHash: hashes({ ...shipped }),
      projectImage: project(),
    })
    expect(row.status).toBe('stale')
    expect(row.detail).toBe(
      `${TAG} is built on sandcastle:runcastle, which no longer matches the burner Dockerfile — rebuild`,
    )
  })

  it('reports not-built-yet when the Dockerfile is there and the image is not', async () => {
    const row = await imageRow({
      ...base,
      exec: built(STOCK_HASH),
      dockerfileHash: hashes({ ...shipped }),
      projectImage: project({ stored: null }),
    })
    expect(row.status).toBe('not-built-yet')
    expect(row.detail).toBe(`.runcastle/sandbox/Dockerfile is not built — ${TAG} does not exist`)
    expect(row.fix).toContain('Build image')
  })

  // An image nothing resolves to is not this project's image, however current
  // it is: a burn would still run in the stock one. The same Build fixes it.
  it('reports not-built-yet when the image exists but the project never adopted it', async () => {
    const row = await imageRow({
      ...base,
      exec: built(STOCK_HASH, PROJECT_HASH),
      dockerfileHash: hashes({ ...shipped }),
      projectImage: project({ stored: null }),
    })
    expect(row.status).toBe('not-built-yet')
    expect(row.detail).toBe(`${TAG} is built but is not this project's image yet`)
  })

  it('clears a machine-written image whose Dockerfile has been deleted, and falls back', async () => {
    let cleared = 0
    const row = await imageRow({
      ...base,
      exec: built(STOCK_HASH, PROJECT_HASH),
      dockerfileHash: hashes({ ...stockOnly }), // the project Dockerfile is gone
      projectImage: project({ clearStored: () => (cleared += 1) }),
    })
    expect(cleared).toBe(1)
    // Resolution falls back to the layers below the column — here, the stock image.
    expect(row.status).toBe('ok')
    expect(row.detail).toBe('sandcastle:runcastle present')
  })

  it('never clears — or offers to rebuild — a tag the human typed', async () => {
    let cleared = 0
    const row = await imageRow({
      ...base,
      exec: cannedExec({
        ...ALL_HEALTHY,
        [inspectKey('docker', 'sandcastle:runcastle')]: { stdout: STOCK_HASH },
        [inspectKey('docker', 'my-team/sandbox:latest')]: { stdout: '<no value>' },
      }),
      dockerfileHash: hashes({ ...stockOnly }),
      projectImage: project({
        stored: 'my-team/sandbox:latest',
        overwritable: false,
        clearStored: () => (cleared += 1),
      }),
    })
    expect(cleared).toBe(0)
    expect(row.status).toBe('custom')
    expect(row.detail).toBe('my-team/sandbox:latest is a custom image, managed outside runcastle')
  })

  // Both at once: the human's tag is never overwritten, so a burn keeps
  // resolving to it however current the project image is. A row about the
  // project image would describe a container no burn runs in — and would arm a
  // Build button for it.
  it('answers for the hand-typed tag, not the project image, when the repo has both', async () => {
    const looked: string[] = []
    const table = cannedExec({
      ...ALL_HEALTHY,
      [inspectKey('docker', 'my-team/sandbox:latest')]: { stdout: '<no value>' },
      [inspectKey('docker', TAG)]: { stdout: PROJECT_HASH },
    })
    const row = await imageRow({
      ...base,
      exec: (command, args) => {
        looked.push([command, ...args].join(' '))
        return table(command, args)
      },
      dockerfileHash: hashes({ ...shipped }),
      projectImage: project({ stored: 'my-team/sandbox:latest', overwritable: false }),
    })
    expect(row.status).toBe('custom')
    expect(row.detail).toBe(
      "my-team/sandbox:latest is a custom image, managed outside runcastle — and outranks this repo's .runcastle/sandbox/Dockerfile",
    )
    // The Dockerfile is written already, so the way out is the setting alone.
    expect(row.fix).toContain('clear the sandbox image setting')
    expect(row.fix).not.toContain('commit a .runcastle/sandbox/Dockerfile')
    expect(looked).not.toContain(inspectKey('docker', TAG))
  })

  it('puts the project column above the env and config layers, as the resolver does', async () => {
    const row = await imageRow({
      ...base,
      imageName: 'from-the-config:latest',
      exec: built(STOCK_HASH, PROJECT_HASH),
      dockerfileHash: hashes({ ...shipped }),
      projectImage: project(),
    })
    expect(row.status).toBe('ok')
    expect(row.detail).toContain(TAG)
  })
})

describe('runDoctor — the burner Dockerfile it hashes', () => {
  const base = {
    env: { CLAUDE_CODE_OAUTH_TOKEN: 'sk-oauth-xxx' },
    platform: 'linux' as const,
    imageName: 'sandcastle:runcastle',
  }

  afterEach(() => {
    delete process.env[ASSET_ENV.sandcastleTemplate]
  })

  /** Run the probe set on a healthy host and report the path it hashed. */
  async function statted(): Promise<string> {
    const seen: string[] = []
    await runDoctor({
      ...base,
      exec: cannedExec(ALL_HEALTHY),
      dockerfileHash: (path) => {
        seen.push(path)
        return STOCK_HASH
      },
    })
    const [first] = seen
    if (!first) throw new Error('the image probe never hashed a Dockerfile')
    return first
  }

  it('defaults to the Dockerfile in the resolved template dir — a file really on disk', async () => {
    const path = await statted()
    expect(path).toBe(join(sandcastleTemplateDir(), 'Dockerfile'))
    expect(existsSync(path)).toBe(true)
  })

  it('follows the template vendored beside the bin in a published install', async () => {
    const pkgRoot = mkdtempSync(join(tmpdir(), 'runcastle-pkg-'))
    const vendored = join(pkgRoot, 'sandcastle-template')
    mkdirSync(vendored)
    writeFileSync(join(vendored, 'Dockerfile'), 'FROM oven/bun\n')
    applyInstalledAssetEnv(pkgRoot)

    const path = await statted()
    expect(path).toBe(join(vendored, 'Dockerfile'))
    expect(existsSync(path)).toBe(true)
  })
})

describe('exitCodeFor — gate vs diagnostic', () => {
  const base = {
    env: { CLAUDE_CODE_OAUTH_TOKEN: 'sk-oauth-xxx' },
    platform: 'linux' as const,
    imageName: 'sandcastle:runcastle',
    dockerfileHash: () => STOCK_HASH,
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
