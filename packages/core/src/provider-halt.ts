/**
 * The account's usage limit as the runtimes word it (agents-are-woken-only-when-it-matters
 * decision 25): Claude Code's "You've hit your 5-hour limit", a runtime's
 * "usage limit reached". A plain rate limit (a 429 worth retrying) is not one.
 */
const USAGE_LIMIT = /\bhit your\b[^.\n]*\blimit\b|usage limit|\blimit reached\b/i

/** Whether an agent's turn ended on the account's usage limit. */
export function isUsageLimitText(text: string): boolean {
  return USAGE_LIMIT.test(text)
}
