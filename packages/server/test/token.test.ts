import { describe, expect, it } from 'vitest'
import { TOKEN_USAGE, runToken } from '../src/bin/token'
import type { AfkTokenIo, TokenValidity } from '../src/services/setup'

const TOKEN = `sk-ant-oat01-${'a'.repeat(50)}${'b'.repeat(45)}`

function harness(seed = '', verdict: TokenValidity = { valid: true, detail: 'captured' }) {
  let content = seed
  const lines: string[] = []
  const io: AfkTokenIo = {
    read: () => content,
    write: (c) => (content = c),
    verify: async () => verdict,
  }
  return { lines, file: () => content, base: { log: (l: string) => lines.push(l), io } }
}

describe('runcastle token', () => {
  it('saves a paste that wrapped across lines and spaces, then replaces it on a second save', async () => {
    const h = harness('OTHER=1\n')
    const wrapped = `${TOKEN.slice(0, 40)}\n${TOKEN.slice(40, 70)} \r\n${TOKEN.slice(70)}\n`

    expect(await runToken([], { ...h.base, isTty: true, readHidden: async () => wrapped })).toBe(0)
    expect(h.file()).toBe(`OTHER=1\nCLAUDE_CODE_OAUTH_TOKEN=${TOKEN}\n`)

    const second = `${TOKEN}Z`
    await runToken([], { ...h.base, isTty: true, readHidden: async () => second })
    expect(h.file()).toBe(`OTHER=1\nCLAUDE_CODE_OAUTH_TOKEN=${second}\n`)
  })

  it('--stdin reads the piped value with no prompt, even without a terminal', async () => {
    const h = harness()
    expect(await runToken(['--stdin'], { ...h.base, isTty: false, readStdin: async () => `${TOKEN}\n` })).toBe(0)
    expect(h.file()).toBe(`CLAUDE_CODE_OAUTH_TOKEN=${TOKEN}\n`)
    expect(h.lines.join('\n')).not.toContain('setup-token')
  })

  it('without a terminal and without --stdin prints usage and returns 1', async () => {
    const h = harness()
    expect(await runToken([], { ...h.base, isTty: false })).toBe(1)
    expect(h.lines).toEqual([TOKEN_USAGE])
  })

  it('refuses a cut-off value before the env file is touched', async () => {
    const h = harness('KEEP=1\n')
    expect(await runToken(['--stdin'], { ...h.base, readStdin: async () => TOKEN.slice(0, 53) })).toBe(1)
    expect(h.file()).toBe('KEEP=1\n')
    expect(h.lines.join('\n')).toContain('cut off')
  })

  it('reports a rejected verdict and exits non-zero', async () => {
    const h = harness('', { valid: false, detail: 'rejected by API', fix: 'run claude setup-token' })
    expect(await runToken(['--stdin'], { ...h.base, readStdin: async () => TOKEN })).toBe(1)
    expect(h.lines.join('\n')).toContain('rejected by API')
  })
})
