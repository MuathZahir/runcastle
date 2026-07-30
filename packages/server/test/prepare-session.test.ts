import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'
import type { Project, SessionRow } from '@runcastle/core'
import { isProjectSessionKind } from '@runcastle/core'
import { events, projects, sessions } from '../src/db/schema'
import type { AppCtx } from '../src/db/types'
import {
  activeProjectSession,
  activeSessionsForFeature,
  createSessionRow,
  mostRecentResumableProjectSession,
  mostRecentResumableSession,
} from '../src/launcher/sessions'
import { emitForSession } from '../src/services/events'
import { preparedValue } from '../src/services/findings'
import { toolRecordFinding } from '../src/mcp/server'
import { renderPreparePrompt } from '../src/launcher/artifacts'
import { makeTestCtx } from './helpers/db'
import { seedFeature } from './helpers/fixtures'

/**
 * The project-scoped `prepare` session: a conversation that belongs to a project
 * rather than a feature, so `sessions.feature_id` is null for it.
 *
 * The invariants worth pinning are the ones a nullable column quietly breaks.
 * Every feature-keyed query must stay blind to these rows — a `prepare` session
 * leaking into the one-live-session-per-feature guard would block the feature's
 * real terminals, and a NULL that reached `emit` would take down a boot sweep.
 */

const PROJECT_ID = 'proj_1'
const FEATURE_ID = 'feat_1'

let ctx: AppCtx

function project(over: Partial<Project> = {}): Project {
  return { id: PROJECT_ID, name: 'acme', repoPath: '/repo', mainBranch: 'main', ...over }
}

function seedProject(over: Partial<Project> = {}): Project {
  const p = project(over)
  ctx.db
    .insert(projects)
    .values({
      id: p.id,
      name: p.name,
      repoPath: p.repoPath,
      mainBranch: p.mainBranch,
      createdAt: Date.now(),
    })
    .run()
  return p
}

function prepareSession(): SessionRow {
  return createSessionRow(ctx, {
    projectId: PROJECT_ID,
    kind: 'prepare',
    worktreePath: '/repo',
  })
}

function featureSession(): SessionRow {
  return createSessionRow(ctx, {
    featureId: FEATURE_ID,
    kind: 'ideation',
    worktreePath: '/wt',
  })
}

beforeEach(async () => {
  ctx = await makeTestCtx()
  seedProject()
  // A feature session stamps its feature's lap, so the feature must really
  // exist — `featureSession()` below is the genuine article, not a bare id.
  seedFeature(ctx, PROJECT_ID, { id: FEATURE_ID })
})

describe('a prepare session is project-scoped', () => {
  it('stores no feature and carries its project instead', () => {
    const s = prepareSession()
    expect(s.featureId).toBeUndefined()
    expect(s.projectId).toBe(PROJECT_ID)
    expect(isProjectSessionKind(s.kind)).toBe(true)
  })

  /**
   * The load-bearing one. `activeSessionsForFeature` is the one-live-HITL-
   * session-per-feature guard's source of truth, and it filters on feature_id.
   * A NULL never matches `eq(...)`, so these rows are invisible to it — if they
   * were not, opening a preparation conversation would silently block every
   * feature terminal in the project until the next boot reconciliation.
   */
  it('is invisible to every feature-keyed query', () => {
    prepareSession()
    prepareSession()
    expect(activeSessionsForFeature(ctx, FEATURE_ID)).toHaveLength(0)
    expect(mostRecentResumableSession(ctx, FEATURE_ID)).toBeNull()

    // …and a real feature session is still found alongside them.
    const f = featureSession()
    expect(activeSessionsForFeature(ctx, FEATURE_ID).map((s) => s.id)).toEqual([f.id])
  })

  it('is found by its own project-keyed queries', () => {
    const s = prepareSession()
    expect(activeProjectSession(ctx, PROJECT_ID, 'prepare')?.id).toBe(s.id)
    expect(activeProjectSession(ctx, 'proj_other', 'prepare')).toBeNull()
  })

  it('resumes the last ended conversation, not a live or feature one', () => {
    const ended = prepareSession()
    ctx.db
      .update(sessions)
      .set({ status: 'ended', ccSessionId: 'cc-1' })
      .where(eq(sessions.id, ended.id))
      .run()
    prepareSession() // still launching — not resumable

    expect(mostRecentResumableProjectSession(ctx, PROJECT_ID, 'prepare')?.ccSessionId).toBe('cc-1')
  })
})

describe('emitForSession routes by the scope the session actually has', () => {
  it('emits a project-level event for a prepare session', () => {
    const s = prepareSession()
    const row = emitForSession(ctx, s, { type: 'session.ended', message: 'done' })
    expect(row?.projectId).toBe(PROJECT_ID)
    expect(row?.featureId).toBeUndefined()
  })

  /**
   * A corrupt row must not take down the caller. These emitters run during boot
   * reconciliation and PTY teardown, where a throw is not a failed request but a
   * server that will not start or a session that cannot be closed.
   */
  it('drops the event rather than throwing when a row has neither scope', () => {
    const orphan = { ...prepareSession(), projectId: undefined }
    expect(() => emitForSession(ctx, orphan, { type: 'x', message: 'y' })).not.toThrow()
    expect(emitForSession(ctx, orphan, { type: 'x', message: 'y' })).toBeNull()
    expect(ctx.db.select().from(events).all()).toHaveLength(0)
  })
})

describe('record_finding provenance', () => {
  /**
   * The mapping that matters: `human` permanently locks a key against future
   * automatic runs, so it must mean "the human decided this value" and nothing
   * else. An agent stamping its own measurement `human` would silently retire
   * the field from preparation forever.
   */
  it('marks an agent measurement `session`, leaving it improvable', () => {
    const s = prepareSession()
    const res = toolRecordFinding(ctx, s, {
      key: 'verifyCommands',
      value: 'bun run test',
      evidence: 'ran it, exit 0',
    })
    expect(res.source).toBe('session')
    expect(preparedValue(ctx, PROJECT_ID, 'verifyCommands')).toBe('bun run test')
  })

  it('marks a user-supplied value `human`, which locks it', () => {
    const s = prepareSession()
    const res = toolRecordFinding(ctx, s, {
      key: 'driveEnv',
      value: 'DATABASE_URL=postgres://localhost/app_{{id}}',
      userSupplied: true,
    })
    expect(res.source).toBe('human')

    // Locked: a subsequent agent measurement must not overwrite it.
    const second = toolRecordFinding(ctx, s, { key: 'driveEnv', value: 'something else' })
    expect(second.skipped).toBeTruthy()
    expect(preparedValue(ctx, PROJECT_ID, 'driveEnv')).toBe(
      'DATABASE_URL=postgres://localhost/app_{{id}}',
    )
  })

  it('refuses when the session has no project', () => {
    const orphan = { ...prepareSession(), projectId: undefined }
    expect(() => toolRecordFinding(ctx, orphan, { key: 'devCommand', value: 'x' })).toThrow()
  })
})

describe('the prepare brief', () => {
  it('lists what is established, with its evidence, and what is still open', () => {
    const out = renderPreparePrompt({
      project: project(),
      remainingKeys: ['driveEnv'],
      established: [{ key: 'setupCommand', source: 'session', evidence: 'ran it: exit 0' }],
    })
    expect(out).toContain('ran it: exit 0')
    expect(out).toContain('`driveEnv`')
    // The host framing is the reason this session exists at all.
    expect(out).toContain('/repo')
    expect(out).toContain('NOT in a sandbox')
  })

  /**
   * The five host-only keys are the ones a preparation agent cannot look up: the
   * semantics live in this repo's source, and the installed build the agent can
   * actually read has the explaining comments stripped out. A real session went
   * grepping the minified bundle for `createdb`, found nothing, and told the
   * human runcastle had no per-branch database support — so the brief has to
   * carry the semantics itself.
   */
  it('explains what each host-only key drives, so the agent need not guess', () => {
    const out = renderPreparePrompt({
      project: project(),
      remainingKeys: ['devCommand', 'driveEnv', 'dbResetCommand'],
      established: [],
    })

    // devCommand: a drive-owned pane whose printed URL becomes the app link.
    expect(out).toContain('Open app')
    // The drive hooks run on the host, around the pane.
    expect(out).toMatch(/`driveSetupCommand` \/ `driveStopCommand`/)

    // driveEnv: the variables, and the once-per-drive sharing that makes the
    // setup hook and the dev pane agree on one rendered name.
    expect(out).toContain('{{slug}}')
    expect(out).toContain('{{branch}}')
    expect(out).toContain('{{id}}')
    expect(out).toContain('ONCE per')

    // The worked per-branch-database example, in the shape the ticket asks for:
    // the derivation lives in driveEnv, the hooks only reference the variable.
    expect(out).toContain('DB_NAME=myapp_{{id}}')
    expect(out).toContain('DATABASE_URL=postgres://localhost/myapp_{{id}}')
    expect(out).toContain('createdb "$DB_NAME"')
    expect(out).toContain('dropdb --if-exists "$DB_NAME"')

    // dbResetCommand: the correction that matters most — it is not a drive hook.
    expect(out).toMatch(/`dbResetCommand` — NOT part of the drive loop/)
    expect(out).toContain('drift')
  })

  it('says so plainly when there is nothing left to establish', () => {
    const out = renderPreparePrompt({ project: project(), remainingKeys: [], established: [] })
    expect(out).toContain('Nothing is unset')
  })
})
