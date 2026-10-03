/**
 * Platform install smoke — run ON a disposable machine (a container, a CI
 * runner), never on a dev box: step 1 is `bun add -g runcastle`, which replaces
 * whatever global runcastle is there.
 *
 * It walks the path a new user walks after reading the README, and checks the
 * parts that differ per OS rather than the logic the vitest suite already covers:
 *
 *   1. install      `bun add -g <spec>` — a tarball path or a registry spec
 *   2. version      `runcastle --version`
 *   3. pty binary   node-pty's native addon is on disk where its loader looks
 *                   (and on macOS, `spawn-helper` beside it AND executable)
 *   4. pty spawn    the real sidecar (`pty-host.cjs` under system `node`) runs a
 *                   shell in a PTY and returns its output — the embedded terminal
 *   5. doctor       `runcastle doctor` — printed, not judged (claude and docker
 *                   are deliberately absent on a smoke machine)
 *   6. serve        boot the server, fetch the SPA and one tRPC query, SIGTERM it
 *
 * Usage: `bun scripts/platform-smoke/smoke.ts [spec]`. The spec defaults to
 * `$RUNCASTLE_SPEC`, then a `runcastle.tgz` beside this file, then
 * `runcastle@latest`. Refuses to run unless `CI` or `RUNCASTLE_SMOKE_DISPOSABLE`
 * is set. Exits 1 when any required step fails; prints a summary either way.
 */
import { spawn, spawnSync } from 'node:child_process'
import { accessSync, constants, existsSync, mkdtempSync, readFileSync, realpathSync } from 'node:fs'
import { createRequire } from 'node:module'
import { arch, platform, tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
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
const smokeEnv: NodeJS.ProcessEnv = { ...process.env, RUNCASTLE_DATA_DIR: dataDir, DO_NOT_TRACK: '1' }
const spec = resolveSpec()

header('environment')
console.log(`platform  ${platform()}-${arch()}`)
for (const [label, cmd, args] of [
  ['os', 'uname', ['-a']],
  ['bun', 'bun', ['--version']],
  ['node', 'node', ['--version']],
  ['git', 'git', ['--version']],
] as const) {
  const r = run(cmd, [...args])
  console.log(`${label.padEnd(9)} ${r.error ? `(missing: ${r.error.message})` : r.out.split('\n')[0]}`)
}
console.log(`spec      ${spec}`)
console.log(`data dir  ${dataDir}`)

// --- 1. install ---------------------------------------------------------------

header('1. install')
const install = run('bun', ['add', '-g', spec])
console.log(install.out)
record('install', install.code === 0, install.code === 0 ? `bun add -g ${spec}` : `exit ${install.code}`)

// --- 2. version ---------------------------------------------------------------

header('2. version')
const bin = Bun.which('runcastle')
let pkgDir: string | null = null
if (!bin) {
  record('version', false, '`runcastle` is not on PATH after install')
} else {
  const v = run(bin, ['--version'], smokeEnv)
  record('version', v.code === 0, v.code === 0 ? v.out : `exit ${v.code}: ${v.out}`)
  // bin/runcastle.js → the package root (the dir whose manifest is `runcastle`).
  let dir = dirname(realpathSync(bin))
  for (let i = 0; i < 4 && !pkgDir; i++, dir = dirname(dir)) {
    const manifest = join(dir, 'package.json')
    if (existsSync(manifest) && JSON.parse(readFileSync(manifest, 'utf8')).name === 'runcastle') pkgDir = dir
  }
  console.log(`package   ${pkgDir ?? '(not found)'}`)
}

// --- 3. node-pty binary -------------------------------------------------------

header('3. node-pty binary')
let ptyEntry: string | null = null
if (pkgDir) {
  try {
    ptyEntry = createRequire(join(pkgDir, 'package.json')).resolve('node-pty')
  } catch (err) {
    record('pty binary', false, `node-pty does not resolve from ${pkgDir}: ${(err as Error).message}`)
  }
}
if (ptyEntry) {
  // node-pty's entry is <root>/lib/index.js; its loader tries these dirs in order.
  const ptyRoot = dirname(dirname(ptyEntry))
  const dirs = ['build/Release', 'build/Debug', `prebuilds/${platform()}-${arch()}`]
  const found = dirs.find((d) => existsSync(join(ptyRoot, d, 'pty.node')))
  if (!found) {
    record('pty binary', false, `no pty.node under ${ptyRoot} (checked ${dirs.join(', ')})`)
  } else if (platform() === 'darwin') {
    const helper = join(ptyRoot, found, 'spawn-helper')
    let executable = false
    try {
      accessSync(helper, constants.X_OK)
      executable = true
    } catch {}
    record(
      'pty binary',
      existsSync(helper) && executable,
      !existsSync(helper)
        ? `${found}/pty.node present but spawn-helper is missing`
        : executable
          ? `${found}/pty.node + executable spawn-helper`
          : `${found}/spawn-helper is NOT executable — node-pty fails with "posix_spawnp failed"`,
    )
  } else {
    record('pty binary', true, `${found}/pty.node`)
  }
}

// --- 4. pty spawn through the real sidecar ------------------------------------

header('4. pty spawn (pty-host.cjs under node)')
async function ptySpawn(hostPath: string, entry: string): Promise<{ ok: boolean; detail: string }> {
  // The shell computes the marker, so seeing it proves a shell ran inside the PTY
  // rather than the command line being echoed back.
  const shell = platform() === 'win32' ? 'cmd.exe' : '/bin/sh'
  const args = platform() === 'win32' ? ['/c', 'set /a 6*7'] : ['-c', 'echo PTY_OK_$((6*7))']
  const marker = platform() === 'win32' ? '42' : 'PTY_OK_42'
  const child = spawn('node', [hostPath, entry], { stdio: ['pipe', 'pipe', 'pipe'] })
  let output = ''
  let stderr = ''
  let buffered = ''
  child.stderr.on('data', (d: Buffer) => (stderr += d.toString()))
  return new Promise((resolve) => {
    const done = (ok: boolean, detail: string) => {
      clearTimeout(timer)
      child.kill()
      resolve({ ok, detail })
    }
    const timer = setTimeout(
      () => done(false, `timed out after 15s; pty output ${JSON.stringify(output)}; stderr ${stderr.trim()}`),
      15_000,
    )
    child.on('error', (err) => done(false, `could not start node: ${err.message}`))
    // A wrong-libc addon kills the host outright (musl + glibc prebuild segfaults).
    child.on('exit', (code, signal) =>
      done(false, `pty-host died (code ${code}, signal ${signal}) before the PTY exited; stderr ${stderr.trim()}`),
    )
    child.stdout.on('data', (d: Buffer) => {
      buffered += d.toString()
      let nl: number
      while ((nl = buffered.indexOf('\n')) >= 0) {
        const line = buffered.slice(0, nl)
        buffered = buffered.slice(nl + 1)
        let msg: { t: string; d?: string; message?: string; code?: number }
        try {
          msg = JSON.parse(line)
        } catch {
          continue
        }
        if (msg.t === 'data' && msg.d) output += Buffer.from(msg.d, 'base64').toString('utf8')
        if (msg.t === 'error') return done(false, `host error: ${msg.message}`)
        if (msg.t === 'exit') {
          return output.includes(marker)
            ? done(true, `shell ran in a PTY and printed ${marker} (exit ${msg.code})`)
            : done(false, `PTY exited ${msg.code} without ${marker}; output ${JSON.stringify(output)}`)
        }
      }
    })
    const frame = {
      t: 'spawn',
      file: shell,
      args,
      opts: { cwd: tmpdir(), cols: 80, rows: 24, useConpty: true, env: process.env },
    }
    child.stdin.write(`${JSON.stringify(frame)}\n`)
  })
}
const hostPath = pkgDir ? join(pkgDir, 'pty-host.cjs') : null
if (!hostPath || !existsSync(hostPath)) {
  record('pty spawn', false, `pty-host.cjs not found in the installed package`)
} else if (!ptyEntry) {
  record('pty spawn', false, 'skipped — node-pty does not resolve')
} else {
  const r = await ptySpawn(hostPath, ptyEntry)
  record('pty spawn', r.ok, r.detail)
}

// --- 5. doctor ----------------------------------------------------------------

header('5. doctor')
if (bin) {
  const d = run(bin, ['doctor'], smokeEnv)
  console.log(d.out)
  // claude/docker are absent on purpose, so a non-zero exit is expected; only a
  // crash (no report at all) counts as a failure here.
  record('doctor', d.out.length > 0 && !/^(TypeError|ReferenceError|error:)/m.test(d.out), `exit ${d.code}`, false)
}

// --- 6. serve -----------------------------------------------------------------

header('6. serve')
async function smokeServe(binPath: string): Promise<{ ok: boolean; detail: string }> {
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
    return { ok: true, detail: `SPA served and tRPC answered on ${base}` }
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
  record('serve', s.ok, s.detail)
}

// --- summary ------------------------------------------------------------------

header('summary')
for (const r of results) console.log(`${r.ok ? 'PASS' : r.required ? 'FAIL' : 'WARN'}  ${r.name}`)
const failed = results.filter((r) => r.required && !r.ok)
console.log(failed.length === 0 ? '\nplatform smoke passed' : `\nplatform smoke FAILED (${failed.length})`)
process.exit(failed.length === 0 ? 0 : 1)
