import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { join, posix } from 'node:path'
import type { WorkerRow } from '@runcastle/core'
import * as z from 'zod'
import type { AppCtx } from '../db/types'
import { InvalidInputError, NotFoundError } from '../errors'
import { getSessionRow } from '../launcher/sessions'
import { featureContextWithGit, toolCreateFeature } from '../mcp/server'
import { mainChatExcerpt } from '../services/main-chat-excerpt'
import { getFeatureRow } from '../services/repo'
import { showFetchedFile } from '../threads/shown'
import type { SandboxEngine } from './engine'
import { IN } from './sandbox'
import type { WorkerToolHandler } from './tool-relay'
import { type WorkerSandbox, workersDir } from './worker'

/**
 * Runcastle's answers to the tools a worker calls through its relay
 * (interactive-workers decision 9): read the feature, show a file in its own
 * chat, park a backlog feature. Each reuses what the lead's own tools run on;
 * none can change the feature the worker works on.
 */

const ShowFileArgs = z.object({ path: z.string().min(1), caption: z.string().max(200).optional() })
const ParkFeatureArgs = z.object({ title: z.string().min(1), oneLiner: z.string().min(1), brief: z.string().min(1) })

function parsed<T>(schema: z.ZodType<T>, tool: string, args: unknown): T {
  const r = schema.safeParse(args)
  if (!r.success) throw new InvalidInputError(`${tool}: ${r.error.issues.map((i) => `${i.path.join('.') || 'input'} ${i.message}`).join('; ')}`)
  return r.data
}

/** The feature as a worker reads it: the lead's whole bundle, plus a quote of the lead's latest turns. */
export async function readFeatureForWorker(ctx: AppCtx, w: WorkerRow): Promise<unknown> {
  const feature = getFeatureRow(ctx, w.featureId)
  const { quote } = mainChatExcerpt(ctx, feature)
  return { feature: await featureContextWithGit(ctx, { featureId: feature.id }), leadLatestTurns: quote ?? null }
}

/** Show a file from the worker's sandbox in the worker's own chat: copied out by the engine, then shown as `show_file` shows. */
export async function showSandboxFile(
  ctx: AppCtx,
  w: WorkerRow,
  sb: WorkerSandbox,
  engine: SandboxEngine,
  input: { path: string; caption?: string | undefined },
): Promise<{ shown: true; name: string }> {
  const containerPath = posix.resolve(IN.repo, input.path)
  mkdirSync(workersDir(), { recursive: true })
  const tmp = mkdtempSync(join(workersDir(), 'shown-'))
  try {
    const file = join(tmp, posix.basename(containerPath))
    await engine.copyOut(sb, containerPath, file)
    const inRepo = containerPath.startsWith(`${IN.repo}/`)
    const shown = showFetchedFile(ctx, w.id, {
      file,
      path: inRepo ? posix.relative(IN.repo, containerPath) : containerPath,
      caption: input.caption,
    })
    return { shown: true, name: shown.name }
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
}

/** Park a draft feature in the worker's project's backlog, as a lead's `create_feature({ draft: true })` does. */
export async function parkFeatureForWorker(ctx: AppCtx, w: WorkerRow, input: { title: string; oneLiner: string; brief: string }): Promise<{ slug: string }> {
  const session = getSessionRow(ctx, w.id)
  if (!session) throw new NotFoundError(`no thread for worker ${w.id}`)
  const created = await toolCreateFeature(ctx, session, { ...input, draft: true })
  return { slug: created.slug }
}

/** The relay's handler for one worker: each call's text answer. */
export function workerTools(ctx: AppCtx, w: WorkerRow, sb: WorkerSandbox, engine: SandboxEngine): WorkerToolHandler {
  return async (tool, args) => {
    switch (tool) {
      case 'read_feature':
        return JSON.stringify(await readFeatureForWorker(ctx, w))
      case 'show_file': {
        const shown = await showSandboxFile(ctx, w, sb, engine, parsed(ShowFileArgs, tool, args))
        return `Shown ${shown.name} in this chat.`
      }
      case 'park_feature': {
        const { slug } = await parkFeatureForWorker(ctx, w, parsed(ParkFeatureArgs, tool, args))
        return `Parked as a draft in the backlog: ${slug}. Tell the human in a line; it starts only when they start it.`
      }
      default:
        throw new InvalidInputError(`runcastle has no worker tool ${tool}`)
    }
  }
}
