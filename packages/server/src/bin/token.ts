import { RUNTIME_SPECS } from '../doctor/doctor'
import { createSystemExec } from '../doctor/system-exec'
import { checkClaudeToken } from '../doctor/token-check'
import { InvalidInputError } from '../errors'
import { fileAfkTokenIo, saveAfkCredential, type AfkTokenIo, type TokenValidity } from '../services/setup'

export const TOKEN_USAGE = [
  'usage: runcastle token [--stdin]',
  '  Saves the Claude Code token burns use when nobody is watching.',
  '  --stdin  read the whole token from stdin, no prompt: runcastle token --stdin < token.txt',
].join('\n')

/** How long a pasted line break may be followed by more text before Enter counts. */
const PASTE_QUIET_MS = 300

export interface TokenDeps {
  log?: (line: string) => void
  /** Whether stdin is a terminal. */
  isTty?: boolean
  /** Reads the whole of stdin to its end (the `--stdin` form). */
  readStdin?: () => Promise<string>
  /** Reads one value from the terminal without echoing it. */
  readHidden?: () => Promise<string>
  io?: AfkTokenIo
}

/** Ask the service itself: `claude --version` says nothing about the token. */
async function checkLive(token: string): Promise<TokenValidity> {
  const result = await checkClaudeToken(token)
  if (result.verdict === 'ok') return { valid: true, detail: 'A live call authenticated.' }
  if (result.verdict === 'unreachable') return { valid: true, detail: `Not tested: ${result.why}` }
  return { valid: false, detail: result.why, fix: RUNTIME_SPECS['claude-code'].afkFix }
}

async function readAllStdin(): Promise<string> {
  const chunks: Buffer[] = []
  for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk))
  return Buffer.concat(chunks).toString('utf8')
}

/**
 * Raw-mode read that echoes nothing. A line break ends input only once no more
 * text follows it for a moment, so a paste that wrapped across lines arrives whole.
 */
function readHiddenFromTerminal(): Promise<string> {
  return new Promise((resolve, reject) => {
    const stdin = process.stdin
    let value = ''
    let timer: ReturnType<typeof setTimeout> | undefined
    const finish = (fn: () => void) => {
      if (timer) clearTimeout(timer)
      stdin.off('data', onData)
      stdin.setRawMode(false)
      stdin.pause()
      process.stdout.write('\n')
      fn()
    }
    const onData = (chunk: Buffer) => {
      if (timer) clearTimeout(timer)
      for (const ch of chunk.toString('utf8')) {
        if (ch === '\u0003') return finish(() => reject(new Error('cancelled')))
        if (ch === '\u007f' || ch === '\b') value = value.slice(0, -1)
        else value += ch
      }
      if (/[\r\n]/.test(value)) timer = setTimeout(() => finish(() => resolve(value)), PASTE_QUIET_MS)
    }
    stdin.setRawMode(true)
    stdin.resume()
    stdin.on('data', onData)
  })
}

/** `runcastle token`: save the unattended Claude Code token. Returns the exit code. */
export async function runToken(argv: string[], deps: TokenDeps = {}): Promise<number> {
  const log = deps.log ?? console.log
  const fromStdin = argv.length === 1 && argv[0] === '--stdin'
  if (!fromStdin && argv.length > 0) {
    log(TOKEN_USAGE)
    return 1
  }
  const isTty = deps.isTty ?? Boolean(process.stdin.isTTY)
  // With no terminal and no --stdin there is nobody to paste.
  if (!fromStdin && !isTty) {
    log(TOKEN_USAGE)
    return 1
  }

  let raw: string
  try {
    if (fromStdin) {
      raw = await (deps.readStdin ?? readAllStdin)()
    } else {
      log('Run `claude setup-token`, then paste the whole value here and press Enter.')
      log('Nothing you paste is shown.')
      raw = await (deps.readHidden ?? readHiddenFromTerminal)()
    }
  } catch {
    log('Cancelled. Nothing was saved.')
    return 1
  }

  const io = deps.io ?? { ...fileAfkTokenIo(createSystemExec(), 'claude-code'), verify: checkLive }
  try {
    const verdict = await saveAfkCredential(io, raw, 'claude-code')
    if (verdict.valid) {
      log(`Saved. ${verdict.detail}`)
      return 0
    }
    log(`Saved, but the token was not accepted: ${verdict.detail}`)
    if (verdict.fix) log(verdict.fix)
    return 1
  } catch (err) {
    if (err instanceof InvalidInputError) {
      log(`${err.message} Nothing was saved.`)
      return 1
    }
    throw err
  }
}
