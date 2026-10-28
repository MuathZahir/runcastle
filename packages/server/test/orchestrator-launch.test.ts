import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AgentRuntime, Project } from '@runcastle/core'
import { sessionDir } from '@runcastle/core/paths'
import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { sessions } from '../src/db/schema'
import type { AppCtx } from '../src/db/types'
import { type ProjectBrief, renderProjectPrompt } from '../src/launcher/artifacts'
import { launchProjectSession } from '../src/launcher/launcher'
import { codexHomeDir } from '../src/launcher/runtimes/codex'
import { awaitProjectLandings, getSessionRow } from '../src/launcher/sessions'
import { endSession } from '../src/pty/end-session'
import { PROJECT_BRANCH } from '../src/services/git'
import { emit, listByProject, runAsActor } from '../src/services/events'
import { useDataDir } from './helpers/data-dir'
import { makeTestCtx } from './helpers/db'
import { rmTemp, seedFeature, seedProject } from './helpers/fixtures'
import { acpLaunchOf, briefOf, kickoffOf } from './support/thread-launch'

/**
 * The orchestrating launch (`one-orchestrator-no-mode` decision 1): every
 * project session — fresh, resumed or triage — opens as the orchestrator:
 * prompts off, the orchestrating briefing and its catch-up.
 * No session row carries an `orchestrate` purpose any more.
 */

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim()
}

function initRepo(dir: string): void {
  git(dir, 'init', '-b', 'main')
  git(dir, 'config', 'user.email', 'test@runcastle.dev')
  git(dir, 'config', 'user.name', 'Runcastle Test')
  writeFileSync(join(dir, 'README.md'), 'base\n')
  git(dir, 'add', 'README.md')
  git(dir, 'commit', '-m', 'initial commit')
}

describe('the project session launch is the orchestrator', () => {
  let ctx: AppCtx
  let project: Project
  const cleanup: string[] = []
  let restoreDataDir: () => void

  beforeEach(async () => {
    const home = mkdtempSync(join(tmpdir(), 'rc-orch-home-'))
    cleanup.push(home)
    restoreDataDir = useDataDir(home)
    ctx = await makeTestCtx()
    const repoPath = mkdtempSync(join(tmpdir(), 'rc-orch-repo-'))
    cleanup.push(repoPath)
    initRepo(repoPath)
    project = seedProject(ctx, repoPath)
  })

  afterEach(async () => {
    await awaitProjectLandings()
    restoreDataDir()
    for (const d of cleanup) rmTemp(d)
    cleanup.length = 0
  })

  function useRuntime(runtime: AgentRuntime): void {
    const id = runtime === 'codex' ? 'gpt-5.6-sol' : 'claude-sonnet-5'
    ctx.config = { ...ctx.config, model: id, models: [{ id, runtime }] }
  }

  /** The settings file the thread's process starts with. */
  async function settingsOf(sessionId: string): Promise<string> {
    const spec = await acpLaunchOf(ctx, sessionId)
    return readFileSync(spec.files.find((f) => f.endsWith('settings.json')) as string, 'utf8')
  }

  /** A first session that ended `ago` ms back, with a conversation a reopen can pick up. */
  async function endedSession(ago = 10_000): Promise<string> {
    const { sessionId } = await launchProjectSession(ctx, { projectId: project.id }, { spawn: false })
    endSession(ctx, sessionId)
    ctx.db
      .update(sessions)
      .set({ ccSessionId: 'cc-prior', endedAt: Date.now() - ago })
      .where(eq(sessions.id, sessionId))
      .run()
    await awaitProjectLandings()
    return sessionId
  }

  it('launches Claude Code as the orchestrator with prompts off, and no message waiter', async () => {
    useRuntime('claude-code')
    const { sessionId } = await launchProjectSession(ctx, { projectId: project.id }, { spawn: false })

    expect(getSessionRow(ctx, sessionId)?.purpose).toBeUndefined()
    expect((await acpLaunchOf(ctx, sessionId)).sessionMode).toBe('bypassPermissions')
    expect(await settingsOf(sessionId)).not.toContain('wait-messages')
    const prompt = await briefOf(ctx, sessionId)
    expect(prompt).toContain('## Orchestrating')
    expect(prompt).toContain('/runcastle:project')
    expect(prompt).toContain('Nothing has happened on the features you follow since you were last live.')
  })

  it('launches Codex with approvals never and no sandbox', async () => {
    useRuntime('codex')
    const { sessionId } = await launchProjectSession(ctx, { projectId: project.id }, { spawn: false })

    const home = (await acpLaunchOf(ctx, sessionId)).env.CODEX_HOME
    const toml = readFileSync(join(home, 'config.toml'), 'utf8')
    expect(toml).toContain('approval_policy = "never"')
    expect(toml).toContain('sandbox_mode = "danger-full-access"')
    const prompt = readFileSync(join(home, 'AGENTS.md'), 'utf8')
    expect(prompt).toContain('## Orchestrating')
    expect(prompt).toContain('$project')
  })

  it('catches a new conversation up on its followed features; a reopened one heard them as they happened', async () => {
    useRuntime('claude-code')
    const prior = await endedSession()
    const followed = seedFeature(ctx, project.id, { slug: 'mine' })
    runAsActor('orchestrator', () => emit(ctx, followed.id, { type: 'feature.created', message: 'created' }))
    emit(ctx, followed.id, { type: 'merge.conflict', message: 'x', data: { files: ['a.ts'] } })

    const { sessionId } = await launchProjectSession(ctx, { projectId: project.id }, { spawn: false })

    expect(await briefOf(ctx, sessionId)).toContain('### Since you were last live\n- mine merge conflicted in 1 file(s).')
    expect((await acpLaunchOf(ctx, sessionId)).sessionMode).toBe('bypassPermissions')
    expect(await briefOf(ctx, prior)).not.toContain('- mine merge conflicted')
  })

  it('opens a triage launch as the orchestrator too, keeping its errand', async () => {
    useRuntime('codex')
    const { sessionId } = await launchProjectSession(
      ctx,
      { projectId: project.id, purpose: 'triage' },
      { spawn: false },
    )

    expect(getSessionRow(ctx, sessionId)?.purpose).toBeUndefined()
    const home = (await acpLaunchOf(ctx, sessionId)).env.CODEX_HOME
    expect(readFileSync(join(home, 'config.toml'), 'utf8')).toContain('approval_policy = "never"')
    expect(readFileSync(join(home, 'AGENTS.md'), 'utf8')).toContain('## Orchestrating')
    expect(kickoffOf(sessionId)).toContain('list_project_notes')
  })
})

describe('the orchestrating section of the project prompt', () => {
  const brief: ProjectBrief = {
    project: { id: 'proj_1', name: 'acme', repoPath: '/repo' },
    branch: PROJECT_BRANCH,
    worktreePath: '/wt/__project',
    base: 'main',
    openNotes: 0,
  }

  it('is always there, just before the task, and mentions no setting', () => {
    const out = renderProjectPrompt(brief)
    const start = out.indexOf('## Orchestrating')
    const end = out.indexOf('## Your task')
    expect(start).toBeGreaterThan(0)
    expect(end).toBeGreaterThan(start)
    expect(out.slice(start, end)).not.toMatch(/setting|experimental/i)
  })

  it('names the skill section, the prompts-off posture and the catch-up lines', () => {
    const out = renderProjectPrompt(
      { ...brief, catchUp: ['login-form: planning run finished', 'search: round failed'] },
      'codex',
    )
    expect(out).toContain("You are this project's orchestrator.")
    expect(out).toContain('"Orchestrating" section of the `$project`\nskill')
    expect(out).toMatch(/without permission prompts/)
    expect(out).toContain(
      '### Since you were last live\n- login-form: planning run finished\n- search: round failed',
    )
    expect(out).not.toContain('Nothing has happened')
  })
})
