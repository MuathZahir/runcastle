import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs'
import type { Feature, Project, ReviewGateRun } from '@runcastle/core'
import { resolvePreparedSettings } from '@runcastle/core'
import type { RuncastleConfig } from '@runcastle/core'
import { featureDocsRel, reviewGateLogDir } from '@runcastle/core/paths'
import type { AppCtx } from '../db/types'
import { diffPaths, headSha } from '../services/git'
import { listRunsByFeature } from '../services/repo'
import { listByFeature } from '../services/tickets'

/** A gate record already stored on the feature, and who owns its logs. */
export interface GateCandidate {
  kind: 'round' | 'review'
  /** Run id or review ticket id: the owner of the gate-log dir. */
  id: string
  /** When it was recorded; the newest qualifying candidate wins. */
  at: number
  gates: ReviewGateRun
}

/**
 * The gate-reuse rule (decisions 3, 4, 10): the newest candidate that really
 * ran, with exactly the current commands in order, on a commit that is
 * `unmoved` relative to the tip. Failed results qualify like passed ones.
 */
export function pickReusableGates(
  candidates: readonly GateCandidate[],
  commands: readonly string[],
  unmoved: (commit: string) => boolean,
): GateCandidate | undefined {
  return [...candidates]
    .sort((a, b) => b.at - a.at)
    .find(
      (c) =>
        c.gates.status === 'ran' &&
        // A command that timed out or could not start is a fact about the machine
        // then, not the commit: such a record is retried, never copied forward.
        c.gates.commands.every((r) => r.outcome !== 'couldnt_run') &&
        c.gates.commands.length === commands.length &&
        c.gates.commands.every((r, i) => r.command === commands[i]) &&
        unmoved(c.gates.commit),
    )
}

/** Whether every path in `paths` sits under the feature's own docs directory. */
export function onlyFeatureDocs(paths: readonly string[], slug: string): boolean {
  const prefix = `${featureDocsRel(slug)}/`
  return paths.every((p) => p.startsWith(prefix))
}

/**
 * A gate result already recorded on this feature that answers for `sha` now,
 * copied to `ownerId` with its logs; undefined on a miss. Never throws.
 */
export async function reuseGateResult(input: {
  ctx: AppCtx
  config: RuncastleConfig
  project: Project
  feature: Feature
  ownerId: string
  sha: string
}): Promise<ReviewGateRun | undefined> {
  const { ctx, config, project, feature, ownerId, sha } = input
  try {
    // Loaded lazily: review-gates imports ticket-burner, whose module graph reaches the runner.
    const { parseVerifyCommands } = await import('./review-gates')
    const commands = parseVerifyCommands(resolvePreparedSettings(config, project).verifyCommands)
    if (commands.length === 0) return undefined
    const candidates: GateCandidate[] = []
    for (const run of listRunsByFeature(ctx, feature.id)) {
      if (run.gates && run.id !== ownerId) {
        candidates.push({ kind: 'round', id: run.id, at: run.endedAt ?? run.startedAt, gates: run.gates })
      }
    }
    for (const t of listByFeature(ctx, feature.id)) {
      if (t.kind === 'review' && t.reviewGateRun && t.id !== ownerId) {
        candidates.push({ kind: 'review', id: t.id, at: t.completedAt ?? Date.now(), gates: t.reviewGateRun })
      }
    }
    // Resolve each distinct commit once; an unresolvable one, or a diff that
    // cannot be taken, is treated as moved.
    const verdicts = new Map<string, boolean>()
    for (const c of candidates) {
      if (c.gates.status !== 'ran' || verdicts.has(c.gates.commit)) continue
      const commit = c.gates.commit
      if (commit === sha) {
        verdicts.set(commit, true)
      } else if (!(await headSha(project.repoPath, commit))) {
        verdicts.set(commit, false)
      } else {
        const paths = await diffPaths(project.repoPath, commit, sha, { throwOnError: true }).catch(() => undefined)
        verdicts.set(commit, paths !== undefined && onlyFeatureDocs(paths, feature.slug))
      }
    }
    const hit = pickReusableGates(candidates, commands, (commit) => verdicts.get(commit) === true)
    if (!hit || hit.gates.status !== 'ran') return undefined
    const from = reviewGateLogDir(hit.id)
    if (!existsSync(from)) return undefined
    const to = reviewGateLogDir(ownerId)
    rmSync(to, { recursive: true, force: true })
    mkdirSync(to, { recursive: true })
    cpSync(from, to, { recursive: true })
    return { ...hit.gates, reusedFrom: { kind: hit.kind, id: hit.id } }
  } catch {
    return undefined
  }
}
