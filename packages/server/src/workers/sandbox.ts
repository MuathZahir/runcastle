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

const run = promisify(execFile)

export type Engine = 'docker' | 'podman'

/** Where things live inside the sandbox. */
export const IN = {
  home: '/home/agent',
  origin: '/home/agent/origin.git',
  repo: '/home/agent/repo',
  state: '/home/agent/.runcastle',
  runtime: '/opt/runcastle',
  cache: '/home/agent/.cache-rc',
  claude: '/home/agent/.local/bin/claude',
} as const

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
}

export function runArgs(s: SandboxSpec): string[] {
  return [
    'run',
    '-d',
    '--name',
    s.container,
    '--user',
    `${s.uid}:${s.gid}`,
    '-p',
    `127.0.0.1:${s.port}:${s.port}`,
    '-v',
    `${s.originDir}:${IN.origin}`,
    '-v',
    `${s.runtimeDir}:${IN.runtime}:ro`,
    '-v',
    `runcastle-worker-cache:${IN.cache}`,
    '-e',
    `BUN_INSTALL_CACHE_DIR=${IN.cache}/bun`,
    '-e',
    `npm_config_cache=${IN.cache}/npm`,
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

/** Where the in-sandbox relay listens for the worker's MCP server: inside the container only. */
export const TOOLS_SOCKET = `${IN.state}/tools.sock`

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
  return `cd ${IN.home} && rm -rf ${managed.map(q).join(' ')} && mkdir -p .claude ${IN.state}`
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
