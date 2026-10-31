import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { devSpawnTarget } from '../../src/pty/dev-pane'
import { createPtySession, type PtySession } from '../../src/pty/pty'
import { terminalText } from './terminal-text'

/**
 * The real terminal backend, exercised from inside a real Bun process, reported
 * as one line of JSON evidence per check. vitest runs on node, which has no
 * `Bun.spawn`, so this is the only place the shipped backend runs under test.
 *
 * Run BY `bun`, spawned from `pty-bun.test.ts`. Each check is its own small
 * program in a scratch dir, run by this same Bun, so nothing depends on a shell.
 */

const isWin = process.platform === 'win32'
const BUN = process.execPath
const delay = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

interface Run {
  pty: PtySession
  text(): string
  exit: Promise<{ exitCode: number; signal?: number } | 'timeout'>
}

/** Open a terminal, collecting its output, with a bound on how long exit can take. */
function open(cmd: string, args: string[], cwd: string, timeoutMs = 15_000): Run {
  const pty = createPtySession(cmd, args, { cwd, env: process.env, cols: 120, rows: 30 })
  let out = ''
  pty.onData((chunk) => {
    out += chunk.toString('utf8')
  })
  const exit = Promise.race([
    new Promise<{ exitCode: number; signal?: number }>((resolve) => pty.onExit(resolve)),
    delay(timeoutMs).then(() => 'timeout' as const),
  ])
  return { pty, text: () => terminalText(out), exit }
}

async function until(check: () => boolean, timeoutMs = 10_000): Promise<boolean> {
  const started = Date.now()
  while (!check()) {
    if (Date.now() - started > timeoutMs) return false
    await delay(25)
  }
  return true
}

function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

const dir = mkdtempSync(join(tmpdir(), 'rc-pty-'))
const script = (name: string, body: string): string => {
  const path = join(dir, name)
  writeFileSync(path, body)
  return path
}

const evidence: Record<string, unknown> = {
  platform: process.platform,
  bun: process.versions.bun ?? null,
  isBun: typeof (globalThis as { Bun?: unknown }).Bun !== 'undefined',
}

async function output(): Promise<void> {
  const run = open(BUN, [script('out.ts', 'console.log("hi-marker é✓"); process.exit(7)')], dir)
  const exit = await run.exit
  evidence.output = { exit, text: run.text() }
}

async function isTty(): Promise<void> {
  const run = open(BUN, [script('tty.ts', 'console.log("tty=" + process.stdout.isTTY + " cols=" + process.stdout.columns)')], dir)
  await run.exit
  evidence.tty = run.text()
}

async function lifetime(): Promise<void> {
  const run = open(BUN, [script('life.ts', 'console.log("one"); await Bun.sleep(1200); console.log("two")')], dir)
  evidence.lifetime = { exit: await run.exit, text: run.text() }
}

async function input(): Promise<void> {
  const run = open(
    BUN,
    [
      script(
        'prompt.ts',
        `process.stdin.setEncoding('utf8')
         process.stdout.write('name? ')
         process.stdin.on('data', (d) => { console.log('GOT[' + d.trim() + ']'); process.exit(0) })`,
      ),
    ],
    dir,
  )
  await until(() => run.text().includes('name?'))
  run.pty.write(`typed-marker${isWin ? '\r' : '\n'}`)
  evidence.input = { exit: await run.exit, text: run.text() }
}

/** Asked of the OS through a shell: Bun's own `stdout.columns` keeps its first value on Windows. */
async function resize(): Promise<void> {
  const run = isWin
    ? open(
        'powershell.exe',
        ['-NoProfile', '-Command', 'Write-Output ready; Start-Sleep -Seconds 2; Write-Output "cols=$($Host.UI.RawUI.WindowSize.Width)."'],
        dir,
      )
    : open('/bin/sh', ['-c', 'echo ready; sleep 1; echo "cols=$(stty size | cut -d" " -f2)."'], dir)
  await until(() => run.text().includes('ready'))
  run.pty.resize(133, 40)
  await run.exit
  evidence.resize = run.text()
}

/** A raw-mode program reads Ctrl-C as a key and exits by itself, on every OS. */
async function rawInterrupt(): Promise<void> {
  const run = open(
    BUN,
    [
      script(
        'raw.ts',
        `process.stdin.setRawMode(true)
         process.stdin.resume()
         console.log('ready')
         process.stdin.on('data', (d) => { if (d[0] === 3) process.exit(5) })`,
      ),
    ],
    dir,
  )
  await until(() => run.text().includes('ready'))
  const started = Date.now()
  run.pty.write('\x03')
  evidence.rawInterrupt = { exit: await run.exit, ms: Date.now() - started }
}

/**
 * A line-mode program behind the same shell a dev pane uses. POSIX: the terminal
 * raises SIGINT. Windows: Bun's ConPTY does not, so the two-second fallback ends it.
 */
async function lineInterrupt(): Promise<void> {
  const idle = script('idle.ts', 'console.log("ready"); setInterval(() => {}, 1000)')
  const { file, args } = devSpawnTarget(`"${BUN}" "${idle}"`)
  const run = open(file, args, dir)
  await until(() => run.text().includes('ready'))
  const started = Date.now()
  run.pty.write('\x03')
  evidence.lineInterrupt = { exit: await run.exit, ms: Date.now() - started }
}

/** The shell a dev pane uses, with a path and an argument that both need quoting. */
async function quoting(): Promise<void> {
  const spaced = join(dir, 'sp ace')
  await Bun.write(join(spaced, 'args.ts'), 'console.log("ARGS=" + JSON.stringify(process.argv.slice(2)))')
  const { file, args } = devSpawnTarget(`"${BUN}" "${join(spaced, 'args.ts')}" "two words" && echo AND-OK`)
  const run = open(file, args, dir)
  evidence.quoting = { exit: await run.exit, text: run.text() }
}

/** The tree dies with the session: the grandchild behind the shell included. */
async function killTree(): Promise<void> {
  const holder = script('holder.ts', 'console.log("HOLDER " + process.pid); setInterval(() => {}, 1000)')
  const { file, args } = devSpawnTarget(`"${BUN}" "${holder}"`)
  const run = open(file, args, dir)
  await until(() => /HOLDER\s+\d+/.test(run.text()))
  const pid = Number(run.text().match(/HOLDER\s+(\d+)/)?.[1])
  await run.pty.killTree()
  await until(() => !pidAlive(pid), 5000)
  evidence.killTree = { holderSeen: pid > 0, holderAlive: pidAlive(pid), exit: await run.exit }
}

/** A program that cannot start says so in the terminal rather than throwing. */
async function missing(): Promise<void> {
  const run = open(join(dir, 'no-such-program'), [], dir)
  evidence.missing = { exit: await run.exit, text: run.text() }
}

/** A write or resize after the program ended is a no-op, not a crash. */
async function afterExit(): Promise<void> {
  const run = open(BUN, [script('quick.ts', 'process.exit(0)')], dir)
  await run.exit
  run.pty.write('late')
  run.pty.resize(100, 30)
  run.pty.kill()
  evidence.afterExit = { killed: run.pty.killed }
}

const CHECKS = [output, isTty, lifetime, input, resize, rawInterrupt, lineInterrupt, quoting, killTree, missing, afterExit]

async function main(): Promise<void> {
  for (const check of CHECKS) {
    try {
      await check()
    } catch (err) {
      evidence[check.name] = { threw: err instanceof Error ? err.message : String(err) }
    }
  }
  rmSync(dir, { recursive: true, force: true })
  process.stdout.write(`EVIDENCE ${JSON.stringify(evidence)}\n`)
  process.exit(0)
}

void main()
