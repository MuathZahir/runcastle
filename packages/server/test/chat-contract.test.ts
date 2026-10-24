import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { newId, type Feature } from '@runcastle/core'
import { featureDocsRel, sessionDir, worktreeDir } from '@runcastle/core/paths'
import { simpleGit } from 'simple-git'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { toolsForAudience } from '../src/mcp/server'
import type { AppCtx } from '../src/db/types'
import { chatKickoffHeader, launchSession } from '../src/launcher/launcher'
import { runs } from '../src/db/schema'
import { stopAllDocsWatch } from '../src/services/docs-watch'
import { listAfter } from '../src/services/events'
import { createFeatureBranch } from '../src/services/git'
import { useDataDir } from './helpers/data-dir'
import { makeTestCtx } from './helpers/db'
import { rmTemp, seedFeature, seedProject } from './helpers/fixtures'

describe('chat contract', () => {
  it('registers the settled union toolset', () => {
    expect(toolsForAudience('chat').sort()).toEqual([
      'cancel_ticket',
      'create_feature',
      'declare_ready',
      'dispatch_round',
      'emit_tickets',
      'get_feature_context',
      'get_ticket',
      'list_tickets',
      'read_feature_doc',
      'record_event',
      'resolve_finding',
      'show_panel',
      'start_design_server',
      'stop_round',
      'update_ticket',
      'wait_for_you',
    ])
  })

  it('tells the chat the feature status and the rounds run, never a phase or a lap', async () => {
    const ctx = await makeTestCtx()
    const feature = seedFeature(ctx, seedProject(ctx).id, { phase: 'review', lap: 3 })
    ctx.db.insert(runs).values({
      id: newId('run'),
      featureId: feature.id,
      workflow: 'ticket-burner',
      status: 'succeeded',
      startedAt: 1,
      endedAt: 2,
    }).run()
    const line = chatKickoffHeader(ctx, feature)
    expect(line).toContain('Feature status: Talking with you;')
    // The lap column (3 here) no longer moves; the round count is what's told.
    expect(line).toContain('rounds run: 1;')
    expect(line).not.toMatch(/\blap\b|phase|review/i)
    expect(line.endsWith('Call get_feature_context for the full picture.')).toBe(true)
  })

  it('says "Working · Round N" in the kickoff while a round runs', async () => {
    const ctx = await makeTestCtx()
    const feature = seedFeature(ctx, seedProject(ctx).id)
    ctx.db.insert(runs).values({
      id: newId('run'),
      featureId: feature.id,
      workflow: 'ticket-burner',
      status: 'running',
      startedAt: 1,
    }).run()
    expect(chatKickoffHeader(ctx, feature)).toContain('Feature status: Working · Round 1;')
  })

  it('says "Waiting for you · <why>" and "Merged" in the kickoff', async () => {
    const ctx = await makeTestCtx()
    const projectId = seedProject(ctx).id
    const waiting = { ...seedFeature(ctx, projectId, { slug: 'waiting' }), waitingReason: 'start round 1?' }
    const shipped = seedFeature(ctx, projectId, { slug: 'shipped', status: 'shipped' })
    expect(chatKickoffHeader(ctx, waiting)).toContain('Feature status: Waiting for you · start round 1?;')
    expect(chatKickoffHeader(ctx, shipped)).toContain('Feature status: Merged;')
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
    const feature = seedFeature(ctx, projectId, { slug, phase: 'planning' })
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
    const launched = listAfter(ctx, feature.id, 0).find((e) => e.type === 'session.launched')
    return {
      prompt: readFileSync(join(sessionDir(sessionId), 'system-prompt.md'), 'utf8'),
      command: String((launched?.data as { command?: string }).command),
    }
  }

  it('briefs and kicks off a fresh feature and a grilled one alike, on the feature skill', async () => {
    for (const [slug, docs] of [['fresh-chat', []], ['grilled-chat', ['decisions.md', 'spec.md']]] as const) {
      const feature = await planningFeature(slug, [...docs])

      const { prompt, command } = await chatBriefing(feature)

      expect(prompt).toContain('Invoke the `/runcastle:feature` skill')
      expect(prompt).not.toMatch(/runcastle:(ideate|revisit|lead)/)
      expect(command).toContain('Proceed with your task: invoke /runcastle:feature and continue this feature.')
      expect(command).toContain('Feature status: Talking with you;')
      // every chat on a feature runs without permission prompts
      expect(command).toContain('--permission-mode bypassPermissions')
    }
  })
})

