import type { UsageLimit, UsageReport } from '@runcastle/core'

/**
 * Pure mappers from the ACP adapters' usage-limit and account data to core's
 * {@link UsageReport} (the usage popover). Both are total: anything unknown or
 * malformed degrades to fewer limits (at worst `{ limits: [] }`), never a throw.
 *
 * Inputs, per adapter (all optional, all unvalidated):
 * - Codex (`@agentclientprotocol/codex-acp`): the app server's
 *   `account/rateLimits/read` response — `{ rateLimits, rateLimitsByLimitId }`,
 *   each snapshot `{ primary, secondary: { usedPercent, windowDurationMins,
 *   resetsAt (epoch seconds) }, planType }` — plus the pushed `authStatus`
 *   `{ kind, label, account: { plan } }`.
 * - Claude (`@agentclientprotocol/claude-agent-acp`): the structured `/usage`
 *   response (`rate_limits: { five_hour, seven_day, seven_day_opus,
 *   seven_day_sonnet, model_scoped }`, windows `{ utilization, resets_at (ISO) }`,
 *   `subscription_type`) plus the pushed `authStatus` (same shape as above).
 * Both are passed as one object: `{ rateLimits | usage, authStatus }`.
 */

const FIVE_HOUR_LABEL = 'Current 5-hour window'
const WEEK_LABEL = 'This week'

type Obj = Record<string, unknown>

function obj(value: unknown): Obj | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Obj) : undefined
}

function num(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function str(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined
}

function clampPercent(value: number): number {
  return Math.round(Math.min(100, Math.max(0, value)))
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

/** "3:40 pm" when `at` is today (local), otherwise "Thu 9:00 am". Empty when `at` is not a date. */
export function formatResets(at: Date, now: Date = new Date()): string {
  if (Number.isNaN(at.getTime())) return ''
  const hours = at.getHours()
  const clock = `${hours % 12 === 0 ? 12 : hours % 12}:${String(at.getMinutes()).padStart(2, '0')} ${hours < 12 ? 'am' : 'pm'}`
  const today = at.toDateString() === now.toDateString()
  return today ? clock : `${WEEKDAYS[at.getDay()]} ${clock}`
}

function limit(label: string, percent: number | undefined, resets: Date | undefined): UsageLimit[] {
  if (percent === undefined) return []
  return [{ label, percent: clampPercent(percent), resets: resets ? formatResets(resets) : '' }]
}

/** "ChatGPT Pro" from the pushed auth status, else from a bare plan type. */
function planOf(authStatus: unknown, fallback: () => string | undefined): string | undefined {
  const status = obj(authStatus)
  if (status && status.kind === 'none') return undefined
  return str(status?.label) ?? fallback()
}

function titleCase(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1)
}

// ---- Codex ----

function codexWindowLabel(mins: number | undefined, fallback: string): string {
  if (mins === undefined) return fallback
  if (mins >= 7 * 24 * 60) return WEEK_LABEL
  if (mins === 300) return FIVE_HOUR_LABEL
  if (mins >= 24 * 60) return `Current ${Math.round(mins / (24 * 60))}-day window`
  if (mins >= 60) return `Current ${Math.round(mins / 60)}-hour window`
  return `Current ${mins}-minute window`
}

function codexSnapshotLimits(snapshot: unknown, prefix: string): UsageLimit[] {
  const snap = obj(snapshot)
  if (!snap) return []
  const windows: Array<[unknown, string]> = [
    [snap.primary, FIVE_HOUR_LABEL],
    [snap.secondary, WEEK_LABEL],
  ]
  return windows.flatMap(([raw, fallback]) => {
    const window = obj(raw)
    if (!window) return []
    const seconds = num(window.resetsAt)
    return limit(
      `${prefix}${codexWindowLabel(num(window.windowDurationMins), fallback)}`,
      num(window.usedPercent),
      seconds === undefined ? undefined : new Date(seconds * 1000),
    )
  })
}

export function codexUsageReport(raw: unknown): UsageReport {
  const input = obj(raw)
  if (!input) return { limits: [] }
  const byId = obj(input.rateLimitsByLimitId)
  const entries = byId ? Object.entries(byId).filter(([, snapshot]) => obj(snapshot)) : []
  const snapshots: Array<[string, unknown]> = entries.length > 0 ? entries : [['codex', input.rateLimits]]
  const limits = snapshots.flatMap(([id, snapshot]) => {
    // The base "codex" limit reads plainly; a named extra limit (a per-model one) is prefixed.
    const name = id === 'codex' ? '' : str(obj(snapshot)?.limitName) ?? id
    return codexSnapshotLimits(snapshot, name ? `${name} · ` : '')
  })
  const plan = planOf(input.authStatus, () => {
    const planType = str(obj(input.rateLimits)?.planType) ?? str(obj(snapshots[0]?.[1])?.planType)
    return planType && planType !== 'unknown' ? `ChatGPT ${titleCase(planType)}` : undefined
  })
  return { limits, ...(plan ? { plan } : {}) }
}

// ---- Claude ----

function claudeWindow(label: string, window: unknown): UsageLimit[] {
  const w = obj(window)
  if (!w) return []
  const iso = str(w.resets_at)
  return limit(label, num(w.utilization), iso ? new Date(iso) : undefined)
}

export function claudeUsageReport(raw: unknown): UsageReport {
  const input = obj(raw)
  if (!input) return { limits: [] }
  // The usage response may be passed bare or under `usage`.
  const usage = obj(input.usage) ?? input
  const rateLimits = obj(usage.rate_limits)
  const scoped = Array.isArray(rateLimits?.model_scoped) ? (rateLimits.model_scoped as unknown[]) : []
  const limits = rateLimits
    ? [
        ...claudeWindow(FIVE_HOUR_LABEL, rateLimits.five_hour),
        ...claudeWindow(WEEK_LABEL, rateLimits.seven_day),
        // `model_scoped` supersedes the fixed per-model keys; fall back to them when absent.
        ...(scoped.length > 0
          ? scoped.flatMap((entry) => {
              const name = str(obj(entry)?.display_name)
              return name ? claudeWindow(`${WEEK_LABEL} · ${name}`, entry) : []
            })
          : [
              ...claudeWindow(`${WEEK_LABEL} · Opus`, rateLimits.seven_day_opus),
              ...claudeWindow(`${WEEK_LABEL} · Sonnet`, rateLimits.seven_day_sonnet),
            ]),
      ]
    : []
  const plan = planOf(input.authStatus, () => {
    const subscription = str(usage.subscription_type)
    return subscription ? `Claude ${titleCase(subscription)}` : undefined
  })
  return { limits, ...(plan ? { plan } : {}) }
}
