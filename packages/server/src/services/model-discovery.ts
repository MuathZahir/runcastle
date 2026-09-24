import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import {
  DiscoverySnapshot,
  EMPTY_DISCOVERY_SNAPSHOT,
  discoveredEntries,
  type ModelConfig,
} from '@runcastle/core'
import { dataDir } from '@runcastle/core/paths'
import type { AppCtx } from '../db/types'
import { NotImplementedError } from '../errors'

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

export async function refreshModelDiscovery(_ctx: AppCtx): Promise<DiscoverySnapshot> {
  throw new NotImplementedError('model-discovery')
}
