import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Feature, FeatureStatus, Project } from '@runcastle/core'
import { PROJECT_WORKTREE_SLUG, sessionDir, worktreeDir } from '@runcastle/core/paths'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AppCtx } from '../src/db/types'
import { GateError } from '../src/errors'
import {
  type AutoResumeResult,
  autoResumeChat,
  autoResumeProjectChat,
} from '../src/launcher/launcher'
import {
  createSessionRow,
  getSessionRow,
  markSessionEnded,
  markSessionLive,
  projectSessions,
} from '../src/launcher/sessions'
import type { PtyEntry } from '../src/pty/registry'
import { ptyRegistry } from '../src/pty/registry'
import { stopAllDocsWatch } from '../src/services/docs-watch'
import { listAfter, listByProject } from '../src/services/events'
import { createFeatureBranch } from '../src/services/git'
import { listSessionsByFeature } from '../src/services/repo'
import { useDataDir } from './helpers/data-dir'
import { makeTestCtx } from './helpers/db'
import { rmTemp, seedFeature, seedProject } from './helpers/fixtures'

/**
 * Opening a feature (or the project page) resumes its chat by itself
 * (`opening-a-feature-shows-its-chat-as-you-left-it`). The automatic launch
 * only ever resumes: whatever would refuse, or start a fresh conversation, is a
 * quiet `autoSkipped` with nothing created — no session row, no terminal.
 */

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim()
}

function skipped(result: AutoResumeResult): string | undefined {
  return 'autoSkipped' in result ? result.autoSkipped : undefined
}

function launchedCommand(events: { type: string; data: unknown }[]): string {
  const launched = events.find((e) => e.type === 'session.launched')
  return String((launched?.data as { command?: string } | null)?.command ?? '')
}

describe('auto resume on open', () => {
  let ctx: AppCtx
  let project: Project
  let restoreDataDir: () => void
  const cleanup: string[] = []

  beforeEach(async () => {
    const home = mkdtempSync(join(tmpdir(), 'runcastle-auto-resume-home-'))
    cleanup.push(home)
    restoreDataDir = useDataDir(home)
    ctx = await makeTestCtx()
    const repoPath = mkdtempSync(join(tmpdir(), 'runcastle-auto-resume-repo-'))
    cleanup.push(repoPath)
    git(repoPath, 'init', '-b', 'main')
    git(repoPath, 'config', 'user.email', 'test@runcastle.dev')
    git(repoPath, 'config', 'user.name', 'Runcastle Test')
    git(repoPath, 'commit', '--allow-empty', '-m', 'initial commit')
    project = seedProject(ctx, repoPath)
  })

  const codexHome = process.env.CODEX_HOME
  afterEach(() => {
    if (codexHome === undefined) delete process.env.CODEX_HOME
    else process.env.CODEX_HOME = codexHome
    vi.restoreAllMocks()
    stopAllDocsWatch()
    restoreDataDir()
    for (const dir of cleanup) rmTemp(dir)
    cleanup.length = 0
  })

  function useCodexRuntime(): void {
    const home = mkdtempSync(join(tmpdir(), 'runcastle-auto-resume-codex-'))
    cleanup.push(home)
    process.env.CODEX_HOME = home
    writeFileSync(join(home, 'auth.json'), '{"tokens":{"id_token":"test"}}')
    ctx.config = { ...ctx.config, model: 'gpt-5', models: [{ id: 'gpt-5', runtime: 'codex' }] }
  }

  /** A feature on a real branch whose chat ended with a resumable conversation, unless told otherwise. */
  async function featureWithEndedChat(
    slug: string,
    opts: { status?: FeatureStatus; conversation?: boolean; transcriptPath?: string } = {},
  ): Promise<Feature> {
    const feature = seedFeature(ctx, project.id, { slug, status: opts.status ?? 'active' })
    await createFeatureBranch(project, slug, 'main')
    if (opts.conversation === false) return feature
    const prior = createSessionRow(ctx, {
      featureId: feature.id,
      kind: 'chat',
      worktreePath: worktreeDir(project.id, slug),
    })
    markSessionLive(ctx, prior.id, {
      ccSessionId: 'cc-prior',
      ...(opts.transcriptPath ? { transcriptPath: opts.transcriptPath } : {}),
    })
    markSessionEnded(ctx, prior.id)
    return feature
  }

  async function autoOpen(feature: Feature): Promise<AutoResumeResult> {
    const result = await autoResumeChat(ctx, { featureId: feature.id, kind: 'chat' }, { spawn: false })
    if ('sessionId' in result) cleanup.push(sessionDir(result.sessionId))
    return result
  }

  describe('a feature', () => {
    it('resumes an in-progress feature\'s ended chat, with no kickoff typed into it', async () => {
      const feature = await featureWithEndedChat('resumes')

      const result = await autoOpen(feature)

      expect(skipped(result)).toBeUndefined()
      expect(result).toMatchObject({ resumed: true })
      const command = launchedCommand(listAfter(ctx, feature.id, 0))
      expect(command).toContain('--resume cc-prior')
      expect(command).not.toContain('Feature status:')
      // nothing was sent, so it sits waiting on the human rather than "Working"
      expect(getSessionRow(ctx, (result as { sessionId: string }).sessionId)?.awaitingInput).toBe(true)
    })

    it.each<FeatureStatus>(['shipped', 'archived'])('keeps a %s feature at rest', async (status) => {
      const feature = await featureWithEndedChat(`at-rest-${status}`, { status })

      expect(skipped(await autoOpen(feature))).toBeTruthy()
      expect(listSessionsByFeature(ctx, feature.id)).toHaveLength(1)
    })

    it('starts nothing for a feature with no conversation yet', async () => {
      const feature = await featureWithEndedChat('no-conversation', { conversation: false })

      expect(skipped(await autoOpen(feature))).toContain('no resumable conversation')
      expect(listSessionsByFeature(ctx, feature.id)).toHaveLength(0)
    })

    it('stays at rest when the transcript is gone, rather than starting fresh', async () => {
      const feature = await featureWithEndedChat('gone', {
        transcriptPath: join(tmpdir(), 'runcastle-auto-resume-missing', 'gone.jsonl'),
      })

      expect(skipped(await autoOpen(feature))).toContain('no longer on disk')
      expect(listSessionsByFeature(ctx, feature.id)).toHaveLength(1)
    })

    it('stays at rest while another terminal holds the feature', async () => {
      const feature = await featureWithEndedChat('held')
      createSessionRow(ctx, { featureId: feature.id, kind: 'drive-fix', worktreePath: 'w' })

      expect(skipped(await autoOpen(feature))).toContain('only one terminal per feature')
      expect(listSessionsByFeature(ctx, feature.id)).toHaveLength(2)
    })

    it('stays at rest on the Codex runtime', async () => {
      useCodexRuntime()
      const feature = await featureWithEndedChat('codex')

      expect(skipped(await autoOpen(feature))).toContain('Codex')
      expect(listSessionsByFeature(ctx, feature.id)).toHaveLength(1)
    })

    it('answers with a live chat as it is, writing nothing into it', async () => {
      const feature = await featureWithEndedChat('live')
      const live = createSessionRow(ctx, { featureId: feature.id, kind: 'chat', worktreePath: 'w' })
      markSessionLive(ctx, live.id, { ccSessionId: 'cc-live' })
      const typed: string[] = []
      const entry = { sessionId: live.id, exited: false, pty: { write: (d: string) => typed.push(d) } }
      vi.spyOn(ptyRegistry(), 'get').mockImplementation((id) =>
        id === live.id ? (entry as unknown as PtyEntry) : undefined,
      )

      expect(await autoOpen(feature)).toEqual({ sessionId: live.id })
      expect(typed).toEqual([])
      expect(listAfter(ctx, feature.id, 0).some((e) => e.type === 'session.kickoff')).toBe(false)
      expect(listSessionsByFeature(ctx, feature.id)).toHaveLength(2)
    })

    it('refuses an automatic launch that carries an errand of its own', async () => {
      const feature = await featureWithEndedChat('errand')

      await expect(
        autoResumeChat(ctx, { featureId: feature.id, kind: 'chat', purpose: 'self-plan' }, { spawn: false }),
      ).rejects.toBeInstanceOf(GateError)
      await expect(
        autoResumeChat(ctx, { featureId: feature.id, kind: 'chat', kickoffLine: 'Do this.' }, { spawn: false }),
      ).rejects.toBeInstanceOf(GateError)
    })
  })

  describe('the project page', () => {
    function endedConversation(opts: { ccSessionId?: string; transcriptPath?: string } = {}): string {
      const row = createSessionRow(ctx, {
        projectId: project.id,
        kind: 'project',
        worktreePath: worktreeDir(project.id, PROJECT_WORKTREE_SLUG),
      })
      if (opts.ccSessionId) {
        markSessionLive(ctx, row.id, {
          ccSessionId: opts.ccSessionId,
          ...(opts.transcriptPath ? { transcriptPath: opts.transcriptPath } : {}),
        })
      }
      markSessionEnded(ctx, row.id)
      return row.id
    }

    async function autoOpenProject(resumeSessionId: string): Promise<AutoResumeResult> {
      const result = await autoResumeProjectChat(
        ctx,
        { projectId: project.id, resumeSessionId },
        { spawn: false },
      )
      if ('sessionId' in result) cleanup.push(sessionDir(result.sessionId))
      return result
    }

    it('resumes the conversation it is showing', async () => {
      const shown = endedConversation({ ccSessionId: 'cc-project' })

      const result = await autoOpenProject(shown)

      expect(result).toMatchObject({ resumed: true })
      expect(launchedCommand(listByProject(ctx, project.id))).toContain('--resume cc-project')
      expect(getSessionRow(ctx, (result as { sessionId: string }).sessionId)?.awaitingInput).toBe(true)
    })

    it('never throws for a live project session', async () => {
      const shown = endedConversation({ ccSessionId: 'cc-project' })
      createSessionRow(ctx, { projectId: project.id, kind: 'project', worktreePath: 'w' })

      expect(skipped(await autoOpenProject(shown))).toContain('already open')
      expect(projectSessions(ctx, project.id, 'project')).toHaveLength(2)
    })

    it('never starts fresh for a conversation Claude Code never picked up', async () => {
      const shown = endedConversation()

      expect(skipped(await autoOpenProject(shown))).toBeTruthy()
      expect(projectSessions(ctx, project.id, 'project')).toHaveLength(1)
    })

    it('never starts fresh for a conversation past the re-entry cap', async () => {
      const transcriptPath = join(mkdtempSync(join(tmpdir(), 'runcastle-auto-resume-big-')), 't.jsonl')
      cleanup.push(transcriptPath)
      writeFileSync(transcriptPath, 'x'.repeat(1_100_000))
      const shown = endedConversation({ ccSessionId: 'cc-big', transcriptPath })

      expect(skipped(await autoOpenProject(shown))).toContain('re-entry cap')
      expect(projectSessions(ctx, project.id, 'project')).toHaveLength(1)
    })

    it('stays at rest on the Codex runtime', async () => {
      useCodexRuntime()
      const shown = endedConversation({ ccSessionId: 'codex-thread' })

      expect(skipped(await autoOpenProject(shown))).toContain('Codex')
      expect(projectSessions(ctx, project.id, 'project')).toHaveLength(1)
    })
  })
})
