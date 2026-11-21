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

/**
 * The limit notice itself, as a runtime writes it in place of a reply
 * (a-usage-limit-never-strands-work decision 2): it opens with the runtime's
 * own wording and is short. Claude Code's "You've hit your 5-hour limit ·
 * resets 8pm", its "Claude AI usage limit reached|…", Codex's "You've hit your
 * usage limit. …". Nothing else that is "limit reached" (an API's rate limit,
 * a context or max-turns limit) is the account's usage limit. A reply that only mentions or quotes the wording later in
 * its text is not the notice, so a chat that talks about limits is never held.
 */
const USAGE_LIMIT_NOTICE = /^(?:api error:\s*|error:\s*)?(?:you(?:'|’)ve (?:hit|reached) your\b[^.\n]{0,40}\blimit\b|(?:claude(?: ai)? )?(?:(?:\d+-hour|weekly|opus|sonnet) )?usage limit reached\b)/i

/** The longest reply that can still be the notice: a notice is a line or two. */
const NOTICE_MAX = 400

/** Whether a reply (or a sub-agent's result) is the usage limit notice itself. */
export function isUsageLimitNotice(text: string): boolean {
  const trimmed = text.trim()
  return trimmed.length > 0 && trimmed.length <= NOTICE_MAX && USAGE_LIMIT_NOTICE.test(trimmed)
}
