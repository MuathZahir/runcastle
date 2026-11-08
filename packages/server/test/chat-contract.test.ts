import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { newId, type Feature } from '@runcastle/core'
import { featureDocsRel, sessionDir, worktreeDir } from '@runcastle/core/paths'
import { simpleGit } from 'simple-git'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { toolsForAudience } from '../src/mcp/server'
import type { AppCtx } from '../src/db/types'
import { chatKickoffHeader, launchSession } from '../src/launcher/launcher'
import { workers } from '../src/db/schema'
import { stopAllDocsWatch } from '../src/services/docs-watch'
import { createFeatureBranch } from '../src/services/git'
import { useDataDir } from './helpers/data-dir'
import { makeTestCtx } from './helpers/db'
import { rmTemp, seedFeature, seedProject } from './helpers/fixtures'
import { acpLaunchOf, briefOf, kickoffOf } from './support/thread-launch'

describe('chat contract', () => {
  it('registers the settled union toolset', () => {
    expect(toolsForAudience('chat').sort()).toEqual([
      'create_feature',
      'declare_ready',
      'drop_worker',
      'get_feature_context',
      'hand_back',
      'land_worker',
      'message_worker',
      'notify_human',
      'read_feature_doc',
      'record_event',
      'resolve_finding',
      'send_back_worker',
      'set_design_state',
      'show_design',
      'show_file',
      'show_panel',
      'show_plan',
      'show_review_package',
      'start_design_server',
      'start_review',
      'start_worker',
      'wait_for_you',
    ])
  })

  it('tells the chat the feature status, never a phase, a lap or a round', async () => {
    const ctx = await makeTestCtx()
    const feature = seedFeature(ctx, seedProject(ctx).id, {})
    const line = chatKickoffHeader(ctx, feature)
    expect(line).toContain('Feature status: Talking with you.')
    expect(line).not.toMatch(/\blap\b|phase|review|round/i)
    expect(line.endsWith('Call get_feature_context for the full picture.')).toBe(true)
  })

  it('says "Working · N workers at work" in the kickoff while workers work', async () => {
    const ctx = await makeTestCtx()
    const feature = seedFeature(ctx, seedProject(ctx).id)
    const now = Date.now()
    for (const [i, status] of (['working', 'queued'] as const).entries()) {
      ctx.db
        .insert(workers)
        .values({ id: newId('wkr'), featureId: feature.id, label: `w${i}`, purpose: 'p', kind: 'on-its-own', model: 'm', runtime: 'claude-code', startedBy: 'lead', status, engine: 'docker', featureBranch: feature.branch, createdAt: now, updatedAt: now })
        .run()
    }
    expect(chatKickoffHeader(ctx, feature)).toContain('Feature status: Working · 2 workers at work.')
  })

  it('says "Waiting for you · <why>" and "Merged" in the kickoff', async () => {
    const ctx = await makeTestCtx()
    const projectId = seedProject(ctx).id
    const waiting = { ...seedFeature(ctx, projectId, { slug: 'waiting' }), waitingReason: 'start round 1?' }
    const shipped = seedFeature(ctx, projectId, { slug: 'shipped', status: 'shipped' })
    expect(chatKickoffHeader(ctx, waiting)).toContain('Feature status: Waiting for you · start round 1?.')
    expect(chatKickoffHeader(ctx, shipped)).toContain('Feature status: Merged.')
  })
})

/**
 * Every feature chat is the lead from its first message, with one brief and one
 * skill (tickets-and-review-are-tools-not-phases decision 4): what the feature
 * has produced no longer picks the opening. Both renders are asserted here,
 * because a prompt and a kickoff that name different opening skills is the
 * older bug (F2) this codebase already paid for once.
 */
describe('every chat opens on the feature skill', () => {
  let ctx: AppCtx
  let projectId: string
  let repoPath: string
  let restoreDataDir: () => void
  const cleanup: string[] = []

  beforeEach(async () => {
    const home = mkdtempSync(join(tmpdir(), 'runcastle-chat-home-'))
    cleanup.push(home)
    restoreDataDir = useDataDir(home)

    ctx = await makeTestCtx()
    repoPath = mkdtempSync(join(tmpdir(), 'runcastle-chat-repo-'))
    cleanup.push(repoPath)
    const git = simpleGit(repoPath)
    await git.init(['-b', 'main'])
    await git.addConfig('user.email', 'test@runcastle.dev')
    await git.addConfig('user.name', 'Runcastle Test')
    await git.addConfig('core.autocrlf', 'false')
    await git.raw(['commit', '--allow-empty', '-m', 'initial commit'])
    projectId = seedProject(ctx, repoPath).id
  })

  afterEach(() => {
    stopAllDocsWatch()
    restoreDataDir()
    for (const dir of cleanup) rmTemp(dir)
    cleanup.length = 0
  })

  /** A planning feature on a real branch, carrying whichever docs are named. */
  async function planningFeature(slug: string, docs: string[]): Promise<Feature> {
    const feature = seedFeature(ctx, projectId, { slug })
    const docsDir = join(repoPath, ...featureDocsRel(slug).split('/'))
    mkdirSync(docsDir, { recursive: true })
    for (const doc of ['brief.md', ...docs]) {
      writeFileSync(join(docsDir, doc), `# ${doc}\n`, 'utf8')
    }
    const git = simpleGit(repoPath)
    await git.add('.')
    await git.commit(`scaffold docs for ${slug}`)
    await createFeatureBranch({ id: projectId, name: 't', repoPath }, slug, 'main')
    cleanup.push(worktreeDir(projectId, slug))
    return feature
  }

  /** Launch the chat without a terminal, and read back what it was briefed with. */
  async function chatBriefing(feature: Feature): Promise<{ prompt: string; command: string }> {
    const { sessionId } = await launchSession(
      ctx,
      { featureId: feature.id, kind: 'chat' },
      { spawn: false },
    )
    cleanup.push(sessionDir(sessionId))
    return { prompt: await briefOf(ctx, sessionId), kickoff: kickoffOf(sessionId), launch: await acpLaunchOf(ctx, sessionId) }
  }

  it('briefs and kicks off a fresh feature and a grilled one alike, on the feature skill', async () => {
    for (const [slug, docs] of [['fresh-chat', []], ['grilled-chat', ['decisions.md', 'spec.md']]] as const) {
      const feature = await planningFeature(slug, [...docs])

      const { prompt, kickoff, launch } = await chatBriefing(feature)

      expect(prompt).toContain('Invoke the `/runcastle:feature` skill')
      expect(prompt).not.toMatch(/runcastle:(ideate|revisit|lead)/)
      expect(kickoff).toContain('Proceed with your task: invoke /runcastle:feature and continue this feature.')
      expect(kickoff).toContain('Feature status: Talking with you.')
      // every chat on a feature runs without permission prompts
      expect(launch.sessionMode).toBe('bypassPermissions')
    }
  })
})

