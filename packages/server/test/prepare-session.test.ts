import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { simpleGit } from 'simple-git'
import type { Project, SessionRow } from '@runcastle/core'
import { PREPARED_KEYS, isProjectSessionKind } from '@runcastle/core'
import { events, projects, sessions } from '../src/db/schema'
import type { AppCtx } from '../src/db/types'
import {
  PREPARE_CONFIRM_KICKOFF,
  RESUME_KICKOFF_PREFIX,
  activeProjectSession,
  activeSessionsForFeature,
  createSessionRow,
  kickoffDeliveryFor,
  markSessionLive,
  mostRecentResumableProjectSession,
  mostRecentResumableSession,
} from '../src/launcher/sessions'
import { launchPrepareSession } from '../src/launcher/launcher'
import { reconcileStaleSessions } from '../src/launcher/reconcile'
import { endSession } from '../src/pty/end-session'
import { emitForSession } from '../src/services/events'
import { listFindings, preparedValue, recordFinding } from '../src/services/findings'
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
  return { id: PROJECT_ID, name: 'acme', repoPath: '/repo', ...over }
}

function seedProject(over: Partial<Project> = {}): Project {
  const p = project(over)
  ctx.db
    .insert(projects)
    .values({
      id: p.id,
      name: p.name,
      repoPath: p.repoPath,
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
  it('marks an agent measurement `session`, leaving it improvable', async () => {
    const s = prepareSession()
    const res = await toolRecordFinding(ctx, s, {
      key: 'verifyCommands',
      value: 'bun run test',
      evidence: 'ran it, exit 0',
    })
    expect(res.source).toBe('session')
    expect(preparedValue(ctx, PROJECT_ID, 'verifyCommands')).toBe('bun run test')
  })

  it('marks a user-supplied value `human`, which locks it', async () => {
    const s = prepareSession()
    const res = await toolRecordFinding(ctx, s, {
      key: 'driveSetupCommand',
      value: 'bash .runcastle/drive-setup.sh',
      userSupplied: true,
    })
    expect(res.source).toBe('human')

    // Locked: a subsequent agent measurement must not overwrite it.
    const second = await toolRecordFinding(ctx, s, {
      key: 'driveSetupCommand',
      value: 'something else',
    })
    expect(second.skipped).toBeTruthy()
    expect(preparedValue(ctx, PROJECT_ID, 'driveSetupCommand')).toBe(
      'bash .runcastle/drive-setup.sh',
    )
  })

  it('refuses when the session has no project', async () => {
    const orphan = { ...prepareSession(), projectId: undefined }
    await expect(toolRecordFinding(ctx, orphan, { key: 'devCommand', value: 'x' })).rejects.toThrow()
  })

  it('stamps session and user-supplied findings at main HEAD and reports their commit distance', async () => {
    const repoPath = mkdtempSync(join(tmpdir(), 'rc-finding-staleness-'))
    try {
      const g = simpleGit(repoPath)
      await g.init(['-b', 'main'])
      await g.addConfig('user.email', 'test@runcastle.dev')
      await g.addConfig('user.name', 'Runcastle Test')
      writeFileSync(join(repoPath, 'README.md'), 'base\n')
      await g.add(['README.md'])
      await g.commit('initial commit')
      const establishedSha = (await g.revparse(['main'])).trim()
      ctx.db.update(projects).set({ repoPath }).where(eq(projects.id, PROJECT_ID)).run()
      const p = project({ repoPath })
      const s = prepareSession()

      await toolRecordFinding(ctx, s, { key: 'verifyCommands', value: 'bun test' })
      await toolRecordFinding(ctx, s, {
        key: 'devCommand',
        value: 'bun dev',
        userSupplied: true,
      })

      const fresh = await listFindings(ctx, p)
      expect(fresh.find((finding) => finding.key === 'verifyCommands')).toMatchObject({
        source: 'session',
        establishedSha,
        staleCommits: 0,
      })
      expect(fresh.find((finding) => finding.key === 'devCommand')).toMatchObject({
        source: 'human',
        establishedSha,
        staleCommits: 0,
      })

      writeFileSync(join(repoPath, 'README.md'), 'base\nafter preparation\n')
      await g.add(['README.md'])
      await g.commit('commit after preparation')

      const aged = await listFindings(ctx, p)
      expect(aged.find((finding) => finding.key === 'verifyCommands')?.staleCommits).toBe(1)
      expect(aged.find((finding) => finding.key === 'devCommand')?.staleCommits).toBe(1)
    } finally {
      rmSync(repoPath, { recursive: true, force: true })
    }
  })

  it('records the finding without a stamp when the repository is unavailable', async () => {
    const s = prepareSession()

    await expect(
      toolRecordFinding(ctx, s, { key: 'knownFailures', value: 'one existing failure' }),
    ).resolves.toMatchObject({ ok: true, key: 'knownFailures' })

    expect(preparedValue(ctx, PROJECT_ID, 'knownFailures')).toBe('one existing failure')
    expect(
      (await listFindings(ctx, project())).find((finding) => finding.key === 'knownFailures'),
    ).not.toHaveProperty('establishedSha')
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
   * The prompt is PER-SESSION FACTS now. It used to be the largest artifact in
   * the system — 13,494 chars, ~3,374 tokens — because it rendered the drive
   * contract, the discovery method, five stack recipes and a dry-run
   * walkthrough on every launch while branching on `remainingKeys` in exactly
   * one 34-character place. With one key open, 84% of it was provably
   * irrelevant, and it GREW as work completed. All of that moved into
   * `/runcastle:prepare`.
   */
  it('is a fraction of its old size and carries no moved procedure', () => {
    const out = renderPreparePrompt({
      project: project(),
      remainingKeys: ['knownFailures'],
      established: [],
    })
    expect(out.length).toBeLessThan(4000)
    // the four blocks that now live in the skill / its references
    expect(out).not.toContain('Discover the shape before you author anything')
    expect(out).not.toContain('adapt them, never copy them')
    expect(out).not.toContain('dry_run_drive')
    expect(out).not.toContain('override: true')
    // and it names the skill that has them
    expect(out).toContain('/runcastle:prepare')
  })

  /**
   * The drive prose is gated on the agenda actually reaching the drive loop.
   * `dbResetCommand` is deliberately outside that set — the old prompt said in
   * one breath that it is "NOT part of the drive loop" and in the next rendered
   * 10,355 chars of drive contract for a session opened to settle only it.
   */
  it('renders the drive framing only when an open key is in the drive loop', () => {
    const driveish = renderPreparePrompt({
      project: project(),
      remainingKeys: ['driveSetupCommand'],
      established: [],
    })
    expect(driveish).toContain('These keys are the drive loop')
    expect(driveish).toContain('.runcastle/drive.env')

    for (const key of ['knownFailures', 'dbResetCommand', 'verifyCommands']) {
      const out = renderPreparePrompt({
        project: project(),
        remainingKeys: [key],
        established: [],
      })
      expect(out).not.toContain('These keys are the drive loop')
      expect(out.length).toBeLessThan(driveish.length)
    }
  })

  /**
   * `verifiedAt` and `staleCommits` are computed by `listFindings` and were
   * being dropped on the floor by `buildPrepareBrief`, so a value measured
   * today and a value measured a year and 400 commits ago read identically to
   * the agent deciding whether to re-derive either.
   */
  it('renders how stale and how proven each established value is', () => {
    const out = renderPreparePrompt({
      project: project(),
      remainingKeys: [],
      established: [
        { key: 'devCommand', source: 'session', verifiedAt: Date.now(), staleCommits: 0 },
        { key: 'setupCommand', source: 'run', evidence: 'ran it', staleCommits: 412 },
      ],
    })
    expect(out).toContain('verified today')
    expect(out).toContain('412 commit(s) behind')
    expect(out).toContain('never verified by a drive')
  })

  /**
   * What the server can see for itself. The prompt used to send the agent off
   * to discover the platform, the package manager, whether there is a compose
   * file and whether `.runcastle/` exists — four things a `statSync` away from
   * the process writing the prompt.
   */
  it('reports the host probes the server made instead of asking for them', () => {
    const out = renderPreparePrompt({
      project: project(),
      remainingKeys: ['devCommand'],
      established: [],
      host: {
        platform: 'win32',
        hasCompose: true,
        hasDriveMachinery: false,
        packageManager: 'bun',
      },
    })
    expect(out).toContain('What the server already checked')
    expect(out).toContain('win32')
    expect(out).toContain('`bun`')
    expect(out).toContain('Compose file at the repo root: **yes**')
  })

  /**
   * The 0-keys-open path used to give three instructions to work an empty list
   * and one to stop: "_Nothing is unset… say so and **stop**_" alongside a task
   * line saying to tell the human which fields are open and a 2,246-char
   * closing move ordering a dry-run drive. All four now say the same thing.
   */
  it('says confirm-and-stop consistently when nothing is open', () => {
    const out = renderPreparePrompt({
      project: project(),
      remainingKeys: [],
      established: [{ key: 'devCommand', source: 'human' }],
    })
    expect(out).toMatch(/confirmation,\nnot a preparation/)
    expect(out).toContain('there is nothing open to work')
    expect(out).not.toContain('which fields are still open and what you need')
    // and no dry-run drive is ordered
    expect(out).not.toContain('dry_run_drive')
  })

  /** The standing rules that must hold BEFORE a skill has been loaded. */
  it('keeps ask-before-you-act, the write scope, secrets and record_finding', () => {
    const out = renderPreparePrompt({
      project: project(),
      remainingKeys: ['devCommand'],
      established: [],
    })
    expect(out).toContain('ask before you act')
    expect(out).toContain('`.runcastle/`')
    expect(out).toContain('.gitignore')
    expect(out).toContain('record_finding')
    expect(out).toContain('userSupplied')
    expect(out).toContain('Secrets')
  })
})

/**
 * The procedure that left the prompt has to have LANDED somewhere. These read
 * the shipped skill rather than trusting that it was written: a prompt that
 * dropped its drive contract and a skill that never gained one is strictly
 * worse than the bloated prompt it replaced.
 */
describe('the prepare skill', () => {
  const skillDir = join(
    import.meta.dirname,
    '..',
    '..',
    'skills',
    'packs',
    'runcastle',
    'skills',
    'prepare',
  )

  it('carries the drive contract, the discovery method and the dry run', () => {
    const skill = readFileSync(join(skillDir, 'SKILL.md'), 'utf8')
    expect(skill).toContain('name: prepare')
    // the seven-point contract
    expect(skill).toContain('.runcastle/drive.env')
    expect(skill).toContain('RUNCASTLE_ID')
    expect(skill).toContain('idempotent')
    expect(skill).toContain('Exit 0 means')
    // discovery
    expect(skill).toContain('Discover the shape before you author anything')
    // the dry run
    expect(skill).toContain('dry_run_drive')
    expect(skill).toContain('prep-dry-run')
    expect(skill).toContain('mark your own homework')
    // the env-loading audit
    expect(skill).toContain('override: true')
  })

  /**
   * All SEVEN prepared keys are accounted for. The prompt used to explain four
   * and leave `setupCommand`, `verifyCommands` and `knownFailures` defined
   * nowhere at all.
   */
  it('documents every prepared key, sandbox ones included', () => {
    const skill = readFileSync(join(skillDir, 'SKILL.md'), 'utf8')
    for (const key of PREPARED_KEYS) expect(skill).toContain(key)
    expect(skill).toMatch(/human-supplied/i)
  })

  it('keeps the recipes in a reference that loads only when reached for', () => {
    const recipes = readFileSync(join(skillDir, 'references', 'recipes.md'), 'utf8')
    expect(recipes).toContain('COMPOSE_PROJECT_NAME')
    expect(recipes).toContain('createdb')
    // the two helpers that were called but defined nowhere are named as the
    // agent's job rather than presented as runnable
    expect(recipes).toContain('pick_port')
    expect(recipes).toContain('port_in_use')
    expect(recipes).toMatch(/pseudocode/i)
    // and the language is keyed off the platform rather than assumed to be bash
    expect(recipes).toContain('process.platform')
    expect(recipes).toContain('win32')
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

  /**
   * `RESUME_KICKOFF_PREFIX` was wired only into `launchSession`, so the kind
   * most likely to be resumed got the COLD-START line ("Start by telling them
   * which fields are still open") typed into a conversation already mid-flight.
   */
  it('reframes the kickoff of a resumed preparation instead of restarting it', async () => {
    endedConversation('cc-prep-1')
    const { sessionId } = await launchPrepareSession(
      ctx,
      { projectId: PROJECT_ID },
      { spawn: false },
    )
    markSessionLive(ctx, sessionId, { ccSessionId: 'cc-prep-2' })

    const line = kickoffDeliveryFor(sessionId)?.line ?? ''
    expect(line).toContain(RESUME_KICKOFF_PREFIX)
    expect(line).toMatch(/do not start over/i)
  })

  /**
   * Item 7(c): with nothing open, the prompt, the task line and the kickoff must
   * all say confirm-and-stop. The kickoff used to say the opposite of the prompt
   * it was typed on top of.
   */
  it('opens a nothing-open preparation with confirm-and-stop, not the agenda line', async () => {
    for (const key of PREPARED_KEYS) {
      recordFinding(ctx, PROJECT_ID, { key, value: `value for ${key}`, source: 'human' })
    }
    const { sessionId } = await launchPrepareSession(
      ctx,
      { projectId: PROJECT_ID },
      { spawn: false },
    )
    markSessionLive(ctx, sessionId, { ccSessionId: 'cc-confirm' })

    expect(kickoffDeliveryFor(sessionId)?.line).toBe(PREPARE_CONFIRM_KICKOFF)
    expect(PREPARE_CONFIRM_KICKOFF).not.toContain('still open')
    expect(PREPARE_CONFIRM_KICKOFF).toMatch(/and stop/)
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
