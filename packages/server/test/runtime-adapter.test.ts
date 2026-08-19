import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AgentRuntime } from '@runcastle/core'
import { sessionDir, worktreeDir } from '@runcastle/core/paths'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { AppCtx } from '../src/db/types'
import { sessions } from '../src/db/schema'
import { launchSession } from '../src/launcher/launcher'
import type { AgentRuntimeAdapter, RuntimeReadiness } from '../src/launcher/runtimes'
import { registerRuntimeAdapter, resetRuntimeAdapters } from '../src/launcher/runtimes'
import { KICKOFF_LINES } from '../src/launcher/runtimes/claude'
import { codexHomeDir } from '../src/launcher/runtimes/codex'
import { createSessionRow, getSessionRow, kickoffLineFor } from '../src/launcher/sessions'
import { listAfter } from '../src/services/events'
import { createFeatureBranch } from '../src/services/git'
import { makeTestCtx } from './helpers/db'
import { seedFeature, seedProject } from './helpers/fixtures'

/**
 * The AgentRuntime seam, from the launcher's side: which adapter a launch picks,
 * what it refuses to launch, and what it stamps on the session.
 *
 * The stub adapter is the point — a runtime that is not Claude Code exists here
 * and nowhere else, which is exactly what proves the launcher dispatches on the
 * resolved model's runtime rather than on knowing what `claude` is.
 */
function stubAdapter(
  id: AgentRuntime,
  overrides: Partial<AgentRuntimeAdapter> = {},
): AgentRuntimeAdapter {
  return {
    id,
    binary: 'stub-agent',
    resolveBinary: () => '/usr/bin/stub-agent',
    checkReady: (): RuntimeReadiness => ({ ok: true }),
    writeArtifacts: async () => ({
      files: [],
      argv: ['--stub', 'ok'],
      env: {},
      envScrub: [],
    }),
    kickoffLine: () => 'stub kickoff',
    ...overrides,
  }
}

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim()
}

describe('runtime dispatch at launch', () => {
  let ctx: AppCtx
  let repoPath: string
  const cleanup: string[] = []

  beforeEach(async () => {
    ctx = await makeTestCtx()
    repoPath = mkdtempSync(join(tmpdir(), 'runcastle-runtime-'))
    cleanup.push(repoPath)
    git(repoPath, 'init', '-b', 'main')
    git(repoPath, 'config', 'user.email', 'test@runcastle.dev')
    git(repoPath, 'config', 'user.name', 'Runcastle Test')
    git(repoPath, 'commit', '--allow-empty', '-m', 'initial commit')
  })

  afterEach(() => {
    resetRuntimeAdapters()
    for (const d of cleanup) rmSync(d, { recursive: true, force: true })
    cleanup.length = 0
  })

  /** Point every model step at `id`, declared to run on `runtime`. */
  function useModel(id: string, runtime: AgentRuntime): void {
    ctx.config = { ...ctx.config, model: id, models: [{ id, runtime }] }
  }

  it('picks the adapter named by the resolved model entry’s runtime', async () => {
    registerRuntimeAdapter(stubAdapter('codex'))
    useModel('gpt-5.6-sol', 'codex')

    const project = seedProject(ctx, repoPath)
    const feature = seedFeature(ctx, project.id, { slug: 'codex-pick' })
    await createFeatureBranch(project, 'codex-pick')
    cleanup.push(worktreeDir(project.id, 'codex-pick'))

    const { sessionId } = await launchSession(
      ctx,
      { featureId: feature.id, kind: 'ideation' },
      { spawn: false },
    )
    cleanup.push(sessionDir(sessionId))

    // The rendered smoke command is the stub's, not `claude` with claude flags.
    const launched = listAfter(ctx, feature.id, 0).find((e) => e.type === 'session.launched')
    expect((launched?.data as { command?: string }).command).toBe('stub-agent --stub ok')
  })

  /**
   * The `spawn:false` smoke path on the REAL Codex adapter (SPEC §11). A launch
   * configured through a synthetic home rather than through flags is only half
   * described by its argv, so the rendered command carries `CODEX_HOME` too —
   * without it the line reads as a session pointed at the human's own config.
   */
  it('renders the whole codex command, synthetic home included, without spawning', async () => {
    useModel('gpt-5.6-sol', 'codex')

    const project = seedProject(ctx, repoPath)
    const feature = seedFeature(ctx, project.id, { slug: 'codex-smoke' })
    await createFeatureBranch(project, 'codex-smoke')
    cleanup.push(worktreeDir(project.id, 'codex-smoke'))

    const { sessionId } = await launchSession(
      ctx,
      { featureId: feature.id, kind: 'ideation' },
      { spawn: false },
    )
    cleanup.push(sessionDir(sessionId))

    const launched = listAfter(ctx, feature.id, 0).find((e) => e.type === 'session.launched')
    const command = String((launched?.data as { command?: string }).command)
    expect(command).toContain(`CODEX_HOME=${codexHomeDir(sessionId)}`)
    expect(command).toContain(`RUNCASTLE_SESSION_ID=${sessionId}`)
    expect(command).toContain('codex --dangerously-bypass-hook-trust')
    expect(existsSync(join(codexHomeDir(sessionId), 'config.toml'))).toBe(true)
  })

  it('refuses a launch whose runtime is not ready, naming the doctor fix', async () => {
    registerRuntimeAdapter(
      stubAdapter('codex', {
        checkReady: () => ({
          ok: false,
          reason: 'the codex CLI is not on this server’s PATH',
          doctorHint: 'Run `runcastle doctor` and fix its "Codex CLI" probe.',
        }),
      }),
    )
    useModel('gpt-5.6-sol', 'codex')

    const project = seedProject(ctx, repoPath)
    const feature = seedFeature(ctx, project.id, { slug: 'not-ready' })

    await expect(
      launchSession(ctx, { featureId: feature.id, kind: 'ideation' }),
    ).rejects.toThrow(/codex CLI is not on this server.*runcastle doctor/s)

    // Refused EARLY: no session row was created, so nothing lingers `launching`
    // to block the next terminal on this feature.
    expect(ctx.db.select().from(sessions).all()).toHaveLength(0)
  })

  it('refuses a launch whose runtime has no adapter at all', async () => {
    // Both shipped runtimes are wired up now, so the unwired case needs a runtime
    // id no adapter claims — the shape a third runtime would first arrive in.
    useModel('gemini-3-pro', 'gemini' as AgentRuntime)

    const project = seedProject(ctx, repoPath)
    const feature = seedFeature(ctx, project.id, { slug: 'unwired' })

    await expect(
      launchSession(ctx, { featureId: feature.id, kind: 'ideation' }, { spawn: false }),
    ).rejects.toThrow(/no agent runtime is wired up for gemini/)
  })

  it('stamps the resolved model and runtime on the session row and its event', async () => {
    const project = seedProject(ctx, repoPath)
    const feature = seedFeature(ctx, project.id, { slug: 'stamped' })
    await createFeatureBranch(project, 'stamped')
    cleanup.push(worktreeDir(project.id, 'stamped'))

    const { sessionId } = await launchSession(
      ctx,
      { featureId: feature.id, kind: 'ideation' },
      { spawn: false },
    )
    cleanup.push(sessionDir(sessionId))

    expect(getSessionRow(ctx, sessionId)).toMatchObject({
      model: 'claude-opus-5',
      runtime: 'claude-code',
    })
    // the mutation announces itself, so the timeline can say which agent this is
    const launching = listAfter(ctx, feature.id, 0).find((e) => e.type === 'session.launching')
    expect(launching?.data).toMatchObject({ model: 'claude-opus-5', runtime: 'claude-code' })
  })

  it('leaves a row created outside a launch unstamped rather than inventing a model', () => {
    const project = seedProject(ctx, repoPath)
    const feature = seedFeature(ctx, project.id, { slug: 'unstamped' })

    const row = createSessionRow(ctx, {
      featureId: feature.id,
      kind: 'ideation',
      worktreePath: repoPath,
    })

    expect(row.model).toBeUndefined()
    expect(row.runtime).toBeUndefined()
    // ...and a runtime nobody recorded reads as the one every session used to run
    expect(kickoffLineFor(row.kind, undefined, row.runtime)).toBe(KICKOFF_LINES.ideation)
  })
})
