import type {
  Feature,
  FeatureSize,
  GateDef,
  Project,
  Run,
  SessionRow,
  Ticket,
  Waypoint,
} from '@runcastle/core'
import { newId, nextGate, nextPhase } from '@runcastle/core'
import { desc, eq } from 'drizzle-orm'
import type { AppCtx } from '../db/types'
import { features } from '../db/schema'
import { GateError, isNotImplemented } from '../errors'
import { emit } from './events'
import { checkGate } from './gates'
import * as git from './git'
import { listDocs, scaffoldDocs } from './knowledge'
import type { DocSummary } from './knowledge'
import {
  getFeatureRow,
  hasActiveRun,
  listRunsByFeature,
  listSessionsByFeature,
  requireProject,
  rowToFeature,
  setPhase,
} from './repo'
import { listByFeature } from './tickets'
import { frontier, listByFeature as listWaypoints } from './waypoints'
import { startRun } from '../workflows/runner'

/**
 * Feature service (SPEC §3/§4): create, aggregate read, phase transitions,
 * burn. Git branch creation is B2's; `createFeature` tolerates the B2 stub via
 * `ensureFeatureBranch` so the feature row is created and the UI is usable
 * before wave B lands (task item 5).
 */

export interface TicketCounts {
  total: number
  pending: number
  burning: number
  done: number
  failed: number
}

export interface FeatureListItem extends Feature {
  ticketCounts: TicketCounts
  activeRun: boolean
}

export interface FeatureGateState {
  next: GateDef | null
  satisfied: boolean
  reason?: string
}

export interface FeatureFull {
  feature: Feature
  tickets: Ticket[]
  sessions: SessionRow[]
  runs: Run[]
  docs: DocSummary[]
  gate: FeatureGateState
  /** Mapped features only (empty otherwise): the map's waypoints (ADR-0001). */
  waypoints: Waypoint[]
  /** Ids of the waypoints currently on the frontier (derived; empty otherwise). */
  frontierIds: string[]
}

export interface CreateFeatureInput {
  title: string
  oneLiner: string
  size: FeatureSize
  /** Start the feature in mapped ideation (ADR-0001). Orthogonal to size. */
  mapped?: boolean
}

export async function createFeature(
  ctx: AppCtx,
  input: CreateFeatureInput,
): Promise<Feature> {
  const project = requireProject(ctx)
  const slug = uniqueSlug(ctx, project.id, input.title)
  const branch = `feature/${slug}`

  const { branchReady } = await ensureFeatureBranch(project, slug)

  const row = {
    id: newId('feat'),
    projectId: project.id,
    slug,
    title: input.title,
    oneLiner: input.oneLiner,
    size: input.size,
    mapped: input.mapped ?? false,
    phase: 'ideation' as const,
    branch,
    status: 'active' as const,
    createdAt: Date.now(),
  }
  const inserted = ctx.db.insert(features).values(row).returning().get()
  const feature = rowToFeature(inserted)

  emit(ctx, feature.id, {
    type: 'feature.created',
    message: branchReady
      ? `feature.created (${branch})`
      : 'feature.created (branch pending)',
    data: { slug, branch, branchReady },
  })

  scaffoldDocs(ctx, feature)

  // Commit the scaffolded brief so it does not linger as an untracked file in the
  // target repo's working tree. An untracked doc dirties the checkout and blocks
  // the ship gates (test-drive and merge both require `git status` to be clean).
  // Best-effort: a git stub (pre-B2) or a commit hiccup must never fail creation.
  if (branchReady) {
    try {
      await git.commitDocs(project.repoPath, `runcastle: scaffold ${slug} docs`)
    } catch {
      // best-effort — the brief stays on disk; only the auto-commit is skipped
    }
  }

  return feature
}

/**
 * Create the feature's git branch if B2's git service is available, tolerating
 * its typed stub so the feature is created without a branch pre-B2. When B2
 * lands this transparently starts creating real branches — no caller change.
 */
async function ensureFeatureBranch(
  project: Project,
  slug: string,
): Promise<{ branchReady: boolean }> {
  try {
    await git.createFeatureBranch(project, slug)
    return { branchReady: true }
  } catch (e) {
    if (isNotImplemented(e)) return { branchReady: false }
    throw e
  }
}

export function getFeatureFull(ctx: AppCtx, id: string): FeatureFull {
  const feature = getFeatureRow(ctx, id)
  // Waypoints are a mapped-feature concept; unmapped features carry none, so we
  // skip the query entirely and return empty collections.
  const waypoints = feature.mapped ? listWaypoints(ctx, id) : []
  const frontierIds = feature.mapped ? frontier(ctx, id).map((w) => w.id) : []
  return {
    feature,
    tickets: listByFeature(ctx, id),
    sessions: listSessionsByFeature(ctx, id),
    runs: listRunsByFeature(ctx, id),
    docs: listDocs(ctx, feature),
    gate: gateState(ctx, feature),
    waypoints,
    frontierIds,
  }
}

export function list(ctx: AppCtx): FeatureListItem[] {
  const project = requireProject(ctx)
  const rows = ctx.db
    .select()
    .from(features)
    .where(eq(features.projectId, project.id))
    .orderBy(desc(features.createdAt))
    .all()

  return rows.map((row) => {
    const feature = rowToFeature(row)
    const tickets = listByFeature(ctx, feature.id)
    const counts: TicketCounts = {
      total: tickets.length,
      pending: tickets.filter((t) => t.status === 'pending').length,
      burning: tickets.filter((t) => t.status === 'burning').length,
      done: tickets.filter((t) => t.status === 'done').length,
      failed: tickets.filter((t) => t.status === 'failed').length,
    }
    return { ...feature, ticketCounts: counts, activeRun: hasActiveRun(ctx, feature.id) }
  })
}

/** Attempt the gate guarding the next phase; advance or throw with the reason. */
export function advance(ctx: AppCtx, featureId: string): Feature {
  const feature = getFeatureRow(ctx, featureId)
  const gate = nextGate(feature)
  if (!gate) throw new GateError('feature is already at the final phase')

  // G3 (tickets → implementation) is the human "Burn" gate — the first click of
  // CONTEXT.md's two-click covenant (#9). Even when its precondition
  // (`tickets-approved`: ≥1 ticket) is met, a plain `advance` must NOT cross it;
  // only `burn` (the human Burn click) or an explicit `overrideGate` may. This
  // keeps `feature.burn` the single legitimate G3 crossing.
  if (gate.id === 'G3') {
    throw new GateError('G3 is the human Burn gate — click Burn to approve and burn the tickets')
  }

  const result = checkGate(ctx, gate.check, feature)
  if (!result.satisfied) {
    throw new GateError(result.reason ?? `gate ${gate.id} not satisfied`)
  }

  const next = nextPhase(feature)
  if (!next) throw new GateError('feature is already at the final phase')
  return setPhase(ctx, featureId, next, 'phase.advanced')
}

/**
 * G3 burn — the human "Burn" click, the ONLY legitimate G3 crossing.
 *
 * From phase `tickets` (the normal case) this crosses G3: sets phase
 * `implementation` and starts the ticket-burner run. It also accepts a feature
 * already at `implementation` with NO active run — a run that was cancelled or
 * crashed left the feature parked there — and (re)starts the burn without
 * re-crossing any gate, so that state never dead-ends. Requires ≥1 ticket.
 */
export async function burn(ctx: AppCtx, featureId: string): Promise<{ runId: string }> {
  const feature = getFeatureRow(ctx, featureId)
  const restarting = feature.phase === 'implementation' && !hasActiveRun(ctx, featureId)
  if (feature.phase !== 'tickets' && !restarting) {
    const why =
      feature.phase === 'implementation'
        ? 'a run is already burning this feature'
        : `feature must be in the tickets phase to burn (currently ${feature.phase})`
    throw new GateError(why)
  }
  if (listByFeature(ctx, featureId).length < 1) {
    throw new GateError('no tickets to burn')
  }

  if (restarting) {
    emit(ctx, featureId, {
      type: 'burn.restarted',
      message: 'restarting burn (previous run cancelled or crashed)',
    })
  } else {
    setPhase(ctx, featureId, 'implementation', 'burn.started', 'burning tickets')
  }
  const { runId } = await startRun(ctx, featureId, 'ticket-burner')
  return { runId }
}

function gateState(ctx: AppCtx, feature: Feature): FeatureGateState {
  const gate = nextGate(feature)
  if (!gate) return { next: null, satisfied: false }
  const result = checkGate(ctx, gate.check, feature)
  return { next: gate, satisfied: result.satisfied, reason: result.reason }
}

function uniqueSlug(ctx: AppCtx, projectId: string, title: string): string {
  const base = slugify(title)
  const existing = new Set(
    ctx.db
      .select({ slug: features.slug })
      .from(features)
      .where(eq(features.projectId, projectId))
      .all()
      .map((r) => r.slug),
  )
  if (!existing.has(base)) return base
  let n = 2
  while (existing.has(`${base}-${n}`)) n += 1
  return `${base}-${n}`
}

/** lowercase, non-alphanumeric runs → single hyphen, trimmed. */
function slugify(title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return slug || 'feature'
}
