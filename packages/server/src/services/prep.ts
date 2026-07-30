import type { PreparedKey, Project, ProjectFinding } from '@runcastle/core'
import { and, desc, eq } from 'drizzle-orm'
import type { AppCtx } from '../db/types'
import { events, sessions } from '../db/schema'
import { hasCompletedProjectSession } from '../launcher/sessions'
import { isOverwritable, listFindings, unsetPreparedKeys } from './findings'

/**
 * Project preparation state — what is still open, and whether the human has
 * been through it.
 *
 * Preparation is a CONVERSATION on the developer's own machine
 * (`project.talkToPrep`), and only that. It used to have a headless twin that
 * measured the repo in a sandbox with nobody watching; that is gone. The AFK
 * run took minutes behind a spinner with nothing to look at, which is exactly
 * how long it takes to lose someone's patience — and the keys it could never
 * settle alone (the dev server, the local database, credentials) are the ones
 * a single direct question resolves. Asking beats guessing, and asking is only
 * possible with someone there.
 *
 * This module is the read side of that: it answers "what is left" for the
 * session brief and for the UI's call-to-action. Values and provenance are
 * written by `record_finding` through {@link recordFinding} in `findings.ts`.
 */

/**
 * Which prepared keys a preparation conversation still has to establish: those
 * with no value, minus anything a human typed by hand (see {@link isOverwritable}
 * — clearing a field is how you hand it back).
 */
export function keysToPrepare(ctx: AppCtx, project: Project): PreparedKey[] {
  return unsetPreparedKeys(project).filter((key) => isOverwritable(ctx, project.id, key))
}

/**
 * Whether this project counts as prepared — the question the call-to-action
 * asks before it takes over the screen.
 *
 * Two ways to be done, and the second one matters as much as the first. Some
 * keys are legitimately empty forever ("this repo has no database"), so waiting
 * for `pendingKeys` to drain would nag some projects permanently — and a
 * permanent nudge is noise, which is what put preparation out of sight in the
 * first place. Once a preparation conversation has actually run to an end, the
 * human has seen every open field and decided; the prompt is done prompting.
 */
export function isPrepared(ctx: AppCtx, project: Project): boolean {
  if (keysToPrepare(ctx, project).length === 0) return true
  return hasCompletedProjectSession(ctx, project.id, 'prepare')
}

/**
 * When the last preparation conversation ended, or `null` if none ever has.
 *
 * `prepared` alone cannot be shown to anyone: it is monotonic and undated, so a
 * baseline established a year ago reads exactly like one established this
 * morning. The date is what makes "re-prepare" a judgement rather than a guess.
 *
 * Sessions carry no timestamp of their own, so the answer comes from the
 * `session.ended` event that closed one — the row that makes `prepared` true is
 * the row that dates it. Read in two steps rather than one join because the
 * session id lives inside the event's JSON payload, and the alternative is
 * `json_extract` in a query that has to run on two different sqlite drivers.
 */
export function preparedAt(ctx: AppCtx, projectId: string): number | null {
  const prepareSessions = new Set(
    ctx.db
      .select({ id: sessions.id })
      .from(sessions)
      .where(and(eq(sessions.projectId, projectId), eq(sessions.kind, 'prepare')))
      .all()
      .map((r) => r.id),
  )
  if (prepareSessions.size === 0) return null

  // Project-scoped ends only — a feature session's end carries a feature id, and
  // there are few enough of these that newest-first finds the answer immediately.
  const ends = ctx.db
    .select({ ts: events.ts, data: events.data })
    .from(events)
    .where(and(eq(events.projectId, projectId), eq(events.type, 'session.ended')))
    .orderBy(desc(events.ts))
    .all()

  for (const end of ends) {
    const sessionId = (end.data as { sessionId?: string } | null)?.sessionId
    if (sessionId && prepareSessions.has(sessionId)) return end.ts
  }
  return null
}

/** The preparation surface the UI polls. */
export interface PrepView {
  pendingKeys: PreparedKey[]
  findings: ProjectFinding[]
  /** Nothing left to establish, or a conversation has already been through it. */
  prepared: boolean
  /**
   * When the last preparation conversation ended (epoch ms), or `null` — either
   * none ever ran, or the project is prepared only because nothing was left to
   * establish. A `prepared` project with no date has no baseline to age.
   */
  preparedAt: number | null
}

export async function prepView(ctx: AppCtx, project: Project): Promise<PrepView> {
  return {
    pendingKeys: keysToPrepare(ctx, project),
    findings: await listFindings(ctx, project),
    prepared: isPrepared(ctx, project),
    preparedAt: preparedAt(ctx, project.id),
  }
}
