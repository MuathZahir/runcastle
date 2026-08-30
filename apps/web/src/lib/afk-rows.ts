/**
 * Which credential the Enable-AFK card asks each runtime for, folded out of the
 * doctor report (decision 6: one row per runtime, each actionable on its own).
 *
 * The two runtimes do not answer the same question. Claude Code's unattended
 * credential is a token minted by `claude setup-token` and pasted in, so its row
 * is driven by the `afk-key` probe. A Codex burn borrows the file `codex login`
 * already wrote (decision 4), so there is nothing to paste — its row is driven
 * by the `auth` probe, and signing in is the whole of the setup. Keeping that
 * mapping here means the card renders rows rather than deciding what they are.
 */

import { AGENT_RUNTIMES, type AgentRuntime } from '@runcastle/core'
import type { ProbeLike } from './first-run'
import { RUNTIME_LABEL } from './settings'

/** How a runtime's AFK credential is obtained: minted and pasted, or logged in. */
export type AfkCredentialKind = 'token' | 'sign-in'

/** The probe that decides each runtime's row, and the row it asks for. */
const AFK_CREDENTIAL_SOURCE: Record<AgentRuntime, { check: string; kind: AfkCredentialKind }> = {
  'claude-code': { check: 'afk-key', kind: 'token' },
  codex: { check: 'auth', kind: 'sign-in' },
}

export interface AfkCredentialRow<P> {
  runtime: AgentRuntime
  kind: AfkCredentialKind
  /** The probe whose status this row reports and acts on. */
  probe: P
}

/**
 * One credential row per runtime, ordered by {@link AGENT_RUNTIMES}. A runtime
 * whose driving probe is not in the report yields no row — a report still in
 * flight shows nothing rather than an invented gap, and a stray probe (a Codex
 * `afk-key` row from an older server) drives no row at all.
 */
export function afkCredentialRows<P extends ProbeLike>(
  probes: readonly P[],
): AfkCredentialRow<P>[] {
  return AGENT_RUNTIMES.flatMap((runtime) => {
    const { check, kind } = AFK_CREDENTIAL_SOURCE[runtime]
    const probe = probes.find((p) => p.runtime === runtime && p.check === check)
    return probe ? [{ runtime, kind, probe }] : []
  })
}

/**
 * One row of the Burns page's prerequisites checklist (decision 9), named apart
 * from the probe that drives it: a probe label reads as a diagnostic
 * ("Claude Code AFK OAuth token (CLAUDE_CODE_OAUTH_TOKEN)"), and this is a
 * checklist the human scans.
 */
export interface BurnPrerequisite {
  /** Stable row id: the `data-field` a deep link scrolls to, and the filter's key. */
  field: string
  label: string
  /**
   * What the summary says is in the way while this row is not ok. Absent on a
   * row that is not a readiness condition — the burn cache is a convenience, and
   * a burn runs without it.
   */
  reason?: string
  /** Everything a filter query may match: a checklist row has no `SettingRow`. */
  terms: string[]
}

/** The `data-field` a runtime's credential row carries. */
export function afkCredentialField(runtime: AgentRuntime): string {
  return `${AFK_CREDENTIAL_SOURCE[runtime].check}-${runtime}`
}

function credentialPrerequisite(runtime: AgentRuntime): BurnPrerequisite {
  const label = RUNTIME_LABEL[runtime]
  const token = AFK_CREDENTIAL_SOURCE[runtime].kind === 'token'
  return {
    field: afkCredentialField(runtime),
    label: token ? `${label} token` : label,
    reason: token ? `burns with ${label} need a token` : `sign in to ${label}`,
    terms: token ? [label, 'token', 'AFK credential'] : [label, 'sign in', 'login'],
  }
}

/** The checklist, in render order. */
export const BURN_PREREQUISITES: readonly BurnPrerequisite[] = [
  {
    field: 'container-runtime',
    label: 'Container runtime',
    reason: 'no container runtime on this machine',
    terms: ['Container runtime', 'Docker', 'Podman'],
  },
  {
    field: 'sandcastle-image',
    label: 'Sandcastle image',
    reason: 'the sandcastle image needs building',
    terms: ['Sandcastle image', 'build', 'rebuild'],
  },
  ...AGENT_RUNTIMES.map(credentialPrerequisite),
  { field: 'burn-cache', label: 'Burn cache', terms: ['Burn cache', 'volume', 'clear'] },
]

/** How the checklist's summary line reads, over the rows that gate a burn. */
export interface AfkReadiness {
  /** The bold lead-in ("3 of 4"), or null once nothing is outstanding. */
  count: string | null
  /** The rest of the line — what is in the way, or that nothing is. */
  text: string
}

/**
 * The one line above the checklist: how many prerequisites are ready, and the
 * first thing standing in the way. Only rows that gate a burn are counted — the
 * burn cache has no probe and passes none in.
 */
export function afkReadiness(rows: readonly { ok: boolean; reason: string }[]): AfkReadiness {
  const blocker = rows.find((r) => !r.ok)
  if (!blocker) return { count: null, text: 'Ready for unattended burns' }
  return {
    count: `${rows.filter((r) => r.ok).length} of ${rows.length}`,
    text: `ready — ${blocker.reason}`,
  }
}
