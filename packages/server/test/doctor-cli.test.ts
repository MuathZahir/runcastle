import { describe, expect, it } from 'vitest'
import { parseMode, runCli } from '../src/doctor/cli'

describe('parseMode', () => {
  it('defaults to diagnostic', () => {
    expect(parseMode([])).toBe('diagnostic')
  })
  it('selects gate mode with --gate', () => {
    expect(parseMode(['--gate'])).toBe('gate')
  })
  it('selects gate mode with --boot', () => {
    expect(parseMode(['--boot'])).toBe('gate')
  })
})

describe('runCli (real wiring)', () => {
  /**
   * The only test here that leaves the process: it runs the real probe set,
   * which spawns a `--version` per tool — including ones a dev box does not
   * have, and a spawn that fails is slower than one that succeeds. Under the
   * full suite that comfortably outruns vitest's 5s default, so this carries an
   * explicit budget like every other real-process test in this package.
   */
  it('runs every probe against the host and returns a numeric exit code', async () => {
    const lines: string[] = []
    const code = await runCli([], (l) => lines.push(l))
    const out = lines.join('\n')
    expect(out).toContain('runcastle doctor')
    // git is present in the repo container -> that probe reports ok.
    expect(out).toMatch(/Git .*OK/i)
    expect(typeof code).toBe('number')
  }, 15000)
})
