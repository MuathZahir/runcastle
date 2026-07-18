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
  it('runs every probe against the host and returns a numeric exit code', async () => {
    const lines: string[] = []
    const code = await runCli([], (l) => lines.push(l))
    const out = lines.join('\n')
    expect(out).toContain('runcastle doctor')
    // git is present in the repo container -> that probe reports ok.
    expect(out).toMatch(/Git .*OK/i)
    expect(typeof code).toBe('number')
  })
})
