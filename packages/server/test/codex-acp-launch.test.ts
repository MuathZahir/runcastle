import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { sessionDir } from '@runcastle/core/paths'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { RuncastleConfig as ConfigSchema, type Feature, type Project, type SessionRow } from '@runcastle/core'
import { codexHomeDir, codexRuntime } from '../src/launcher/runtimes/codex'

/** `codexRuntime.acpLaunch` — pure description of a Codex thread's launch over codex-acp (ADR-0015). */
describe('codexRuntime.acpLaunch', () => {
  const project: Project = { id: 'proj_1', name: 'p', repoPath: '/repo' }
  const feature: Feature = {
    id: 'feat_abc',
    projectId: 'proj_1',
    slug: 'dark-mode',
    title: 'Dark mode',
    oneLiner: 'a dark theme',
    branch: 'feature/dark-mode',
    status: 'active',
    createdAt: 0,
  }
  const sess: SessionRow = {
    id: 'sess_codex_acp',
    featureId: 'feat_abc',
    kind: 'chat',
    status: 'launching',
    awaitingInput: false,
    worktreePath: '/wt',
  }
  let userHome: string
  let worktree: string
  let realCodexHome: string | undefined

  beforeEach(() => {
    userHome = mkdtempSync(join(tmpdir(), 'runcastle-acp-home-'))
    worktree = mkdtempSync(join(tmpdir(), 'runcastle-acp-wt-'))
    realCodexHome = process.env.CODEX_HOME
    process.env.CODEX_HOME = userHome
    writeFileSync(join(userHome, 'auth.json'), '{"tokens":{"id_token":"real"}}', 'utf8')
    vi.spyOn(codexRuntime, 'resolveBinary').mockReturnValue('/usr/local/bin/codex')
  })

  afterEach(() => {
    vi.restoreAllMocks()
    if (realCodexHome === undefined) delete process.env.CODEX_HOME
    else process.env.CODEX_HOME = realCodexHome
    rmSync(sessionDir(sess.id), { recursive: true, force: true })
    rmSync(userHome, { recursive: true, force: true })
    rmSync(worktree, { recursive: true, force: true })
  })

  const launch = () =>
    codexRuntime.acpLaunch!({
      session: sess,
      feature,
      project,
      config: ConfigSchema.parse({}),
      worktreePath: worktree,
      serverUrl: 'http://localhost:4512',
      model: 'gpt-5.6-sol',
      kickoffLine: '$project',
      headless: true,
    })

  it('runs codex-acp under the current runtime, against the installed codex and the per-session home', async () => {
    const spec = await launch()
    const home = codexHomeDir(sess.id)

    expect(spec.command).toBe(process.execPath)
    expect(spec.args).toHaveLength(1)
    expect(spec.args[0]).toMatch(/codex-acp[\\/]dist[\\/]index\.js$/)
    expect(existsSync(spec.args[0])).toBe(true)
    expect(spec.env).toEqual({
      CODEX_HOME: home,
      CODEX_PATH: '/usr/local/bin/codex',
      RUNCASTLE_SESSION_ID: sess.id,
      RUNCASTLE_SERVER_URL: 'http://localhost:4512',
      NO_BROWSER: '1',
    })
    expect(spec.envScrub).toEqual([])
  })

  it('writes the same home as the argv launch, and ignores the kickoff', async () => {
    const spec = await launch()
    const home = codexHomeDir(sess.id)

    expect(spec.files).toEqual(
      expect.arrayContaining([
        join(home, 'config.toml'),
        join(home, 'hooks.json'),
        join(home, 'AGENTS.md'),
        join(home, 'auth.json'),
      ]),
    )
    expect(readFileSync(join(home, 'config.toml'), 'utf8')).toContain('gpt-5.6-sol')
    expect(readFileSync(join(home, 'auth.json'), 'utf8')).toContain('real')
    expect(JSON.stringify(spec)).not.toContain('$project')
    expect(spec.sessionMeta).toEqual({})
  })
})
