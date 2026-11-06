import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { type Feature, type SessionRow, resolveModelEntry } from '@runcastle/core'
import { envPath } from '@runcastle/core/paths'
import type { AppCtx } from '../db/types'
import { createSessionRow, newestThread, setSessionTitle } from '../launcher/sessions'
import { emit } from '../services/events'
import { deliverToLead } from '../services/lead-delivery'
import { rosterConfig } from '../services/model-discovery'
import { projectForFeature, tryGetFeature } from '../services/repo'
import type { AgentTransport } from '../threads/host'
import type { StopReason } from '../threads/types'
import { agentHost } from '../threads/types'
import { resolveSandboxImage } from '@runcastle/core'
import type { Engine } from './sandbox'
import { createWorkerSandbox, isWorker, readWorker, stopSandbox, takeHandback, workerKickoff, workerProcess, workersDir } from './worker'

/**
 * The workers spike, bound to the app (decisions 4, 10, 23, 24, 26): a lead
 * starts a worker; it is a side thread of the feature labelled "Worker: …",
 * whose process runs inside its sandbox; a handback read at turn end wakes the
 * lead once. Only with `experimentalWorkers` on.
 */

export function workersEnabled(ctx: AppCtx): boolean {
  return ctx.config.experimentalWorkers === true
}

/** The Claude token burns use, from the environment or the data dir's `.env`. */
export function claudeToken(): string {
  const fromEnv = process.env.CLAUDE_CODE_OAUTH_TOKEN
  if (fromEnv) return fromEnv
  const file = envPath()
  if (existsSync(file)) {
    const m = readFileSync(file, 'utf8').match(/^\s*CLAUDE_CODE_OAUTH_TOKEN\s*=\s*"?([^"\r\n]+)"?/m)
    if (m?.[1]) return m[1]
  }
  throw new Error('no CLAUDE_CODE_OAUTH_TOKEN: run `claude setup-token` and put it in the data dir .env')
}

/** Route a worker's thread to its sandbox; every other thread to `base`. */
export function withWorkers(ctx: AppCtx, base: AgentTransport): AgentTransport {
  return (spec, row) => {
    const rec = workersEnabled(ctx) ? readWorker(row.id) : undefined
    if (!rec) return base(spec, row)
    const model = (spec.sessionMeta as { claudeCode?: { options?: { model?: string } } } | undefined)?.claudeCode?.options?.model
    return workerProcess(rec, claudeToken(), model)
  }
}

export interface StartWorkerInput {
  label: string
  goal: string
  doneWhen: string
}

/** Start a worker for `feature`: its thread, its sandbox, then its kickoff. Returns once the sandbox is up. */
export async function startWorker(ctx: AppCtx, feature: Feature, input: StartWorkerInput): Promise<{ sessionId: string; previewUrl: string; branch: string }> {
  if (!workersEnabled(ctx)) throw new Error('workers are off (experimentalWorkers)')
  const engine: Engine = ctx.config.sandbox === 'podman' ? 'podman' : 'docker'
  const project = projectForFeature(ctx, feature)
  const model = resolveModelEntry('chat', rosterConfig(ctx), project)
  if (model.runtime !== 'claude-code') throw new Error('workers run on Claude Code only (decision 14)')
  const mainChat = newestThread(ctx, { featureId: feature.id }, 'chat')
  const placeholder = join(workersDir(), 'host')
  mkdirSync(placeholder, { recursive: true })
  const row = createSessionRow(ctx, {
    featureId: feature.id,
    kind: 'side',
    // Nothing of the worker lives on the host: a stand-in dir, so host-side snapshots find nothing.
    worktreePath: placeholder,
    model,
    ...(mainChat ? { openedBeside: mainChat.id } : {}),
  })
  setSessionTitle(ctx, row.id, `Worker: ${input.label}`)
  const rec = await createWorkerSandbox({
    id: row.id,
    featureId: feature.id,
    label: input.label,
    goal: input.goal,
    doneWhen: input.doneWhen,
    engine,
    image: resolveSandboxImage(ctx.config, project),
    repoPath: project.repoPath,
    featureBranch: feature.branch,
  })
  emit(ctx, feature.id, {
    type: 'worker.started',
    message: `worker "${input.label}" started in its sandbox`,
    data: { sessionId: row.id, container: rec.container, branch: rec.branch, previewUrl: rec.previewUrl, timings: rec.timings },
  })
  await agentHost(ctx).prompt(row.id, { text: workerKickoff(rec) }, { source: 'runcastle' })
  return { sessionId: row.id, previewUrl: rec.previewUrl, branch: rec.branch }
}

/** A worker's turn ended: a new handback wakes its lead once (decision 10). */
export async function workerTurnEnded(ctx: AppCtx, row: SessionRow): Promise<void> {
  const rec = readWorker(row.id)
  if (!rec?.featureId) return
  const handback = await takeHandback(rec)
  if (!handback) return
  const feature = tryGetFeature(ctx, rec.featureId)
  if (!feature) return
  emit(ctx, feature.id, {
    type: 'worker.handed_back',
    message: `worker "${rec.label}" handed back`,
    data: { sessionId: row.id, commits: handback.commits.length, files: handback.files.length },
  })
  const text = [
    `Worker "${rec.label}" handed back (thread ${row.id}, branch ${rec.branch}; nothing landed).`,
    '',
    handback.summary,
    '',
    `Commits on ${rec.branch} since ${rec.featureBranch}:`,
    ...(handback.commits.length ? handback.commits.map((c) => `- ${c}`) : ['- none']),
    ...(handback.files.length ? ['', `Files: ${handback.files.join(', ')}`] : []),
    '',
    `To take the work: git merge ${rec.branch}. Preview: ${rec.previewUrl}`,
  ].join('\n')
  await deliverToLead(ctx, feature, { text, source: 'runcastle' })
}

/** A worker's process stopped: an idle or archive stop stops its sandbox too (decision 8). */
export async function workerStopped(ctx: AppCtx, row: SessionRow, reason: StopReason): Promise<void> {
  const rec = readWorker(row.id)
  if (!rec) return
  if (reason !== 'idle' && reason !== 'archived') return
  await stopSandbox(rec)
  if (rec.featureId && tryGetFeature(ctx, rec.featureId)) {
    emit(ctx, rec.featureId, { type: 'worker.stopped', message: `worker "${rec.label}" sandbox stopped (${reason})`, data: { sessionId: row.id } })
  }
}

export { isWorker }
