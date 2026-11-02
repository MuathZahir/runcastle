/**
 * A round the provider halted (small-fixes-before-publish decisions 10, 16):
 * which of three it was, and the waiting reason the feature shows for it. The
 * server writes the reason; the web's status line reads it back to offer
 * Resume, so both sides share these words rather than spelling them twice.
 */
export type ProviderHaltKind = 'usage' | 'billing' | 'auth'

export interface ProviderHalt {
  kind: ProviderHaltKind
  /** When the limit lifts, as the human reads it ("5pm", "Tue 5:30pm"); best-effort. */
  resets?: string
}

/** Every provider halt's waiting reason opens with one of these. */
export const PROVIDER_USAGE_LIMIT = 'provider usage limit'
export const PROVIDER_BILLING_PROBLEM = 'provider billing problem — check your account'
export const PROVIDER_SIGN_IN_FAILED = 'provider sign-in failed — check your login or API key'

/** The message Resume delivers to the lead as the human. */
export const PROVIDER_HALT_CLEARED = 'The provider halt is cleared — pick up where the round stopped.'

// Usage is read first, so Codex's `insufficient_quota` ("…check your plan and
// billing details") reads as the limit it is reported as; the same Resume
// follows either way. The auth list mirrors the burner's run-fatal credential
// patterns (ticket-burner.ts).
const USAGE = /usage limit|rate limit|quota|\blimit reached\b/i
const BILLING = /credit balance|billing/i
const AUTH =
  /authentication|unauthorized|invalid[ _](?:api[ _]key|x-api-key)|oauth token|setup-token|ACCOUNT_PERMISSION_DENIED/i

/** Claude Code's `…usage limit reached|<epoch seconds>` suffix. */
const EPOCH_SUFFIX = /\|(\d{9,11})\s*$/
/** A `resets 5pm` / `resets at 17:00 (UTC)` phrase. */
const RESETS_PHRASE = /\bresets?\s+(?:at\s+)?([^.,;|]+)/i

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const

/** A local wall-clock time: "5pm", "5:30pm", and the weekday first when it is not today. */
function clockTime(at: Date, now: Date): string {
  const h = at.getHours()
  const m = at.getMinutes()
  const time = `${h % 12 === 0 ? 12 : h % 12}${m ? `:${String(m).padStart(2, '0')}` : ''}${h < 12 ? 'am' : 'pm'}`
  return at.toDateString() === now.toDateString() ? time : `${DAYS[at.getDay()]} ${time}`
}

/**
 * Sort a halt headline into usage, billing or sign-in, reading a reset time
 * when the provider gave one. `null` when the halt is none of the three.
 */
export function classifyProviderHalt(headline: string, now: Date = new Date()): ProviderHalt | null {
  if (USAGE.test(headline)) {
    const epoch = EPOCH_SUFFIX.exec(headline)?.[1]
    const phrase = RESETS_PHRASE.exec(headline)?.[1]?.trim()
    const resets = epoch ? clockTime(new Date(Number(epoch) * 1000), now) : phrase || undefined
    return resets ? { kind: 'usage', resets } : { kind: 'usage' }
  }
  if (BILLING.test(headline)) return { kind: 'billing' }
  if (AUTH.test(headline)) return { kind: 'auth' }
  return null
}

/** The waiting reason a provider halt sets on its feature. */
export function providerHaltReason(halt: ProviderHalt): string {
  switch (halt.kind) {
    case 'usage':
      return halt.resets ? `${PROVIDER_USAGE_LIMIT} · resets ${halt.resets}` : PROVIDER_USAGE_LIMIT
    case 'billing':
      return PROVIDER_BILLING_PROBLEM
    case 'auth':
      return PROVIDER_SIGN_IN_FAILED
  }
}

/** The feature waits on a provider halt — the state Resume is offered (and accepted) in. */
export function isProviderHaltReason(reason: string | null | undefined): boolean {
  if (!reason) return false
  return (
    reason === PROVIDER_USAGE_LIMIT ||
    reason.startsWith(`${PROVIDER_USAGE_LIMIT} · `) ||
    reason === PROVIDER_BILLING_PROBLEM ||
    reason === PROVIDER_SIGN_IN_FAILED
  )
}
