import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { query, type ModelInfo } from '@anthropic-ai/claude-agent-sdk'
import {
  type DiscoveredModel,
  type DiscoverySource,
  DiscoverySnapshot,
  EMPTY_DISCOVERY_SNAPSHOT,
  discoveredEntries,
  type ModelConfig,
} from '@runcastle/core'
import { dataDir } from '@runcastle/core/paths'
import * as z from 'zod'
import type { AppCtx } from '../db/types'
import { claudeRuntime } from '../launcher/runtimes/claude'
import { codexHomeDir } from './codex-auth'
import { emitProject } from './events'

const CLAUDE_DISCOVERY_TIMEOUT_MS = 30_000

interface ClaudeDiscoveryQuery {
  initializationResult(): Promise<{ models: ModelInfo[] }>
  close(): void
}

export interface ClaudeDiscoveryIO {
  createQuery(input: {
    prompt: AsyncIterable<unknown>
    pathToClaudeCodeExecutable: string
  }): ClaudeDiscoveryQuery
  resolveBinary(): string
  timeoutMs: number
}

async function* noPrompts(): AsyncGenerator<never> {}

const defaultClaudeIO: ClaudeDiscoveryIO = {
  createQuery: ({ prompt, pathToClaudeCodeExecutable }) =>
    query({
      prompt: prompt as Parameters<typeof query>[0]['prompt'],
      options: { pathToClaudeCodeExecutable },
    }),
  resolveBinary: () => claudeRuntime.resolveBinary(),
  timeoutMs: CLAUDE_DISCOVERY_TIMEOUT_MS,
}

/** Ask the account-aware Claude Code picker for its models without sending a turn. */
export async function discoverClaudeModels(
  io: ClaudeDiscoveryIO = defaultClaudeIO,
): Promise<DiscoveredModel[]> {
  const q = io.createQuery({
    prompt: noPrompts(),
    pathToClaudeCodeExecutable: io.resolveBinary(),
  })
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    const initialization = await Promise.race([
      q.initializationResult(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`Claude model discovery timed out after ${io.timeoutMs}ms`)),
          io.timeoutMs,
        )
      }),
    ])
    const byId = new Map<string, DiscoveredModel>()
    for (const model of initialization.models) {
      const id = (model.resolvedModel ?? model.value).trim()
      if (!id || byId.has(id)) continue
      byId.set(id, {
        id,
        runtime: 'claude-code',
        displayName: model.displayName,
        description: model.description,
      })
    }
    return [...byId.values()]
  } finally {
    if (timer) clearTimeout(timer)
    q.close()
  }
}

const CodexUpgrade = z
  .object({
    model: z.string(),
    retirement_at: z.string(),
  })
  .passthrough()

const CodexCache = z
  .object({
    models: z.array(
      z
        .object({
          slug: z.string().min(1),
          display_name: z.string(),
          description: z.string(),
          visibility: z.enum(['list', 'hide']),
          priority: z.number(),
          upgrade: CodexUpgrade.nullable(),
        })
        .passthrough(),
    ),
  })
  .passthrough()

export interface CodexDiscoveryIO {
  env: Record<string, string | undefined>
  readFile(path: string): Promise<string>
}

const defaultCodexIO: CodexDiscoveryIO = {
  env: process.env,
  readFile: (path) => readFile(path, 'utf8'),
}

/** Read the same account-fed cache that backs the Codex CLI's model picker. */
export async function discoverCodexModels(
  io: CodexDiscoveryIO = defaultCodexIO,
): Promise<DiscoveredModel[]> {
  const path = join(codexHomeDir(io.env), 'models_cache.json')
  let raw: string
  try {
    raw = await io.readFile(path)
  } catch (error) {
    if (errorCode(error) === 'ENOENT') {
      throw new Error('no Codex models cache — log in to Codex')
    }
    throw new Error(`could not read Codex models cache: ${errorMessage(error)}`)
  }

  let cache: z.infer<typeof CodexCache>
  try {
    cache = CodexCache.parse(JSON.parse(raw))
  } catch (error) {
    throw new Error(`invalid Codex models cache: ${errorMessage(error)}`)
  }

  return cache.models
    .filter((model) => model.visibility === 'list')
    .sort((a, b) => a.priority - b.priority)
    .map((model) => ({
      id: model.slug,
      runtime: 'codex' as const,
      displayName: model.display_name,
      description: model.description,
      ...(model.upgrade
        ? {
            retirement: {
              at: model.upgrade.retirement_at,
              replacement: model.upgrade.model,
            },
          }
        : {}),
    }))
}

function errorCode(error: unknown): string | undefined {
  return typeof error === 'object' && error !== null && 'code' in error
    ? String(error.code)
    : undefined
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function snapshotPath(): string {
  return join(dataDir(), 'discovered-models.json')
}

export function readDiscoverySnapshot(): DiscoverySnapshot {
  try {
    return DiscoverySnapshot.parse(JSON.parse(readFileSync(snapshotPath(), 'utf8')))
  } catch {
    return EMPTY_DISCOVERY_SNAPSHOT
  }
}

export function writeDiscoverySnapshot(snapshot: DiscoverySnapshot): void {
  const path = snapshotPath()
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, `${JSON.stringify(DiscoverySnapshot.parse(snapshot), null, 2)}\n`, 'utf8')
}

const cachedSnapshots = new WeakMap<AppCtx, DiscoverySnapshot>()
const refreshes = new WeakMap<AppCtx, Promise<DiscoverySnapshot>>()

export function discoverySnapshot(ctx: AppCtx): DiscoverySnapshot {
  const cached = cachedSnapshots.get(ctx)
  if (cached) return cached
  const snapshot = readDiscoverySnapshot()
  cachedSnapshots.set(ctx, snapshot)
  return snapshot
}

export function rosterConfig(ctx: AppCtx): ModelConfig {
  return { ...ctx.config, discovered: discoveredEntries(discoverySnapshot(ctx)) }
}

export interface ModelDiscoveryDependencies {
  discoverClaude(): Promise<DiscoveredModel[]>
  discoverCodex(): Promise<DiscoveredModel[]>
  now(): number
}

const defaultDiscoveryDependencies: ModelDiscoveryDependencies = {
  discoverClaude: () => discoverClaudeModels(),
  discoverCodex: () => discoverCodexModels(),
  now: () => Date.now(),
}

/** Refresh both providers once; concurrent callers share the same in-flight run. */
export function refreshModelDiscovery(
  ctx: AppCtx,
  dependencies: ModelDiscoveryDependencies = defaultDiscoveryDependencies,
): Promise<DiscoverySnapshot> {
  const active = refreshes.get(ctx)
  if (active) return active

  const refresh = runRefresh(ctx, dependencies).finally(() => {
    if (refreshes.get(ctx) === refresh) refreshes.delete(ctx)
  })
  refreshes.set(ctx, refresh)
  return refresh
}

async function runRefresh(
  ctx: AppCtx,
  dependencies: ModelDiscoveryDependencies,
): Promise<DiscoverySnapshot> {
  const previous = discoverySnapshot(ctx)
  const attemptedAt = dependencies.now()
  const [claude, codex] = await Promise.allSettled([
    dependencies.discoverClaude(),
    dependencies.discoverCodex(),
  ])
  const snapshot = DiscoverySnapshot.parse({
    sources: {
      'claude-code': nextSource(previous.sources['claude-code'], claude, attemptedAt),
      codex: nextSource(previous.sources.codex, codex, attemptedAt),
    },
  })

  writeDiscoverySnapshot(snapshot)
  cachedSnapshots.set(ctx, snapshot)
  if (discoveryChanged(previous, snapshot)) {
    emitProject(ctx, 'global', {
      type: 'settings.updated',
      message: 'model discovery refreshed',
      data: { key: 'discovery' },
    })
  }
  return snapshot
}

function nextSource(
  previous: DiscoverySource,
  result: PromiseSettledResult<DiscoveredModel[]>,
  attemptedAt: number,
): DiscoverySource {
  if (result.status === 'rejected') {
    return {
      ...previous,
      status: 'failed',
      lastAttemptAt: attemptedAt,
      error: errorMessage(result.reason),
    }
  }

  const previousIds = previous.models.map((model) => model.id)
  const ids = result.value.map((model) => model.id)
  const sameIds = arrayEqual(previousIds, ids)
  return {
    status: 'ok',
    lastAttemptAt: attemptedAt,
    lastSuccessAt: attemptedAt,
    models: result.value,
    newIds:
      previous.status === 'never'
        ? []
        : sameIds
          ? previous.newIds
          : ids.filter((id) => !previousIds.includes(id)),
  }
}

function discoveryChanged(previous: DiscoverySnapshot, next: DiscoverySnapshot): boolean {
  return (['claude-code', 'codex'] as const).some((runtime) => {
    const before = previous.sources[runtime]
    const after = next.sources[runtime]
    return (
      before.status !== after.status ||
      before.error !== after.error ||
      JSON.stringify(before.models) !== JSON.stringify(after.models)
    )
  })
}

function arrayEqual(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index])
}
