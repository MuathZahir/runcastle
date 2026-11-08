import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Feature, Project, SessionRow } from '@runcastle/core'
import { simpleGit } from 'simple-git'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { AppCtx } from '../src/db/types'
import { renderDriveFixPrompt } from '../src/launcher/artifacts'
import { evaluateEditGuard } from '../src/launcher/edit-guard'
import { createSessionRow } from '../src/launcher/sessions'
import { toolRetryDrive } from '../src/mcp/server'
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
import { seedDriveWorker, seedFeature } from './helpers/fixtures'

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

describe("a Fix-drive worker's edit guard", () => {
  const guard = (filePath: string): ReturnType<typeof evaluateEditGuard> =>
    evaluateEditGuard({
      kind: 'drive-fix',
      worktreePath: '/repo',
      toolName: 'Write',
      filePath,
      featureSlug: 'drivefix',
    })

  it('may write the drive machinery in the checkout, and nothing else', () => {
    expect(guard('.runcastle/drive-setup.sh')).toBeNull()
    expect(guard('.gitignore')).toBeNull()
    expect(guard('src/index.ts')?.reason).toContain('drive machinery')
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

  it('is refused outside the Fix-drive worker, with a reason that says where drives come from', async () => {
    await expect(toolRetryDrive(ctx, session('chat'))).rejects.toThrow(/belongs to the Fix-drive worker/)
  })

  it('stops the held failed drive, starts a fresh one and reports what it saw', async () => {
    recordFinding(ctx, project.id, {
      key: 'driveSetupCommand',
      value: 'exit 3',
      source: 'session',
    })
    project = getProjectById(ctx, project.id) as Project
    await testDrive(ctx, project, feature, 'start')
    expect(activeDriveInfo(project.id)?.hookFailure).toBeDefined()

    const retry = await toolRetryDrive(ctx, seedDriveWorker(ctx, { feature }, 'fix-drive', project.repoPath))

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

    const retry = await toolRetryDrive(ctx, seedDriveWorker(ctx, { feature }, 'fix-drive', project.repoPath))

    expect(retry.stopped).toBe(false)
    expect(retry.ok).toBe(true)
    expect(retry.drive?.hookFailure).toBeUndefined()
  })
})

describe('the drive-fix brief', () => {
  const brief = {
    project: { id: 'proj_1', name: 'acme', repoPath: '/home/dev/acme' },
    feature: {
      id: 'feat_1',
      projectId: 'proj_1',
      slug: 'add-billing',
      title: 'Add billing',
      oneLiner: 'bill people',
      branch: 'feature/add-billing',
      status: 'active' as const,
      createdAt: 0,
    },
    failure: {
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
