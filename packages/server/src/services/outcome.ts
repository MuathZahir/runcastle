import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Feature, Project, Ticket } from '@runcastle/core'
import { featureDocsRel } from '@runcastle/core/paths'
import type { AppCtx } from '../db/types'
import { emit } from './events'
import * as git from './git'
import { listByFeature } from './tickets'

/**
 * `docs/features/<slug>/outcome.md` — the feature-level account of what was
 * actually done, promoted onto the feature branch at merge so it rides into the
 * base branch beside the other feature docs.
 *
 * {@link composeOutcomeDoc} is pure (feature + tickets in, markdown out) so the
 * whole format is testable without git; {@link promoteOutcomeDoc} is the thin IO
 * edge that writes and commits it in the talk worktree.
 */

/** Rendered when a done ticket's burner never wrote a `DIGEST.md`. */
const NO_DIGEST = '_no digest captured_'

/**
 * Compose the whole doc from the db — never appended to, so a second lap's merge
 * simply regenerates it with that lap's tickets included (identical content then
 * commits as a no-op). `shippedAt` is passed in rather than read from the clock
 * so the composer stays pure; the merge hook passes `Date.now()`, since the
 * merge commit does not exist yet when this is composed.
 *
 * Done tickets get a section carrying their digest; every non-done ticket gets a
 * one-line entry with its status and error headline — the record is honest about
 * what failed, not a highlight reel (decision 6).
 */
export function composeOutcomeDoc(feature: Feature, tickets: Ticket[], shippedAt: number): string {
  const blocks: string[] = [
    `# Outcome — ${feature.title}`,
    feature.oneLiner,
    [`- Shipped: ${shippedDate(shippedAt)}`, `- Lap: ${feature.lap}`].join('\n'),
  ]

  // Consecutive one-liners accumulate into a single list block so a run of
  // failed tickets renders as one tight list rather than orphaned bullets.
  let oneLiners: string[] = []
  const flush = (): void => {
    if (oneLiners.length > 0) blocks.push(oneLiners.join('\n'))
    oneLiners = []
  }

  for (const ticket of [...tickets].sort((a, b) => a.seq - b.seq)) {
    if (ticket.status === 'done') {
      flush()
      blocks.push(`## ${ticket.seq}. ${ticket.title}`, ticket.digest?.trim() || NO_DIGEST)
    } else {
      oneLiners.push(oneLineEntry(ticket))
    }
  }
  flush()

  return `${blocks.join('\n\n')}\n`
}

/**
 * `YYYY-MM-DD` (UTC). A date, not a timestamp: the doc is regenerated wholesale
 * on every merge, and a clock-precise header would differ on every lap — turning
 * `commitDocs`' no-op into an empty-ish commit each time a feature is re-merged.
 */
function shippedDate(shippedAt: number): string {
  return new Date(shippedAt).toISOString().slice(0, 10)
}

/** `- **3. Title** — failed: <headline>`, the headline dropped when there is none. */
function oneLineEntry(ticket: Ticket): string {
  const headline = errorHeadline(ticket.error ?? '')
  return `- **${ticket.seq}. ${ticket.title}** — ${ticket.status}${headline ? `: ${headline}` : ''}`
}

/** Longest error headline a one-line entry carries before it is elided. */
const HEADLINE_MAX = 160

/**
 * The most informative single line of a multi-line error, truncated to one line
 * of prose. Prefers the LAST `fatal:`/`error:` line over the first line, the way
 * the burner's own headline does — git buries the cause under progress noise.
 */
function errorHeadline(error: string): string {
  const lines = error
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
  const causes = lines.filter((l) => /^(fatal|error):/i.test(l))
  const headline = causes.at(-1) ?? lines[0] ?? ''
  return headline.length > HEADLINE_MAX ? `${headline.slice(0, HEADLINE_MAX)}…` : headline
}

/**
 * Write and commit the feature's `outcome.md` onto the feature branch — called
 * by the merge mutation just before the `--no-ff` merge, so the doc rides into
 * the base branch with everything else.
 *
 * The talk worktree is ensured first: it may be missing from disk, or sitting on
 * a detached HEAD (a burn detaches it and the runner's reattach is best-effort),
 * and a commit made on a detached HEAD would be stranded off the branch —
 * `ensureTalkWorktree` re-checks-out the feature branch in both cases.
 * `commitDocs` stages only `docs/features/**` and no-ops when nothing changed.
 *
 * Best-effort, like every other docs checkpoint: a worktree that cannot be
 * ensured must not cost the human their merge, so the failure becomes a timeline
 * event and the merge proceeds without the doc.
 */
export async function promoteOutcomeDoc(
  ctx: AppCtx,
  project: Project,
  feature: Feature,
): Promise<void> {
  try {
    const worktreePath = await git.ensureTalkWorktree(project, feature)
    const docsDir = join(worktreePath, ...featureDocsRel(feature.slug).split('/'))
    mkdirSync(docsDir, { recursive: true })
    const doc = composeOutcomeDoc(feature, listByFeature(ctx, feature.id), Date.now())
    writeFileSync(join(docsDir, 'outcome.md'), doc, 'utf8')
    await git.commitDocs(worktreePath, `runcastle: outcome for ${feature.slug}`)
  } catch (e) {
    emit(ctx, feature.id, {
      type: 'docs.outcome_failed',
      message: `outcome.md not promoted: ${e instanceof Error ? e.message : String(e)}`,
    })
  }
}
