import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
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
import { launchPrepareSession } from '../src/launcher/launcher'
import { reconcileStaleSessions } from '../src/launcher/reconcile'
import { endSession } from '../src/pty/end-session'
import { emitForSession } from '../src/services/events'
import { preparedValue } from '../src/services/findings'
import { preparedAt } from '../src/services/prep'
import { toolRecordFinding } from '../src/mcp/server'
import { renderPreparePrompt } from '../src/launcher/artifacts'
import { evaluateEditGuard } from '../src/launcher/edit-guard'
import { useDataDir } from './helpers/data-dir'
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
      key: 'driveSetupCommand',
      value: 'bash .runcastle/drive-setup.sh',
      userSupplied: true,
    })
    expect(res.source).toBe('human')

    // Locked: a subsequent agent measurement must not overwrite it.
    const second = toolRecordFinding(ctx, s, { key: 'driveSetupCommand', value: 'something else' })
    expect(second.skipped).toBeTruthy()
    expect(preparedValue(ctx, PROJECT_ID, 'driveSetupCommand')).toBe(
      'bash .runcastle/drive-setup.sh',
    )
  })

  it('refuses when the session has no project', () => {
    const orphan = { ...prepareSession(), projectId: undefined }
    expect(() => toolRecordFinding(ctx, orphan, { key: 'devCommand', value: 'x' })).toThrow()
  })
})

/**
 * The baseline's date. `prepared` is monotonic and undated, so on its own it
 * cannot be shown to anyone: a baseline established a year ago reads exactly
 * like one established this morning, and "re-prepare" becomes a guess. Sessions
 * carry no timestamp, so the date comes from the end event that closed one.
 */
describe('preparedAt', () => {
  /** Rewrite one session's end event to a known instant (tests share a ms). */
  function stampEnd(sessionId: string, ts: number): void {
    const row = ctx.db
      .select()
      .from(events)
      .all()
      .find(
        (e) =>
          e.type === 'session.ended' &&
          (e.data as { sessionId?: string } | null)?.sessionId === sessionId,
      )
    if (!row) throw new Error(`no session.ended event for ${sessionId}`)
    ctx.db.update(events).set({ ts }).where(eq(events.id, row.id)).run()
  }

  it('has no date to report until a preparation has actually ended', () => {
    expect(preparedAt(ctx, PROJECT_ID)).toBeNull()
    prepareSession() // open, so nothing has been established yet
    expect(preparedAt(ctx, PROJECT_ID)).toBeNull()
  })

  it('dates the most recent preparation, not the first', () => {
    const older = prepareSession()
    endSession(ctx, older.id)
    stampEnd(older.id, 1_000)
    const newer = prepareSession()
    endSession(ctx, newer.id)
    stampEnd(newer.id, 2_000)

    expect(preparedAt(ctx, PROJECT_ID)).toBe(2_000)
  })

  /**
   * How a good many preparations really end: the terminal was still open when
   * the server stopped, and the next boot closes the row. Counting only the
   * human's own "end session" would leave those projects prepared, dated by
   * nothing, and told no conversation was ever on record.
   */
  it('counts a session the server closed at boot', () => {
    prepareSession()
    expect(reconcileStaleSessions(ctx)).toHaveLength(1)

    expect(preparedAt(ctx, PROJECT_ID)).not.toBeNull()
  })

  /**
   * Why this reads sessions and events rather than events alone: a project's
   * OTHER conversations end on the same project timeline with the same event
   * type, and an intake session ending must never date the repo's baseline.
   */
  it('ignores another kind of project conversation ending', () => {
    const intake = createSessionRow(ctx, {
      projectId: PROJECT_ID,
      kind: 'project',
      worktreePath: '/wt',
    })
    // Emitted directly rather than through endSession: ending a project session
    // also lands its branch, which wants a real checkout this test has no use for.
    emitForSession(ctx, intake, {
      type: 'session.ended',
      message: 'session ended by user',
      data: { sessionId: intake.id },
    })

    expect(preparedAt(ctx, PROJECT_ID)).toBeNull()
  })

  it('is null for a project that never opened one, and per project', () => {
    const s = prepareSession()
    endSession(ctx, s.id)
    expect(preparedAt(ctx, PROJECT_ID)).not.toBeNull()
    expect(preparedAt(ctx, 'proj_other')).toBeNull()
  })
})

describe('the prepare brief', () => {
  it('lists what is established, with its evidence, and what is still open', () => {
    const out = renderPreparePrompt({
      project: project(),
      remainingKeys: ['driveStopCommand'],
      established: [{ key: 'setupCommand', source: 'session', evidence: 'ran it: exit 0' }],
    })
    expect(out).toContain('ran it: exit 0')
    expect(out).toContain('`driveStopCommand`')
    // The host framing is the reason this session exists at all.
    expect(out).toContain('/repo')
    expect(out).toContain('NOT in a sandbox')
  })

  /**
   * The host-only keys are the ones a preparation agent cannot look up: the
   * semantics live in this repo's source, and the installed build the agent can
   * actually read has the explaining comments stripped out. A real session went
   * grepping the minified bundle for `createdb`, found nothing, and told the
   * human runcastle had no per-branch database support — so the brief has to
   * carry the semantics itself.
   */
  it('explains what each host-only key drives, so the agent need not guess', () => {
    const out = renderPreparePrompt({
      project: project(),
      remainingKeys: ['devCommand', 'driveSetupCommand', 'dbResetCommand'],
      established: [],
    })

    // devCommand: a drive-owned pane whose printed URL becomes the app link.
    expect(out).toContain('Open app')
    // The drive hooks run on the host, around the pane — as invocation lines for
    // the committed scripts, which is the shape the contract below spells out.
    expect(out).toMatch(/`driveSetupCommand` \/ `driveStopCommand`/)
    expect(out).toContain('INVOCATION LINES')

    // dbResetCommand: the correction that matters most — it is not a drive hook.
    expect(out).toMatch(/`dbResetCommand` — NOT part of the drive loop/)
    expect(out).toContain('drift')

    // The retired key, and the templating that went with it (decision 6).
    expect(out).not.toContain('driveEnv')
    expect(out).not.toContain('{{id}}')
    expect(out).not.toContain('{{slug}}')
  })

  /**
   * The contract (decision 6) — the only part of a drive runcastle mandates, and
   * the part no agent can infer from the repo in front of it. Each clause is one
   * thing a script that got it wrong breaks: logic in the setting is logic no
   * branch can amend, a value that never reaches `drive.env` never reaches the
   * dev pane, an ungitignored `drive.env` commits a connection string, a
   * delta-detecting step skips the install a branch needed, and a setup that
   * returns before its services are up hands the dev pane a dead database.
   */
  it('states the drive contract: committed scripts, identity in, drive.env out', () => {
    const out = renderPreparePrompt({ project: project(), remainingKeys: [], established: [] })

    // Where the machinery lives, and what the settings shrink to.
    expect(out).toContain('.runcastle/drive-setup.sh')
    expect(out).toContain('committed to the repo')

    // Identity in — all three, and the reason never to derive it from git.
    expect(out).toContain('RUNCASTLE_SLUG')
    expect(out).toContain('RUNCASTLE_BRANCH')
    expect(out).toContain('RUNCASTLE_ID')
    expect(out).toContain('git rev-parse')

    // Computed values out, and the file that must never be committed.
    expect(out).toContain('.runcastle/drive.env')
    expect(out).toContain('gitignored')

    // Idempotence by convention, never delta detection.
    expect(out).toContain('idempotent')
    expect(out).toMatch(/has anything changed\?/)

    // Exit 0 means the services are up, so the waits live in the script.
    expect(out).toContain('Exit 0 means the services are actually up')
    expect(out).toContain('docker compose up --wait')
    expect(out).toContain('pg_isready')

    // And the session is told it may write the files the contract asks it for.
    expect(out).toContain('`.runcastle/` and `.gitignore`')
  })

  /**
   * Shape discovery before authoring (decision 7). The prompt used to carry one
   * postgres example, so a project one shape away from it — compose, a monorepo,
   * a hosted database, Windows — had nothing to reason from. Nothing
   * stack-specific is mandated: the agent finds out what this project is first.
   */
  it('directs shape discovery before a line of script is written', () => {
    const out = renderPreparePrompt({ project: project(), remainingKeys: [], established: [] })

    expect(out).toContain('Discover the shape before you author anything')
    expect(out).toContain('Package manager and workspace layout')
    expect(out).toContain('monorepo')
    expect(out).toContain('OS and shell')
    expect(out).toContain('.ps1')
    expect(out).toContain('Docker')
    expect(out).toContain('services the app needs to boot')
    expect(out).toContain('Hosted or local data stores')
  })

  /**
   * The recipe pack (decision 7): shapes to adapt, never rules. Each entry exists
   * because a real project shape had no answer in the old prompt — a compose
   * stack with no per-drive isolation, a redis the drive would have shared with
   * the human's own db 0, a hosted database the agent had no grant to create on,
   * and fixed ports colliding with whatever was already running.
   */
  it('carries the recipe pack, adapt-not-copy', () => {
    const out = renderPreparePrompt({ project: project(), remainingKeys: [], established: [] })

    expect(out).toContain('adapt them, never copy them')

    // Postgres, one database per drive, named from the identity.
    expect(out).toContain('createdb')
    expect(out).toContain('dropdb --if-exists')

    // Compose: project name from the identity, ports the script chose, --wait.
    expect(out).toContain('COMPOSE_PROJECT_NAME')
    expect(out).toContain('docker compose down -v')

    // Redis: a logical index or prefix, with db 0 left to the human.
    expect(out).toContain('Redis')
    expect(out).toContain('db 0')

    // Hosted: a branch per feature, or a schema where CREATEDB is refused.
    expect(out).toContain('Hosted databases')
    expect(out).toContain('CREATEDB')
    expect(out).toContain('CREATE SCHEMA IF NOT EXISTS')

    // Ports: slug-derived so laps agree, bind-probed so nothing collides.
    expect(out).toContain('Deterministic ports')
    expect(out).toContain('bind-probe')
    expect(out).toContain('PORT=$port')
  })

  /**
   * The env-loading audit (decision 7). The overlay is process environment, so a
   * loader told to clobber it leaves a drive that looks perfect while the app
   * quietly reads the shared database. Nothing server-side can detect that, so
   * the prompt names the agent as the detector and gives it both outcomes.
   */
  it('directs the env-loading audit, with fix-or-record as the outcomes', () => {
    const out = renderPreparePrompt({ project: project(), remainingKeys: [], established: [] })

    expect(out).toContain('override: true')
    expect(out).toContain('you are the detector')
    expect(out).toContain('record the finding with `record_event`')
  })

  it('says so plainly when there is nothing left to establish', () => {
    const out = renderPreparePrompt({ project: project(), remainingKeys: [], established: [] })
    expect(out).toContain('Nothing is unset')
  })

  /**
   * The closing move (decision 8): the session ends by PROPOSING a dry-run
   * drive, never by running one unannounced — it starts services and creates a
   * database on someone's machine. The two halves and the fix-and-retry loop are
   * the whole protocol, and the stamp being the server's to compute is what
   * stops a diligent-sounding agent from marking its own homework.
   */
  it('closes by proposing the dry-run drive, asked for first and inspected in halves', () => {
    const out = renderPreparePrompt({ project: project(), remainingKeys: [], established: [] })

    expect(out).toContain('dry_run_drive')
    expect(out).toContain('Ask before you act')
    // The identity, so a leftover database is recognisable rather than alarming.
    expect(out).toContain('prep-dry-run')
    expect(out).toContain('prep_dry_run')
    expect(out).toContain('createdb')

    // The observables as they are after the contract landed: setup exits 0 and
    // hands back a parseable `drive.env`, the dev pane serves, stop exits 0.
    expect(out).toContain('.runcastle/drive.env')
    expect(out).toContain('variable NAMES it parsed')

    // Between the halves and after the stop: the checks the server cannot do.
    expect(out).toContain('FRESH')
    expect(out).toContain('RESPONDS')
    // App readiness is the server's one wait — the agent judges the page, not
    // whether it answers at all.
    expect(out).toContain('the server waits for it to answer')
    expect(out).toContain('cleanup')

    // Fix-and-retry, and where the stamp comes from.
    expect(out).toContain('record_finding')
    expect(out).toContain('clean full pass')
    expect(out).toContain('mark your own homework')
  })
})

/**
 * What a preparation session may write. It holds the human's real checkout, so
 * the edit guard denies it everything by default — but the drive contract asks
 * it to author `.runcastle/` scripts and to gitignore `drive.env`, and a guard
 * that denied those would deny the session its own job.
 */
describe('the preparation edit guard', () => {
  const GUARD_BASE = { kind: 'prepare', toolName: 'Write', worktreePath: '/repo' } as const

  function denialFor(filePath: string): string | undefined {
    return evaluateEditGuard({ ...GUARD_BASE, filePath })?.reason
  }

  it('allows the drive machinery it is briefed to author', () => {
    expect(denialFor('.runcastle/drive-setup.sh')).toBeUndefined()
    expect(denialFor('/repo/.runcastle/drive-stop.ps1')).toBeUndefined()
    expect(denialFor('.gitignore')).toBeUndefined()
  })

  it('still denies everything else in the developer\'s checkout', () => {
    expect(denialFor('src/index.ts')).toContain('does not edit files')
    // The near miss: a sibling directory whose name merely starts the same way.
    expect(denialFor('../runcastle-notes/plan.md')).toContain('does not edit files')
    // …and the denial says where the exception is, so the agent stops guessing.
    expect(denialFor('src/index.ts')).toContain('.runcastle/')
  })
})

/**
 * Resuming versus starting over. Reopening a preparation normally continues the
 * last conversation — nobody should have to re-explain their database. But
 * re-preparing a drifted baseline is the opposite job: the resumed transcript
 * already believes every conclusion the new run exists to re-measure, so the
 * prepared screen's "Start fresh" has to actually drop the resume.
 *
 * Asserted at the launch-input seam (`spawn: false` writes the argv it WOULD
 * have spawned to the timeline) — no terminal is ever started here.
 */
describe('launching a preparation, fresh or resumed', () => {
  const cleanup: string[] = []
  let restoreDataDir: () => void

  beforeEach(() => {
    const home = mkdtempSync(join(tmpdir(), 'rc-prep-home-'))
    cleanup.push(home)
    restoreDataDir = useDataDir(home)
  })

  afterEach(() => {
    restoreDataDir()
    for (const d of cleanup) rmSync(d, { recursive: true, force: true })
    cleanup.length = 0
  })

  /** The argv of the most recent launch (a relaunch appends a second event). */
  function launchCommand(): string {
    const launched = ctx.db
      .select()
      .from(events)
      .all()
      .filter((e) => e.type === 'session.launched')
      .at(-1)
    return String((launched?.data as { command?: string })?.command ?? '')
  }

  /** An ended conversation with a cc id — the only kind that can be resumed. */
  function endedConversation(ccSessionId: string): void {
    const s = prepareSession()
    ctx.db
      .update(sessions)
      .set({ status: 'ended', ccSessionId })
      .where(eq(sessions.id, s.id))
      .run()
  }

  it('picks the last conversation back up by default', async () => {
    endedConversation('cc-prep-1')

    await launchPrepareSession(ctx, { projectId: PROJECT_ID }, { spawn: false })

    expect(launchCommand()).toContain('--resume cc-prep-1')
    expect(ctx.db.select().from(events).all().map((e) => e.type)).toContain('session.resumed')
  })

  it('starts over when asked, leaving the old conversation behind', async () => {
    endedConversation('cc-prep-1')

    await launchPrepareSession(ctx, { projectId: PROJECT_ID, fresh: true }, { spawn: false })

    expect(launchCommand()).not.toContain('--resume')
    const types = ctx.db.select().from(events).all().map((e) => e.type)
    expect(types).not.toContain('session.resumed')
    // …and the choice is visible on the timeline, which otherwise reads exactly
    // like a project that had never been prepared at all.
    const launching = ctx.db
      .select()
      .from(events)
      .all()
      .find((e) => e.type === 'session.launching')
    expect((launching?.data as { fresh?: boolean })?.fresh).toBe(true)
  })
})
