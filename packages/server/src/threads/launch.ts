import { DEFAULT_RUNTIME, resolveModelEntry, type SessionRow } from '@runcastle/core'
import type { AppCtx } from '../db/types'
import { GateError, NotImplementedError } from '../errors'
import { serverUrlFor } from '../launcher/artifacts'
import { isUnguardedLead } from '../launcher/edit-guard'
import { runtimeAdapterFor } from '../launcher/runtimes'
import type { AcpLaunchSpec } from '../launcher/runtimes/types'
import { rosterConfig } from '../services/model-discovery'
import { getFeatureRow, projectForFeature } from '../services/repo'

/**
 * How a thread's agent is launched over ACP: its runtime's {@link AcpLaunchSpec}
 * for the row, briefed as the terminal launch briefs the same kind.
 *
 * A feature's main chat and side threads are briefed from the feature alone.
 * The kinds that carry a brief of their own (a scenario, a Fix-it, the project
 * and preparation chats) are briefed when they move onto the host.
 */
export async function acpLaunchFor(ctx: AppCtx, row: SessionRow): Promise<AcpLaunchSpec> {
  if (!row.featureId || (row.kind !== 'chat' && row.kind !== 'side')) {
    throw new NotImplementedError(`chat-as-web-components ticket 4: a ${row.kind} thread over ACP`)
  }
  const runtime = runtimeAdapterFor(row.runtime ?? DEFAULT_RUNTIME)
  if (!runtime.acpLaunch) throw new GateError(`${runtime.id} conversations do not run over ACP yet`)
  const ready = runtime.checkReady()
  if (!ready.ok) throw new GateError(`${ready.reason}. ${ready.doctorHint}`)
  const feature = getFeatureRow(ctx, row.featureId)
  const project = projectForFeature(ctx, feature)
  return runtime.acpLaunch({
    session: row,
    feature,
    project,
    config: ctx.config,
    ...(row.purpose ? { purpose: row.purpose } : {}),
    worktreePath: row.worktreePath,
    serverUrl: serverUrlFor(ctx.config),
    // A side thread runs on the chat step's model, as the launcher opens it.
    model: row.model ?? resolveModelEntry('chat', rosterConfig(ctx), project).id,
    // The launcher's posture for the feature's lead: nobody may be around to answer.
    ...(runtime.id === 'claude-code' && isUnguardedLead(row.kind) ? { permissionMode: 'bypassPermissions' } : {}),
  })
}
