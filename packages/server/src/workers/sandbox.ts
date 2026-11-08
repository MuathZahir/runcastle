import { execFile } from 'node:child_process'
import { createRequire } from 'node:module'
import { createServer } from 'node:net'
import { promisify } from 'node:util'

/**
 * A worker's sandbox (workers spike, decisions 7, 8 and 23): a long-lived
 * container of the burn image, on the ordinary bridge network, publishing one
 * port on the host's loopback. Sandcastle's `docker run` takes no `-p`, so the
 * container is started here with the container CLI directly; the isolated clone
 * and its push-on-commit hook follow ADR-0005's shape.
 *
 * The argv builders are pure, so tests pin them; the runners shell out.
 */

import { BURN_CACHE_MOUNT } from './burn-cache'
import { GUARD_INSTALL_PATHS, renderGuardScript, renderGuardSettings } from './burn-guard'

const run = promisify(execFile)

export type Engine = 'docker' | 'podman'

/** Where things live inside the sandbox. */
export const IN = {
  home: '/home/agent',
  origin: '/home/agent/origin.git',
  repo: '/home/agent/repo',
  state: '/home/agent/.runcastle',
  runtime: '/opt/runcastle',
  claude: '/home/agent/.local/bin/claude',
  /** A Codex worker's `CODEX_HOME`: its config, the human's setup, and its conversations' rollouts. */
  codexHome: '/home/agent/.codex',
  /** The Codex CLI the burn image installs on its PATH, pinned to the host's version. */
  codex: 'codex',
} as const

/** The codex-acp mode a Codex worker opens in: Codex's auto-review (interactive-workers decision 11). */
export const CODEX_AUTO_REVIEW_MODE = 'agent'

export interface SandboxSpec {
  engine: Engine
  container: string
  image: string
  port: number
  /**
   * The worker's own bare copy of the feature branch, mounted read-write: commits are pushed
   * into it, and the host fetches them back. The host repo itself is never mounted, so nothing
   * in the sandbox can plant a hook or config in it (review finding).
   */
  originDir: string
  /** The host dir holding the adapter bundle and the worker MCP script. */
  runtimeDir: string
  uid: number
  gid: number
  /** The project's burn cache volume and the env pointing the package manager's store at it; absent with `burnCache: 'off'`. */
  cache?: { volume: string; env: Record<string, string> }
  /** `--cpus` for the container (`burnCpus`, ADR-0008); absent leaves it unbounded. */
  cpus?: number
}

export function runArgs(s: SandboxSpec): string[] {
  return [
    'run',
    '-d',
    '--name',
    s.container,
    '--user',
    `${s.uid}:${s.gid}`,
    ...(s.cpus !== undefined ? ['--cpus', String(s.cpus)] : []),
    '-p',
    `127.0.0.1:${s.port}:${s.port}`,
    '-v',
    `${s.originDir}:${IN.origin}`,
    '-v',
    `${s.runtimeDir}:${IN.runtime}:ro`,
    ...(s.cache ? ['-v', `${s.cache.volume}:${BURN_CACHE_MOUNT}`] : []),
    ...Object.entries(s.cache?.env ?? {}).flatMap(([name, value]) => ['-e', `${name}=${value}`]),
    '-w',
    '/home/agent',
    s.image,
  ]
}

export interface SetupInput {
  featureBranch: string
  workerBranch: string
  gitName: string
  gitEmail: string
}

const q = (v: string): string => `'${v.replace(/'/g, `'\\''`)}'`

/** The one-time setup inside a fresh sandbox: clone, worker branch, push-on-commit hook. Installs run separately. */
export function setupScript(i: SetupInput): string {
  const hook = [
    '#!/bin/sh',
    'unset GIT_DIR GIT_WORK_TREE GIT_INDEX_FILE',
    `git push -q ${IN.origin} HEAD:refs/heads/${i.workerBranch} 2>/dev/null || { sleep 1; git push -q ${IN.origin} HEAD:refs/heads/${i.workerBranch} || echo "runcastle: commit sync failed (will retry on your next commit)" >&2; }`,
    'exit 0',
  ].join('\n')
  return [
    'set -e',
    `mkdir -p ${IN.state}`,
    "git config --global --add safe.directory '*'",
    `git config --global user.name ${q(i.gitName)}`,
    `git config --global user.email ${q(i.gitEmail)}`,
    `git clone -q --branch ${q(i.workerBranch)} ${IN.origin} ${IN.repo}`,
    `printf '%s\\n' ${q(hook)} > ${IN.repo}/.git/hooks/post-commit`,
    `chmod +x ${IN.repo}/.git/hooks/post-commit`,
  ].join('\n')
}

/** Install the project's dependencies in the clone, by its lockfile. */
export function installScript(): string {
  return [
    `cd ${IN.repo}`,
    'if [ -f bun.lock ] || [ -f bun.lockb ]; then bun install --frozen-lockfile || bun install',
    'elif [ -f pnpm-lock.yaml ]; then corepack pnpm install --frozen-lockfile',
    'elif [ -f yarn.lock ]; then corepack yarn install --frozen-lockfile',
    'elif [ -f package-lock.json ]; then npm ci',
    'fi',
  ].join('\n')
}

/** The project's own setup command (config `setupCommand`), run in the clone after the install. */
export function projectSetupScript(command: string): string {
  return `cd ${IN.repo} && ${command}`
}

/**
 * The cache dirs the package manager's store env names, made before the install:
 * the volume is owned by the worker user, but its subdirectories are the first
 * worker's to create.
 */
export function cacheDirsScript(dirs: readonly string[]): string {
  return `mkdir -p ${dirs.map(q).join(' ')}`
}

/**
 * Install runcastle's repeated-test-suite guard in a Claude Code sandbox: the
 * script, and a PreToolUse hook merged into the sandbox's own `settings.json`
 * (the copied setup's other settings stay; the human's hooks never come over).
 * Written after the setup copy, which clears `settings.json`.
 */
export function guardInstallScript(): string {
  const paths = GUARD_INSTALL_PATHS['claude-code']
  const b64 = (text: string): string => Buffer.from(text, 'utf8').toString('base64')
  return [
    `mkdir -p "$HOME/.claude/hooks"`,
    `printf %s '${b64(renderGuardScript())}' | base64 -d > "${paths.script}"`,
    `chmod +x "${paths.script}"`,
    `printf %s '${b64(JSON.stringify(renderGuardSettings('claude-code')))}' | base64 -d > ${IN.state}/guard-settings.json`,
    [
      `node -e '`,
      `const fs=require("fs");const f=process.argv[1];const g=JSON.parse(fs.readFileSync(process.argv[2],"utf8"));`,
      `let c={};try{c=JSON.parse(fs.readFileSync(f,"utf8"))}catch{}`,
      `c.hooks=g.hooks;fs.writeFileSync(f,JSON.stringify(c,null,2));fs.rmSync(process.argv[2])`,
      `' ${IN.home}/.claude/settings.json ${IN.state}/guard-settings.json`,
    ].join(''),
  ].join(' && ')
}

/** `docker exec` argv that runs the ACP adapter in the clone, speaking ACP on stdio. Secrets ride env by name only. */
export function adapterExecArgs(container: string, port: number, previewUrl: string): string[] {
  return [
    'exec',
    '-i',
    '-w',
    IN.repo,
    '-e',
    'CLAUDE_CODE_OAUTH_TOKEN',
    '-e',
    `CLAUDE_CODE_EXECUTABLE=${IN.claude}`,
    '-e',
    'CLAUDE_CODE_DISABLE_AGENT_VIEW=1',
    '-e',
    `WORKER_PORT=${port}`,
    '-e',
    `WORKER_PREVIEW_URL=${previewUrl}`,
    container,
    'node',
    `${IN.runtime}/acp.mjs`,
  ]
}

/**
 * `docker exec` argv that runs codex-acp in the clone (decision 12), speaking
 * ACP on stdio. It starts `codex app-server` against the worker's own
 * `CODEX_HOME`, where the human's setup is copied in and the rollouts a resume
 * reads stay; it opens every session, a resumed one too, in auto-review.
 */
export function codexAdapterExecArgs(container: string, port: number, previewUrl: string): string[] {
  return [
    'exec',
    '-i',
    '-w',
    IN.repo,
    '-e',
    `CODEX_HOME=${IN.codexHome}`,
    '-e',
    `CODEX_PATH=${IN.codex}`,
    '-e',
    `INITIAL_AGENT_MODE=${CODEX_AUTO_REVIEW_MODE}`,
    '-e',
    'NO_BROWSER=1',
    '-e',
    `WORKER_PORT=${port}`,
    '-e',
    `WORKER_PREVIEW_URL=${previewUrl}`,
    container,
    'node',
    `${IN.runtime}/codex-acp.mjs`,
  ]
}

/** Where the in-sandbox relay listens for the worker's MCP server: inside the container only. */
export const TOOLS_SOCKET = `${IN.state}/tools.sock`

/** The worker's own MCP server (runcastle's tools, decision 9): the script inside the sandbox and the env it reads. */
export function workerMcpServer(port: number, previewUrl: string): { command: string; args: string[]; env: Record<string, string> } {
  return {
    command: 'node',
    args: [`${IN.runtime}/worker-mcp.cjs`],
    env: {
      WORKER_PORT: String(port),
      WORKER_PREVIEW_URL: previewUrl,
      RUNCASTLE_TOOLS_SOCKET: TOOLS_SOCKET,
      PATH: '/home/agent/.local/bin:/usr/local/bin:/usr/bin:/bin',
    },
  }
}

/**
 * `docker exec` argv for the tool relay (decision 9): a channel runcastle opens
 * INTO the container, so the worker reaches runcastle's tools with no route out.
 * The relay listens on {@link TOOLS_SOCKET} and carries each call over this exec's stdio.
 */
export function relayExecArgs(container: string): string[] {
  return ['exec', '-i', container, 'node', `${IN.runtime}/worker-relay.cjs`]
}

/** Clear what of the human's setup an earlier start copied in ({@link SETUP_MANAGED}), keeping the sandbox's own conversations. */
export function setupClearScript(managed: readonly string[]): string {
  return `cd ${IN.home} && rm -rf ${managed.map(q).join(' ')} && mkdir -p .claude .codex ${IN.state}`
}

/** Merge the staged user-level MCP servers into the sandbox's own `~/.claude.json`, which also holds its conversations' state. */
export function mcpMergeScript(): string {
  return [
    `node -e '`,
    `const fs=require("fs");const f=process.argv[1];const s=JSON.parse(fs.readFileSync(process.argv[2],"utf8"));`,
    `let c={};try{c=JSON.parse(fs.readFileSync(f,"utf8"))}catch{}`,
    `c.mcpServers=s;fs.writeFileSync(f,JSON.stringify(c,null,2));fs.rmSync(process.argv[2])`,
    `' ${IN.home}/.claude.json ${IN.state}/user-mcp.json`,
  ].join('')
}

/** Restart the dev server the worker last started, detached, after its container starts again. */
export function devRestartScript(port: number): string {
  return [
    `f=${IN.state}/dev.json`,
    '[ -f "$f" ] || exit 0',
    `cmd=$(node -e 'process.stdout.write(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).command)' "$f")`,
    `cd ${IN.repo}`,
    `PORT=${port} RUNCASTLE_DESIGN_PORT=${port} HOST=0.0.0.0 setsid sh -c "$cmd" > ${IN.state}/dev.log 2>&1 < /dev/null &`,
    `node -e 'const fs=require("fs");const f=process.argv[1];const d=JSON.parse(fs.readFileSync(f,"utf8"));d.pid=Number(process.argv[2]);d.at=Date.now();fs.writeFileSync(f,JSON.stringify(d))' "$f" $!`,
  ].join('\n')
}

// ---- runners ----

export async function engineRun(engine: Engine, args: string[], env?: NodeJS.ProcessEnv): Promise<string> {
  const { stdout } = await run(engine, args, { env: env ?? process.env, maxBuffer: 32 * 1024 * 1024 })
  return stdout
}

/** Run a shell script inside the container, as the agent user (or root). */
export async function execSh(engine: Engine, container: string, script: string, opts: { root?: boolean } = {}): Promise<string> {
  return engineRun(engine, ['exec', ...(opts.root ? ['-u', '0'] : []), container, 'sh', '-c', script])
}

export async function containerState(engine: Engine, container: string): Promise<'running' | 'stopped' | 'missing'> {
  try {
    const out = await engineRun(engine, ['inspect', '-f', '{{.State.Running}}', container])
    return out.trim() === 'true' ? 'running' : 'stopped'
  } catch {
    return 'missing'
  }
}

/** A free loopback port for the worker to publish. */
export async function pickFreePort(from = 41000, tries = 400, taken: ReadonlySet<number> = new Set()): Promise<number> {
  for (let p = from; p < from + tries; p++) {
    if (taken.has(p)) continue
    const free = await new Promise<boolean>((resolve) => {
      const srv = createServer()
      srv.once('error', () => resolve(false))
      srv.listen(p, '127.0.0.1', () => srv.close(() => resolve(true)))
    })
    if (free) return p
  }
  throw new Error(`no free port in ${from}..${from + tries}`)
}

/** The adapter's entry on the host, the same package the thread host runs. */
export function adapterEntry(): string {
  return createRequire(import.meta.url).resolve('@agentclientprotocol/claude-agent-acp/dist/index.js')
}

export function adapterVersion(): string {
  const req = createRequire(import.meta.url)
  return (req('@agentclientprotocol/claude-agent-acp/package.json') as { version: string }).version
}

/** codex-acp's entry on the host, the same package Codex chats run. */
export function codexAdapterEntry(): string {
  return createRequire(import.meta.url).resolve('@agentclientprotocol/codex-acp')
}

export function codexAdapterVersion(): string {
  const req = createRequire(import.meta.url)
  return (req('@agentclientprotocol/codex-acp/package.json') as { version: string }).version
}
