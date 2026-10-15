import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AgentRuntime, Project } from '@runcastle/core'
import { sessionDir } from '@runcastle/core/paths'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { AppCtx } from '../src/db/types'
import { type ProjectBrief, renderProjectPrompt } from '../src/launcher/artifacts'
import { launchProjectSession } from '../src/launcher/launcher'
import { codexHomeDir } from '../src/launcher/runtimes/codex'
import { awaitProjectLandings, getSessionRow } from '../src/launcher/sessions'
import { PROJECT_BRANCH } from '../src/services/git'
import { listByProject } from '../src/services/events'
import { updateSettings } from '../src/services/settings'
import { useDataDir } from './helpers/data-dir'
import { makeTestCtx } from './helpers/db'
import { rmTemp, seedProject } from './helpers/fixtures'

/**
 * The orchestrating launch (`whole-cuts-plan-themselves` decisions 10, 14): with
 * the project's Orchestrator setting on, the project session opens as the
 * orchestrator — purpose `orchestrate`, prompts off, the orchestrating briefing.
 * Off, it is the project session exactly as it was.
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

describe('the orchestrating project session launch', () => {
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

  function setOrchestrator(on: boolean): void {
    updateSettings(ctx, { projectId: project.id, key: 'orchestrator', value: on })
  }

  function launchCommand(): string {
    const launched = listByProject(ctx, project.id)
      .filter((e) => e.type === 'session.launched')
      .at(-1)
    return String((launched?.data as { command?: string })?.command ?? '')
  }

  function claudePrompt(sessionId: string): string {
    return readFileSync(join(sessionDir(sessionId), 'system-prompt.md'), 'utf8')
  }

  it('with the setting on, launches Claude Code as the orchestrator with prompts off', async () => {
    useRuntime('claude-code')
    setOrchestrator(true)
    const { sessionId } = await launchProjectSession(ctx, { projectId: project.id }, { spawn: false })

    expect(getSessionRow(ctx, sessionId)?.purpose).toBe('orchestrate')
    expect(launchCommand()).toContain('--permission-mode bypassPermissions')
    const prompt = claudePrompt(sessionId)
    expect(prompt).toContain('## Orchestrating')
    expect(prompt).toContain('/runcastle:project')
    expect(prompt).toContain('Nothing has happened on your features since you were last live.')
  })

  it('with the setting on, launches Codex with approvals never and no sandbox', async () => {
    useRuntime('codex')
    setOrchestrator(true)
    const { sessionId } = await launchProjectSession(ctx, { projectId: project.id }, { spawn: false })

    expect(getSessionRow(ctx, sessionId)?.purpose).toBe('orchestrate')
    const home = codexHomeDir(sessionId)
    const toml = readFileSync(join(home, 'config.toml'), 'utf8')
    expect(toml).toContain('approval_policy = "never"')
    expect(toml).toContain('sandbox_mode = "danger-full-access"')
    const prompt = readFileSync(join(home, 'AGENTS.md'), 'utf8')
    expect(prompt).toContain('## Orchestrating')
    expect(prompt).toContain('$project')
  })

  it('with the setting off, is the ordinary project session', async () => {
    useRuntime('claude-code')
    setOrchestrator(false)
    const { sessionId } = await launchProjectSession(ctx, { projectId: project.id }, { spawn: false })

    expect(getSessionRow(ctx, sessionId)?.purpose).toBeUndefined()
    expect(launchCommand()).toContain('--permission-mode default')
    expect(claudePrompt(sessionId)).not.toContain('Orchestrating')
  })

  it('a triage launch stays an ordinary session even with the setting on', async () => {
    useRuntime('codex')
    setOrchestrator(true)
    const { sessionId } = await launchProjectSession(
      ctx,
      { projectId: project.id, purpose: 'triage' },
      { spawn: false },
    )

    expect(getSessionRow(ctx, sessionId)?.purpose).toBeUndefined()
    const home = codexHomeDir(sessionId)
    expect(readFileSync(join(home, 'config.toml'), 'utf8')).toContain('approval_policy = "on-request"')
    expect(readFileSync(join(home, 'AGENTS.md'), 'utf8')).not.toContain('Orchestrating')
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

  it('is absent when the brief does not orchestrate, leaving the prompt byte-identical', () => {
    const ordinary = renderProjectPrompt(brief)
    expect(renderProjectPrompt({ ...brief, orchestrate: false, catchUp: ['ignored'] })).toBe(ordinary)
    expect(ordinary).not.toContain('Orchestrating')
  })

  it('is the only difference an orchestrating brief makes', () => {
    const ordinary = renderProjectPrompt(brief)
    const orchestrating = renderProjectPrompt({ ...brief, orchestrate: true, catchUp: [] })
    const start = orchestrating.indexOf('## Orchestrating')
    const end = orchestrating.indexOf('## Your task')
    expect(start).toBeGreaterThan(0)
    expect(orchestrating.slice(0, start) + orchestrating.slice(end)).toBe(ordinary)
  })

  it('names the skill section, the prompts-off posture and the catch-up lines', () => {
    const out = renderProjectPrompt(
      {
        ...brief,
        orchestrate: true,
        catchUp: ['login-form: planning run finished', 'search: burn failed'],
      },
      'codex',
    )
    expect(out).toContain('you are the orchestrator')
    expect(out).toContain('"Orchestrating" section of the\n`$project` skill')
    expect(out).toMatch(/without permission prompts/)
    expect(out).toContain(
      '### Since you were last live\n- login-form: planning run finished\n- search: burn failed',
    )
    expect(out).not.toContain('Nothing has happened')
  })
})
