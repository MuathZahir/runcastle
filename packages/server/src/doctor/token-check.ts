import { tmpdir } from 'node:os'
import { RUNTIME_SPECS, type ExecOutcome } from './doctor'
import { createSystemExec } from './system-exec'

/** What a real call made of a token. `unreachable` says nothing about the token. */
export type TokenCheck =
  | { verdict: 'ok' }
  | { verdict: 'rejected'; why: string }
  | { verdict: 'unreachable'; why: string }

/** The wording a CLI refuses a credential in, as opposed to any other failure. */
const REFUSED = /invalid|unauthori[sz]ed|authenticat|\b40[13]\b|\/login|log ?in|expired|revoked/i

/** Read a `claude -p` call's outcome. Only a clear refusal counts against the token. */
export function classifyTokenCheck(out: ExecOutcome): TokenCheck {
  if (!out.ok) return { verdict: 'unreachable', why: 'could not launch claude' }
  if (out.timedOut) return { verdict: 'unreachable', why: 'the call timed out' }
  if (out.code === 0) return { verdict: 'ok' }
  const lines = `${out.stdout}\n${out.stderr}`
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('Warning:'))
  const refusal = lines.find((line) => REFUSED.test(line))
  if (refusal) return { verdict: 'rejected', why: refusal }
  return { verdict: 'unreachable', why: lines[0] ?? `exit ${out.code ?? 'unknown'}` }
}

/** Long enough for a cold CLI start and one short model turn. */
const TOKEN_CHECK_TIMEOUT_MS = 60_000

/**
 * Test the Claude Code AFK token with one real turn on the smallest model.
 * `claude auth status` will not do: it reports the login state, not whether the
 * token authenticates.
 *
 * Other Anthropic credentials are removed from the call's environment, because
 * they outrank the OAuth token and would make the check test the wrong thing. It
 * runs from the temp dir so the project's own settings and hooks stay out of it.
 */
export async function checkClaudeToken(token: string): Promise<TokenCheck> {
  const { ANTHROPIC_API_KEY: _key, ANTHROPIC_AUTH_TOKEN: _auth, ...inherited } = process.env
  const exec = createSystemExec({
    cwd: tmpdir(),
    timeoutMs: TOKEN_CHECK_TIMEOUT_MS,
    // `claude -p` waits for piped stdin, and says so in the output.
    noStdin: true,
    env: { ...inherited, [RUNTIME_SPECS['claude-code'].afkKey]: token },
  })
  return classifyTokenCheck(
    await exec(RUNTIME_SPECS['claude-code'].bin, [
      '-p',
      'Reply with the word ok.',
      '--model',
      'haiku',
      '--max-turns',
      '1',
    ]),
  )
}
