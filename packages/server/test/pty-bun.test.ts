import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { beforeAll, describe, expect, it } from 'vitest'
import { resolveBun } from './helpers/bun'

/**
 * The terminal the product ships, from inside a real Bun process. vitest runs on
 * node, which has no `Bun.spawn`, so this spawns `bun` on the fixture once and
 * asserts each check of its evidence. Skipped only when no `bun` can be found.
 */

const FIXTURE = fileURLToPath(new URL('./fixtures/pty-bun.ts', import.meta.url))
const BUN = resolveBun()
const isWin = process.platform === 'win32'

/** The whole fixture, sequentially: a dozen short programs plus a two-second fallback. */
const FIXTURE_TIMEOUT_MS = 120_000

interface Exit {
  exitCode: number
  signal?: number
}

interface Evidence {
  isBun: boolean
  output: { exit: Exit; text: string }
  tty: string
  lifetime: { exit: Exit; text: string }
  input: { exit: Exit; text: string }
  resize: string
  rawInterrupt: { exit: Exit | 'timeout'; ms: number }
  lineInterrupt: { exit: Exit | 'timeout'; ms: number }
  quoting: { exit: Exit; text: string }
  killTree: { holderSeen: boolean; holderAlive: boolean; exit: Exit | 'timeout' }
  missing: { exit: Exit; text: string }
  afterExit: { killed: boolean }
}

function runFixture(bun: string): Promise<string> {
  return new Promise((resolve) => {
    const child = spawn(bun, [FIXTURE], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
    let output = ''
    child.stdout?.setEncoding('utf8')
    child.stdout?.on('data', (c: string) => {
      output += c
    })
    child.stderr?.setEncoding('utf8')
    child.stderr?.on('data', (c: string) => {
      output += c
    })
    child.on('error', (err) => resolve(`${output}\nspawn error: ${err.message}`))
    child.on('close', () => resolve(output))
  })
}

describe.skipIf(BUN === null)('the terminal backend under Bun', () => {
  let evidence: Evidence
  let output = ''

  beforeAll(async () => {
    output = await runFixture(BUN as string)
    const line = output.split(/\r?\n/).find((l) => l.startsWith('EVIDENCE '))
    expect(line, `fixture printed no evidence line. Full output:\n${output}`).toBeDefined()
    evidence = JSON.parse((line as string).slice('EVIDENCE '.length)) as Evidence
  }, FIXTURE_TIMEOUT_MS)

  it('runs under Bun', () => {
    expect(evidence.isBun).toBe(true)
  })

  it('delivers output, UTF-8 intact, and the exit code', () => {
    expect(evidence.output.text).toContain('hi-marker é✓')
    expect(evidence.output.exit.exitCode).toBe(7)
  })

  it('looks like a terminal to the program, at the size it was opened', () => {
    expect(evidence.tty).toContain('tty=true')
    expect(evidence.tty).toContain('cols=120')
  })

  it('keeps delivering output after the first line and exits normally', () => {
    expect(evidence.lifetime.text).toContain('one')
    expect(evidence.lifetime.text).toContain('two')
    expect(evidence.lifetime.exit).toEqual({ exitCode: 0 })
  })

  it('delivers typed input to the program', () => {
    expect(evidence.input.text).toContain('GOT[typed-marker]')
    expect(evidence.input.exit.exitCode).toBe(0)
  })

  it('tells the program about a resize', () => {
    expect(evidence.resize).toContain('cols=133.')
  })

  it('hands Ctrl-C to a raw-mode program as a key', () => {
    expect(evidence.rawInterrupt.exit).toEqual({ exitCode: 5 })
  })

  it('ends a line-mode program on Ctrl-C', () => {
    expect(evidence.lineInterrupt.exit).not.toBe('timeout')
    // Windows has only the fallback, so the program must last until it fires;
    // anywhere else the terminal interrupts it straight away.
    if (isWin) expect(evidence.lineInterrupt.ms).toBeGreaterThanOrEqual(1900)
    else expect(evidence.lineInterrupt.ms).toBeLessThan(1900)
  })

  it('runs a shell command that quotes its path and arguments', () => {
    expect(evidence.quoting.text).toContain('ARGS=["two words"]')
    expect(evidence.quoting.text).toContain('AND-OK')
    expect(evidence.quoting.exit.exitCode).toBe(0)
  })

  it('kills the whole tree, the grandchild behind the shell included', () => {
    expect(evidence.killTree.holderSeen).toBe(true)
    expect(evidence.killTree.holderAlive).toBe(false)
    expect(evidence.killTree.exit).not.toBe('timeout')
  })

  it('explains a program that cannot start, in the terminal', () => {
    expect(evidence.missing.text).toContain('no-such-program')
    expect(evidence.missing.exit.exitCode).toBe(1)
  })

  it('ignores a write, resize or kill after the program ended', () => {
    expect(evidence.afterExit.killed).toBe(true)
  })
})
