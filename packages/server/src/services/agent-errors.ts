import type { AgentRuntime } from '@runcastle/core'

/**
 * What an agent's failed turn means (burns-become-workers decision 8), moved
 * out of the burn engine so workers and burns read one table. Pure: no IO.
 *
 * - `transient`: infrastructure a retry has a real chance of surviving (a rate
 *   limit, an overload, a dropped connection, a stall);
 * - `fatal`: a retry can only fail the same way, but nothing beyond this agent
 *   is wrong (a model it cannot use, a conversation too long to continue);
 * - `account`: a fact about the account or the environment every other agent
 *   on that runtime would rediscover (bad login, no credit, a CLI too old).
 *
 * The usage limit is none of these: the agent host handles it under the
 * human's "Carry on when the usage limit resets" setting (decision 7), so it is
 * not in these tables; the burn engine adds it to its own run-fatal set.
 */
export type AgentErrorClass = 'transient' | 'fatal' | 'account'

/** The status numbers a closed door arrives as, whatever wording sits beside them. */
const REFUSAL_STATUS = String.raw`\b(?:401|403)\b`

/**
 * `forbidden` names an account only where the status it is the reason phrase
 * for is not sitting right beside it. `forbidden response: status 403` is a
 * CLI saying what was refused; `403 forbidden` is one refusal spelled twice,
 * and the reason phrase adds nothing the bare number did not already say — so
 * it may not stand in for the credential the pairing rule asks for.
 */
const DETACHED_FORBIDDEN = String.raw`(?<!${REFUSAL_STATUS}[\W_]*)forbidden(?![\W_]*${REFUSAL_STATUS})`

/**
 * What a refusal has to NAME for it to be the account's refusal rather than
 * this agent's. `permission denied` is equally how git and the filesystem
 * report a read-only path, and a bare `401`/`403` is how any HTTP call in the
 * sandbox reports a closed door — neither says whose door on its own, so the
 * patterns built from this pair with it, anywhere on the same line and in
 * either order, instead of standing alone. Missing a genuine auth wording
 * costs one agent a failure; holding every agent over a chmod costs them all.
 *
 * `auth` is spelled out to its endings — `authentication`, `authorized`,
 * `authn`/`authz` — rather than left as a loose substring, because `author`
 * spells it too, and `git author permission denied` names no credential.
 */
const CREDENTIAL_SUBJECT = String.raw`(?:api[ _-]?key|token|credential|login|auth(?:entic\w*|ori[sz]\w*|[nz])?\b|unauthorized|${DETACHED_FORBIDDEN}|account|organi[sz]ation|\borg\b)`

/**
 * A refusal wording paired with the credential subject, in EITHER order: which
 * side the account word lands on is an accident of each CLI's phrasing, not
 * evidence about whose door was closed, so `API token permission denied` and
 * `permission denied: invalid api key` are the same fact. Both halves must sit
 * on one line, so a `403` never borrows the word `token` from a stack frame ten
 * lines below it.
 */
function refusalNamingCredential(refusal: string): RegExp {
  return new RegExp(`(?:${refusal}[^\\n]*${CREDENTIAL_SUBJECT}|${CREDENTIAL_SUBJECT}[^\\n]*${refusal})`, 'i')
}

/** `permission denied`, but only where what was denied is the account's. */
const ACCOUNT_PERMISSION_DENIED = refusalNamingCredential(String.raw`permission denied`)

/**
 * A `401`/`403` — or its word, `forbidden` — that says what it refused. An
 * OpenAI auth failure arrives as a status beside its `invalid_api_key` or
 * `Unauthorized`, on whichever side the CLI happens to put it, while an
 * unrelated HTTP failure inside the sandbox arrives as the number alone — or
 * as the number beside its own reason phrase, `403 forbidden`.
 */
const REFUSED_CREDENTIAL_STATUS = refusalNamingCredential(String.raw`(?:${REFUSAL_STATUS}|forbidden)`)

/**
 * Claude Code's refusal of a model newer than itself, e.g. `API Error: 400
 * Claude Code 2.1.270 does not support this model; version 2.1.280 or newer is
 * required.` The in-use version is optional so a reworded prefix still reads.
 */
export const CLI_TOO_OLD = /(?:Claude Code\s+(\S+)\s+)?does not support this model[^\n]*?version\s+(\S+?)\s+or newer is required/i

/**
 * Account-level errors for every runtime: bad or lapsed credentials and an
 * exhausted balance. The runtime-specific lists are tagged rather than merged
 * so it stays visible which provider a pattern was written for — an OpenAI
 * `insufficient_quota` and an Anthropic `credit balance` are the same fact
 * spelled two ways, and neither CLI emits the other's string.
 */
const ACCOUNT_ERROR_PATTERNS: RegExp[] = [
  /invalid (api key|x-api-key)/i,
  /authentication|unauthorized/i,
  ACCOUNT_PERMISSION_DENIED,
  /credit balance|billing/i,
  /oauth token|setup-token/i,
]

/**
 * Per-runtime account wording. OpenAI reports auth as a 401 with an
 * `invalid_api_key` code and an exhausted account as `insufficient_quota` (a
 * billing fact no retry fixes, despite arriving as a 429). Codex on the
 * operator's borrowed `codex login` fails with the CLI's own wording — "not
 * logged in", a refused refresh token — fixed only by `codex login` on the host.
 * Claude Code's "too old for this model" is a fact about the CLI, not the
 * agent — and it arrives as an `API Error: 400`, which the transient `api
 * error` entry would otherwise retry.
 */
const RUNTIME_ACCOUNT_ERROR_PATTERNS: Record<AgentRuntime, RegExp[]> = {
  'claude-code': [CLI_TOO_OLD],
  codex: [
    /invalid_api_key/i,
    REFUSED_CREDENTIAL_STATUS,
    /insufficient_quota|exceeded your current quota/i,
    /CODEX_API_KEY/,
    // "unauthorized" and "authentication …" are already account-level for every runtime; these are the login wordings that are not.
    /not logged in/i,
    /\bauth (failed|required)\b/i,
    /refresh token/i,
  ],
}

/**
 * Exit 127 in any of the wordings a failing hook reports it with. Fatal for
 * every runtime: no retry installs a binary, and blindly retrying exactly this
 * is the worst behaviour the burner has been observed in. Checked before the
 * transient patterns, whose broad `exited with code N` entry would otherwise
 * send a missing command around the retry loop.
 */
const MISSING_COMMAND_PATTERNS: RegExp[] = [/\bexit(?:ed with)?(?: code)? 127\b/i, /command not found/i]

/**
 * Errors where a retry can only fail the same way, but which say nothing about
 * other agents — a model this one cannot use, a broken resume, a conversation
 * too long to continue. Checked BEFORE the transient patterns so "exited with
 * code 1: model not found" stays fatal.
 */
const FATAL_ERROR_PATTERNS: RegExp[] = [
  /issue with the selected model|model not found|unknown model/i,
  /does not support resumeSession|resumeSession .* not found/i,
  /prompt (is )?too long|context.?length.?exceeded|context window|maximum context length/i,
]

/** Per-runtime fatal wording: OpenAI's unusable model is a `model_not_found`, and a malformed request is this agent's problem alone. */
const RUNTIME_FATAL_ERROR_PATTERNS: Record<AgentRuntime, RegExp[]> = {
  'claude-code': [],
  codex: [/invalid_request_error/i, /model_not_found|does not exist or you do not have access/i],
}

/**
 * Transient infrastructure failures a retry has a real chance of surviving.
 * The broad `exited with code N` entry is any nonzero agent CLI exit — in
 * practice a dropped API stream, an OOM-killed process or a CLI crash, none of
 * which say anything about the work itself. `stalled` is the worker runner's
 * own word for a turn its watchdog cancelled (decision 9).
 */
const TRANSIENT_ERROR_PATTERNS: RegExp[] = [
  /exited with code \d+/i,
  /idle timeout|AgentIdleTimeout|\bstalled\b/i,
  /connection (closed|error|refused|reset)|socket hang up|fetch failed/i,
  /econnreset|etimedout|econnrefused|epipe|eai_again/i,
  /overloaded|rate.?limit|too many requests/i,
  /internal server error|service unavailable|bad gateway|gateway timeout/i,
  /\bapi error\b/i,
  /session capture failed/i,
]

/** Per-runtime transient wording. OpenAI's plain rate limit is a 429 with `rate_limit_exceeded`, unlike the `insufficient_quota` that shares its status code. */
const RUNTIME_TRANSIENT_ERROR_PATTERNS: Record<AgentRuntime, RegExp[]> = {
  'claude-code': [/\b429\b/],
  codex: [/rate_limit_exceeded/i, /\b429\b/, /server_error/i, /stream (disconnected|interrupted)/i],
}

/**
 * Classify an agent's error text. Account wins over fatal and fatal over
 * transient; anything unrecognised is `fatal` — an unknown failure could
 * compound if blindly retried, and is never `account`, so an unread wording
 * never holds every other agent.
 *
 * `runtime` narrows the provider-specific patterns to the CLI that produced the
 * text; omitted, every runtime's are considered (the strings do not collide).
 */
export function classifyAgentError(text: string, runtime?: AgentRuntime): AgentErrorClass {
  const runtimes: AgentRuntime[] = runtime ? [runtime] : ['claude-code', 'codex']
  const matches = (common: RegExp[], perRuntime: Record<AgentRuntime, RegExp[]>): boolean =>
    [...common, ...runtimes.flatMap((r) => perRuntime[r])].some((p) => p.test(text))
  if (matches(ACCOUNT_ERROR_PATTERNS, RUNTIME_ACCOUNT_ERROR_PATTERNS)) return 'account'
  if (MISSING_COMMAND_PATTERNS.some((p) => p.test(text))) return 'fatal'
  if (matches(FATAL_ERROR_PATTERNS, RUNTIME_FATAL_ERROR_PATTERNS)) return 'fatal'
  if (matches(TRANSIENT_ERROR_PATTERNS, RUNTIME_TRANSIENT_ERROR_PATTERNS)) return 'transient'
  return 'fatal'
}

/** Backoff before retry attempt `attempt + 1`: 5s, 10s, 20s, capped at 30s. */
export function retryDelayMs(attempt: number): number {
  return Math.min(30_000, 5_000 * 2 ** (attempt - 1))
}
