/**
 * Platform install smoke — run ON a disposable machine (a container, a CI
 * runner), never on a dev box: step 1 is `bun add -g runcastle`, which replaces
 * whatever global runcastle is there.
 *
 * It walks the path a new user walks after reading the README, and checks the
 * parts that differ per OS rather than the logic the vitest suite already covers:
 *
 *   0. no node      Node is hidden from PATH for every step after this one, and
 *                   the smoke fails if it cannot be: runcastle runs on Bun alone
 *   1. install      `bun add -g <spec>` — a tarball path or a registry spec
 *   2. version      `runcastle --version`
 *   3. adapters     both agent adapters start under Bun and answer `initialize`
 *   4. doctor       `runcastle doctor` — printed, not judged (claude and docker
 *                   are deliberately absent on a smoke machine)
 *   5. serve        boot the server, fetch the SPA and one tRPC query
 *   6. terminal     through that server, the way the app does it: open a sign-in
 *                   terminal on a stand-in `claude`, type into it, Ctrl-C it
 *
 * Usage: `bun scripts/platform-smoke/smoke.ts [spec]`. The spec defaults to
 * `$RUNCASTLE_SPEC`, then a `runcastle.tgz` beside this file, then
 * `runcastle@latest`. Refuses to run unless `CI` or `RUNCASTLE_SMOKE_DISPOSABLE`
 * is set. Exits 1 when any required step fails; prints a summary either way.
 */
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, readdirSync, realpathSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { arch, homedir, platform, tmpdir } from 'node:os'
import { delimiter, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

interface StepResult {
  name: string
  ok: boolean
  /** A non-required step reports but never fails the run. */
  required: boolean
  detail: string
}

const results: StepResult[] = []

function record(name: string, ok: boolean, detail: string, required = true): void {
  results.push({ name, ok, required, detail })
  console.log(`${ok ? '✓' : required ? '✗' : '!'} ${name}: ${detail}`)
}

function run(cmd: string, args: string[], env: NodeJS.ProcessEnv = process.env) {
  const r = spawnSync(cmd, args, { encoding: 'utf8', env, timeout: 300_000 })
  return { code: r.status ?? -1, out: `${r.stdout ?? ''}${r.stderr ?? ''}`.trim(), error: r.error }
}

function header(title: string): void {
  console.log(`\n── ${title} ${'─'.repeat(Math.max(0, 60 - title.length))}`)
}

function resolveSpec(): string {
  const explicit = process.argv[2] ?? process.env.RUNCASTLE_SPEC
  if (explicit) return explicit
  const beside = join(dirname(fileURLToPath(import.meta.url)), 'runcastle.tgz')
  return existsSync(beside) ? beside : 'runcastle@latest'
}

// --- 0. environment -----------------------------------------------------------

if (!process.env.CI && !process.env.RUNCASTLE_SMOKE_DISPOSABLE) {
  console.error(
    'refusing to run: this replaces the global runcastle install. Run it in a container or CI\n' +
      '(scripts/platform-smoke/run.ts), or set RUNCASTLE_SMOKE_DISPOSABLE=1 if this machine is disposable.',
  )
  process.exit(2)
}

// A throwaway data dir and the telemetry opt-out: a smoke boot must never touch a
// real ~/.runcastle or count as an active install.
const dataDir = mkdtempSync(join(tmpdir(), 'runcastle-smoke-'))

/** A stand-in `claude` first on PATH, which the terminal step opens as a sign-in flow. */
function fakeClaudeDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'runcastle-smoke-claude-'))
  writeFileSync(
    join(dir, 'fake-claude.ts'),
    `if (process.argv[3] !== 'login') {
       console.log('0.0.0 (stand-in)')
       process.exit(0)
     }
     process.stdin.setEncoding('utf8')
     console.log('FAKE_READY')
     process.stdin.on('data', (d) => console.log('FAKE_GOT[' + String(d).trim() + ']'))
     setInterval(() => {}, 1000)`,
  )
  const script = join(dir, 'fake-claude.ts')
  if (platform() === 'win32') {
    writeFileSync(join(dir, 'claude.cmd'), `@"${process.execPath}" "${script}" %*\r\n`)
  } else {
    writeFileSync(join(dir, 'claude'), `#!/bin/sh\nexec "${process.execPath}" "${script}" "$@"\n`, { mode: 0o755 })
  }
  return dir
}

/** PATH with every directory holding a `node` taken out. */
function pathWithoutNode(): string {
  const names = platform() === 'win32' ? ['node.exe', 'node.cmd', 'node'] : ['node']
  return (process.env.PATH ?? '')
    .split(delimiter)
    .filter((dir) => !names.some((name) => existsSync(join(dir, name))))
    .join(delimiter)
}

const noNodePath = pathWithoutNode()
const smokeEnv: NodeJS.ProcessEnv = {
  ...process.env,
  PATH: `${fakeClaudeDir()}${delimiter}${noNodePath}`,
  RUNCASTLE_DATA_DIR: dataDir,
  DO_NOT_TRACK: '1',
}
const spec = resolveSpec()

header('environment')
console.log(`platform  ${platform()}-${arch()}`)
for (const [label, cmd, args] of [
  ['os', 'uname', ['-a']],
  ['bun', 'bun', ['--version']],
  ['git', 'git', ['--version']],
] as const) {
  const r = run(cmd, [...args])
  console.log(`${label.padEnd(9)} ${r.error ? `(missing: ${r.error.message})` : r.out.split('\n')[0]}`)
}
console.log(`spec      ${spec}`)
console.log(`data dir  ${dataDir}`)

const nodeLeft = Bun.which('node', { PATH: noNodePath })
record('no node', nodeLeft === null, nodeLeft === null ? 'node is not on PATH' : `node is still reachable at ${nodeLeft}`)

// --- 1. install ---------------------------------------------------------------

header('1. install')
const install = run('bun', ['add', '-g', spec], smokeEnv)
console.log(install.out)
record('install', install.code === 0, install.code === 0 ? `bun add -g ${spec}` : `exit ${install.code}`)

// --- 2. version ---------------------------------------------------------------

header('2. version')
const bin = Bun.which('runcastle', { PATH: smokeEnv.PATH ?? '' })
let pkgDir: string | null = null
if (!bin) {
  record('version', false, '`runcastle` is not on PATH after install')
} else {
  const v = run(bin, ['--version'], smokeEnv)
  record('version', v.code === 0, v.code === 0 ? v.out : `exit ${v.code}: ${v.out}`)
  // The package root is the dir whose manifest is `runcastle`. On POSIX the bin
  // is a symlink into it; on Windows it is a `runcastle.exe` shim in ~/.bun/bin
  // that leads nowhere, so fall back to bun's global dir.
  const isRuncastle = (dir: string) => {
    const manifest = join(dir, 'package.json')
    return existsSync(manifest) && JSON.parse(readFileSync(manifest, 'utf8')).name === 'runcastle'
  }
  let dir = dirname(realpathSync(bin))
  for (let i = 0; i < 4 && !pkgDir; i++, dir = dirname(dir)) if (isRuncastle(dir)) pkgDir = dir
  const globalDir =
    process.env.BUN_INSTALL_GLOBAL_DIR ?? join(process.env.BUN_INSTALL ?? join(homedir(), '.bun'), 'install', 'global')
  const fromGlobal = join(globalDir, 'node_modules', 'runcastle')
  if (!pkgDir && isRuncastle(fromGlobal)) pkgDir = fromGlobal
  console.log(`package   ${pkgDir ?? '(not found)'}`)
}

// --- 3. adapters --------------------------------------------------------------

header('3. adapters')

/** The native Codex binary its npm package carries for this machine, if any. */
function nativeCodex(root: string): string | null {
  const openai = join(root, '@openai')
  if (!existsSync(openai)) return null
  const name = platform() === 'win32' ? 'codex.exe' : 'codex'
  for (const pkg of readdirSync(openai).filter((p) => p.startsWith('codex-'))) {
    const vendor = join(openai, pkg, 'vendor')
    if (!existsSync(vendor)) continue
    for (const triple of readdirSync(vendor)) {
      for (const sub of [join(vendor, triple, 'bin'), join(vendor, triple, 'codex')]) {
        if (existsSync(join(sub, name))) return join(sub, name)
      }
    }
  }
  return null
}

/** Start one adapter under Bun, ask `initialize`, and report what came back. */
async function adapterAnswers(entry: string, env: NodeJS.ProcessEnv): Promise<{ ok: boolean; detail: string }> {
  const child = spawn(process.execPath, [entry], { env, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true })
  let out = ''
  let err = ''
  child.stdout.on('data', (d: Buffer) => (out += d.toString()))
  child.stderr.on('data', (d: Buffer) => (err += d.toString()))
  child.stdin.write(
    `${JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: 1, clientCapabilities: {} } })}\n`,
  )
  const deadline = Date.now() + 30_000
  while (!out.includes('"id":1') && child.exitCode === null && Date.now() < deadline) await Bun.sleep(100)
  child.kill()
  const line = out.split('\n').find((l) => l.includes('"id":1')) ?? ''
  if (!line) return { ok: false, detail: `no answer to initialize; stderr ${err.slice(-300)}` }
  // An error is a fair answer with no login. One that names Node is what this step hunts.
  if (/\bnode\b/i.test(line)) return { ok: false, detail: `it wanted Node: ${line.slice(0, 300)}` }
  return { ok: true, detail: line.slice(0, 100) }
}

if (!pkgDir) {
  record('adapters', false, 'the installed package could not be located')
} else {
  const require = createRequire(join(pkgDir, 'package.json'))
  const claudeEntry = require.resolve('@agentclientprotocol/claude-agent-acp/dist/index.js')
  const codexEntry = require.resolve('@agentclientprotocol/codex-acp')
  const codex = nativeCodex(dirname(pkgDir))
  const claudeResult = await adapterAnswers(claudeEntry, smokeEnv)
  record('claude adapter', claudeResult.ok, claudeResult.detail)
  const codexResult = await adapterAnswers(codexEntry, { ...smokeEnv, ...(codex ? { CODEX_PATH: codex } : {}) })
  record('codex adapter', codexResult.ok, `${codex ? 'native binary' : 'no native binary found'}: ${codexResult.detail}`)
}

// --- 4. doctor ----------------------------------------------------------------

header('4. doctor')
if (bin) {
  const d = run(bin, ['doctor'], smokeEnv)
  console.log(d.out)
  // claude/docker are absent on purpose, so a non-zero exit is expected; only a
  // crash (no report at all) counts as a failure here.
  record('doctor', d.out.length > 0 && !/^(TypeError|ReferenceError|error:)/m.test(d.out), `exit ${d.code}`, false)
}

/**
 * Everything between a click in the app and the program: the tRPC call that opens
 * a sign-in terminal, the installed backend, and the WebSocket the view talks over.
 * Ctrl-C proves the interrupt on each OS: a line-mode program ends at once on
 * POSIX, and through the two-second fallback on Windows.
 */
async function smokeTerminal(base: string): Promise<{ ok: boolean; detail: string }> {
  const started = await fetch(`${base}/api/trpc/setup.startTerminal`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ kind: 'claude-login' }),
  })
  if (started.status !== 200) {
    return { ok: false, detail: `setup.startTerminal → ${started.status}: ${await started.text()}` }
  }
  const body = (await started.json()) as { result: { data: { sessionId: string } } }
  const socket = new WebSocket(`${base.replace('http', 'ws')}/ws/terminal/${body.result.data.sessionId}`)
  socket.binaryType = 'arraybuffer'
  let output = ''
  let ended = false
  socket.addEventListener('message', (e: MessageEvent) => {
    if (typeof e.data === 'string') ended ||= (JSON.parse(e.data) as { status?: string }).status === 'ended'
    else output += Buffer.from(e.data as ArrayBuffer).toString('utf8')
  })
  const until = async (check: () => boolean, ms: number): Promise<boolean> => {
    const deadline = Date.now() + ms
    while (!check() && Date.now() < deadline) await Bun.sleep(50)
    return check()
  }
  const keys = (text: string): void => socket.send(Buffer.from(text, 'utf8'))
  const seen = (): string => JSON.stringify(output.slice(-300))
  try {
    if (!(await until(() => socket.readyState === WebSocket.OPEN, 5000))) {
      return { ok: false, detail: 'the terminal WebSocket never opened' }
    }
    if (!(await until(() => output.includes('FAKE_READY'), 15_000))) {
      return { ok: false, detail: `the program never printed in the terminal: ${seen()}` }
    }
    keys('smoke-input\r')
    if (!(await until(() => output.includes('FAKE_GOT[smoke-input]'), 5000))) {
      return { ok: false, detail: `typed input never reached the program: ${seen()}` }
    }
    const interrupted = Date.now()
    keys('\x03')
    if (!(await until(() => ended, 6000))) {
      return { ok: false, detail: `Ctrl-C did not end the program: ${seen()}` }
    }
    return { ok: true, detail: `output, typed input, and Ctrl-C ending the program in ${Date.now() - interrupted}ms` }
  } finally {
    socket.close()
  }
}

// --- 5. serve, 6. terminal -----------------------------------------------------------------

header('5. serve')
async function smokeServe(binPath: string): Promise<{ ok: boolean; detail: string; name?: string }> {
  const server = spawn(binPath, ['serve'], { env: smokeEnv, stdio: ['ignore', 'pipe', 'pipe'] })
  let log = ''
  server.stdout.on('data', (d: Buffer) => (log += d.toString()))
  server.stderr.on('data', (d: Buffer) => (log += d.toString()))
  const base = 'http://127.0.0.1:4512'
  try {
    const deadline = Date.now() + 30_000
    let index: Response | null = null
    while (Date.now() < deadline && server.exitCode === null) {
      index = await fetch(`${base}/`).catch(() => null)
      if (index) break
      await Bun.sleep(500)
    }
    if (!index) return { ok: false, detail: `no answer on ${base} within 30s. Server log:\n${log}` }
    const html = await index.text()
    if (index.status !== 200 || !/<html/i.test(html)) {
      return { ok: false, detail: `GET / → ${index.status}, not the SPA. Server log:\n${log}` }
    }
    const trpc = await fetch(`${base}/api/trpc/setup.runtimeGuide`)
    if (trpc.status !== 200) {
      return { ok: false, detail: `GET /api/trpc/setup.runtimeGuide → ${trpc.status}: ${await trpc.text()}` }
    }
    record('serve', true, `SPA served and tRPC answered on ${base}`)
    header('6. terminal')
    const t = await smokeTerminal(base)
    return { ok: t.ok, detail: t.detail, name: 'terminal' }
  } finally {
    server.kill('SIGTERM')
    const exited = await Promise.race([
      new Promise<boolean>((r) => server.once('exit', () => r(true))),
      Bun.sleep(10_000).then(() => false),
    ])
    if (!exited) {
      server.kill('SIGKILL')
      record('serve shutdown', false, 'server ignored SIGTERM for 10s', false)
    }
  }
}
if (bin) {
  const s = await smokeServe(bin)
  record(s.name ?? 'serve', s.ok, s.detail)
}

// --- summary ------------------------------------------------------------------

header('summary')
for (const r of results) console.log(`${r.ok ? 'PASS' : r.required ? 'FAIL' : 'WARN'}  ${r.name}`)
const failed = results.filter((r) => r.required && !r.ok)
console.log(failed.length === 0 ? '\nplatform smoke passed' : `\nplatform smoke FAILED (${failed.length})`)
process.exit(failed.length === 0 ? 0 : 1)
