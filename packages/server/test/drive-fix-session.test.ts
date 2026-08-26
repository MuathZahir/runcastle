import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Feature, Project, SessionRow } from '@runcastle/core'
import { sessionDir } from '@runcastle/core/paths'
import { simpleGit } from 'simple-git'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { AppCtx } from '../src/db/types'
import { GateError } from '../src/errors'
import { renderDriveFixPrompt } from '../src/launcher/artifacts'
import { evaluateEditGuard } from '../src/launcher/edit-guard'
import { launchDriveFixSession, launchSession } from '../src/launcher/launcher'
import {
  createSessionRow,
  getSessionRow,
  markSessionEnded,
  markSessionLive,
} from '../src/launcher/sessions'
import { toolRetryDrive } from '../src/mcp/server'
import { listAfter } from '../src/services/events'
import { recordFinding } from '../src/services/findings'
import {
  __resetTestDriveState,
  activeDriveInfo,
  createFeatureBranch,
  testDrive,
} from '../src/services/git'
import { openProject } from '../src/services/projects'
import { getProjectById } from '../src/services/repo'
import { useDataDir } from './helpers/data-dir'
import { makeTestCtx } from './helpers/db'
import { seedFeature } from './helpers/fixtures'

/**
 * The drive-fix session (multi-service decision 9): the one click between a
 * drive whose setup died and an agent already holding the failure.
 *
 * Tested at the seam the ticket names — the session kind boundary. What a launch
 * carries, what it refuses, and the one tool the kind unlocks. The drive
 * underneath is the real machinery on a real repo, because a failure staged by
 * hand proves nothing about the state a fix agent actually inherits.
 */

const tmpDirs: string[] = []

function mkTmp(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  tmpDirs.push(dir)
  return dir
}

/** git init -b main + local identity + one seed commit — enough to be a project. */
async function initRepo(dir: string): Promise<void> {
  const g = simpleGit(dir)
  await g.init(['-b', 'main'])
  await g.addConfig('user.email', 'test@runcastle.dev')
  await g.addConfig('user.name', 'Runcastle Test')
  await g.addConfig('core.autocrlf', 'false')
  writeFileSync(join(dir, 'README.md'), 'base\n')
  await g.add(['README.md'])
  await g.commit('initial commit')
}

describe('launching a drive-fix session', () => {
  let ctx: AppCtx
  let project: Project
  let feature: Feature
  let restoreDataDir: () => void

  beforeEach(async () => {
    restoreDataDir = useDataDir(mkTmp('rc-home-'))
    ctx = await makeTestCtx()
    const repo = mkTmp('rc-drivefix-')
    await initRepo(repo)
    project = await openProject(ctx, repo)
    feature = seedFeature(ctx, project.id, { slug: 'drivefix', title: 'Billing rewrite' })
    await createFeatureBranch(project, feature.slug, 'main')
  })

  afterEach(() => {
    __resetTestDriveState()
    restoreDataDir()
    for (const dir of tmpDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
  })

  /** Establish a prepared value the way `record_finding` does, and re-read the project. */
  function record(key: 'driveSetupCommand' | 'devCommand', value: string): void {
    recordFinding(ctx, project.id, { key, value, source: 'session' })
    const fresh = getProjectById(ctx, project.id)
    if (fresh) project = fresh
  }

  /** Start a drive whose setup command fails — the state a fix session is born into. */
  async function failedDrive(): Promise<void> {
    record('driveSetupCommand', 'echo could-not-reach-postgres && exit 3')
    const start = await testDrive(ctx, project, feature, 'start')
    expect(start.hookFailure?.command).toContain('exit 3')
  }

  function launched(): Promise<{ sessionId: string }> {
    return launchDriveFixSession(ctx, { featureId: feature.id }, { spawn: false })
  }

  /**
   * Every "Fix drive" click used to be a COLD start — `launchDriveFixSession`
   * passed no `resumeSessionId` at all — so an agent on its third attempt
   * re-theorised the same failure with no memory of the two fixes it had
   * already tried.
   */
  it('resumes the previous drive-fix conversation instead of re-theorising cold', async () => {
    await failedDrive()
    const first = await launched()
    markSessionLive(ctx, first.sessionId, { ccSessionId: 'cc-fix-1' })
    markSessionEnded(ctx, first.sessionId)

    await launched()
    const cmd = String(
      (
        listAfter(ctx, feature.id, 0)
          .filter((e) => e.type === 'session.launched')
          .at(-1)?.data as { command?: string }
      )?.command ?? '',
    )
    expect(cmd).toContain('--resume cc-fix-1')
  })

  it('runs host-side in the real checkout, scoped to the feature whose drive failed', async () => {
    await failedDrive()

    const { sessionId } = await launched()
    const session = getSessionRow(ctx, sessionId) as SessionRow

    expect(session.kind).toBe('drive-fix')
    expect(session.featureId).toBe(feature.id)
    // No talk worktree: the environment that broke is this machine's, and the
    // failed drive left the feature branch checked out right here.
    expect(session.worktreePath).toBe(project.repoPath)
  })

  it('may write the drive machinery in that checkout, and nothing else', async () => {
    await failedDrive()
    const { sessionId } = await launched()
    const session = getSessionRow(ctx, sessionId) as SessionRow

    const guard = (filePath: string): ReturnType<typeof evaluateEditGuard> =>
      evaluateEditGuard({
        kind: session.kind,
        worktreePath: session.worktreePath,
        toolName: 'Write',
        filePath,
        featureSlug: feature.slug,
      })

    expect(guard('.runcastle/drive-setup.sh')).toBeNull()
    expect(guard('.gitignore')).toBeNull()
    expect(guard('src/index.ts')?.reason).toContain('drive machinery')
    // The guard is a hook, not a sentence in the briefing — it has to be
    // registered in the settings this launch wrote.
    const settings = JSON.parse(readFileSync(join(sessionDir(sessionId), 'settings.json'), 'utf8')) as {
      hooks: Record<string, unknown>
    }
    expect(settings.hooks.PreToolUse).toBeDefined()
  })

  it('briefs the session with the failure, the delta and the drive.env keys', async () => {
    record('driveSetupCommand', 'exit 3')
    // A real branch delta: the fix agent's first question is what changed.
    const g = simpleGit(project.repoPath)
    await g.checkout('feature/drivefix')
    writeFileSync(join(project.repoPath, 'compose.yml'), 'services: {}\n')
    await g.add(['compose.yml'])
    await g.commit('add a service')
    await g.checkout('main')

    await testDrive(ctx, project, feature, 'start')
    const { sessionId } = await launched()
    const prompt = readFileSync(join(sessionDir(sessionId), 'system-prompt.md'), 'utf8')

    expect(prompt).toContain('exit 3')
    expect(prompt).toContain('compose.yml')
    expect(prompt).toContain('feature/drivefix')
  })

  it('emits a launch event on the feature timeline', async () => {
    await failedDrive()
    const { sessionId } = await launched()

    const launching = listAfter(ctx, feature.id, 0).find(
      (e) => e.type === 'session.launching' && e.data?.sessionId === sessionId,
    )
    expect(launching?.data?.kind).toBe('drive-fix')
    expect(launching?.message).toContain('drive-fix')
  })

  it('refuses when no drive of this feature has failed', async () => {
    await expect(launched()).rejects.toBeInstanceOf(GateError)

    // A drive that came up fine is not something to fix either.
    record('driveSetupCommand', 'echo up')
    expect((await testDrive(ctx, project, feature, 'start')).ok).toBe(true)
    await expect(launched()).rejects.toThrow(/no failed drive/)
  })

  it('counts as the feature’s one terminal', async () => {
    await failedDrive()
    createSessionRow(ctx, { featureId: feature.id, kind: 'qa', worktreePath: '/wt' })

    await expect(launched()).rejects.toThrow(/only one terminal per feature/)
  })

  it('is not reachable through the ordinary talk-session door', async () => {
    await expect(
      launchSession(ctx, { featureId: feature.id, kind: 'drive-fix' }, { spawn: false }),
    ).rejects.toThrow(/Fix drive/)
  })
})

describe('retry_drive', () => {
  let ctx: AppCtx
  let project: Project
  let feature: Feature
  let restoreDataDir: () => void

  beforeEach(async () => {
    restoreDataDir = useDataDir(mkTmp('rc-home-'))
    ctx = await makeTestCtx()
    const repo = mkTmp('rc-drivefix-retry-')
    await initRepo(repo)
    project = await openProject(ctx, repo)
    feature = seedFeature(ctx, project.id, { slug: 'retrydrive' })
    await createFeatureBranch(project, feature.slug, 'main')
  })

  afterEach(() => {
    __resetTestDriveState()
    restoreDataDir()
    for (const dir of tmpDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
  })

  function session(kind: SessionRow['kind']): SessionRow {
    return createSessionRow(ctx, {
      featureId: feature.id,
      kind,
      worktreePath: project.repoPath,
    })
  }

  it('is refused outside a drive-fix session, with a reason that says where drives come from', async () => {
    await expect(toolRetryDrive(ctx, session('revisit'))).rejects.toThrow(/drive-fix session/)
    await expect(toolRetryDrive(ctx, session('qa'))).rejects.toThrow(/review panel/)
  })

  it('stops the held failed drive, starts a fresh one and reports what it saw', async () => {
    recordFinding(ctx, project.id, {
      key: 'driveSetupCommand',
      value: 'exit 3',
      source: 'session',
    })
    project = getProjectById(ctx, project.id) as Project
    await testDrive(ctx, project, feature, 'start')
    expect(activeDriveInfo()?.hookFailure).toBeDefined()

    const retry = await toolRetryDrive(ctx, session('drive-fix'))

    expect(retry.stopped).toBe(true)
    expect(retry.ok).toBe(true)
    expect(retry.branch).toBe('feature/retrydrive')
    // The observables the agent iterates on: the setup hook still failing, the
    // variable names it handed back, and the readiness of the app.
    expect(retry.drive?.hookFailure?.exitCode).toBe(3)
    expect(retry.drive?.envKeys).toEqual([])
    expect(retry.drive?.devReady).toBe(false)
  })

  it('tolerates a slot nobody is holding — the human may have stopped the drive', async () => {
    recordFinding(ctx, project.id, {
      key: 'driveSetupCommand',
      value: 'echo up',
      source: 'session',
    })
    project = getProjectById(ctx, project.id) as Project

    const retry = await toolRetryDrive(ctx, session('drive-fix'))

    expect(retry.stopped).toBe(false)
    expect(retry.ok).toBe(true)
    expect(retry.drive?.hookFailure).toBeUndefined()
  })
})

describe('the drive-fix brief', () => {
  const brief = {
    project: { id: 'proj_1', name: 'acme', repoPath: '/home/dev/acme', mainBranch: 'main' },
    feature: {
      id: 'feat_1',
      projectId: 'proj_1',
      slug: 'add-billing',
      title: 'Add billing',
      oneLiner: 'bill people',
      mapped: false,
      lap: 1,
      phase: 'review' as const,
      branch: 'feature/add-billing',
      status: 'active' as const,
      createdAt: 0,
    },
    failure: {
      phase: 'setup' as const,
      command: 'bash .runcastle/drive-setup.sh',
      exitCode: 3,
      timedOut: false,
      output: 'psql: FATAL: database "acme_add_billing" does not exist',
    },
    envKeys: ['DATABASE_URL', 'PORT'],
    delta: {
      base: 'main',
      branch: 'feature/add-billing',
      stat: ' compose.yml | 12 ++++++++++++\n package.json | 2 +-',
    },
  }

  it('hands over the failure in full — command, outcome and output', () => {
    const prompt = renderDriveFixPrompt(brief)
    expect(prompt).toContain('bash .runcastle/drive-setup.sh')
    expect(prompt).toContain('exited 3')
    expect(prompt).toContain('database "acme_add_billing" does not exist')
  })

  it('says a timeout was a timeout rather than an exit code', () => {
    const prompt = renderDriveFixPrompt({
      ...brief,
      failure: { ...brief.failure, timedOut: true, exitCode: null },
    })
    expect(prompt).toContain('timed out')
  })

  it('names the variables setup handed back, and says so when it handed back none', () => {
    expect(renderDriveFixPrompt(brief)).toContain('`DATABASE_URL`, `PORT`')
    expect(renderDriveFixPrompt({ ...brief, envKeys: [] })).toContain('no `.runcastle/drive.env`')
  })

  it('carries the branch delta and points at the feature’s own docs', () => {
    const prompt = renderDriveFixPrompt(brief)
    expect(prompt).toContain('main...feature/add-billing')
    expect(prompt).toContain('compose.yml | 12')
    expect(prompt).toContain('docs/features/add-billing/')
  })

  it('states the narrow mandate, the ask-before-act rule and where the fix must land', () => {
    const prompt = renderDriveFixPrompt(brief)
    expect(prompt).toContain('repair the environment and retry THIS drive')
    expect(prompt).toContain('Ask before you act')
    expect(prompt).toContain('/home/dev/acme')
    expect(prompt).toContain('.runcastle/')
    expect(prompt).toContain('commit it to the feature branch')
    expect(prompt).toContain('retry_drive')
  })
})
