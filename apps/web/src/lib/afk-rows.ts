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
