import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Feature } from '@runcastle/core'
import { featureDocsRel, sessionDir, worktreeDir } from '@runcastle/core/paths'
import { simpleGit } from 'simple-git'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { toolsForAudience } from '../src/mcp/server'
import type { AppCtx } from '../src/db/types'
import { chatKickoffHeader, launchSession } from '../src/launcher/launcher'
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
      'complete_phase',
      'create_feature',
      'emit_tickets',
      'emit_waypoints',
      'escalate_to_map',
      'get_feature_context',
      'list_tickets',
      'read_feature_doc',
      'record_event',
      'resolve_finding',
      'resolve_waypoint',
      'update_ticket',
    ])
  })

  it('briefs state, lap, tickets, run, and the full-context handoff', async () => {
    const ctx = await makeTestCtx()
    const feature = seedFeature(ctx, seedProject(ctx).id, { phase: 'review', lap: 3 })
    const line = chatKickoffHeader(ctx, feature)
    expect(line).toContain('Feature state: review')
    expect(line).toContain('lap 3')
    expect(line).toContain('tickets: none')
    expect(line).toContain('latest run: none')
    expect(line).toContain('Drive outcome: review; see the review evidence')
    expect(line.endsWith('Call get_feature_context for the full picture.')).toBe(true)
  })
})

/**
 * Which opening move the one chat is briefed with.
 *
 * The collapsed kind was mapped straight onto the revisit brief and the revisit
 * skill, so the only door into a brand-new feature handed it the
 * amend-an-existing-record contract — including "Do NOT call `complete_phase`" —
 * and the front of the pipeline had no instructed path to its own first
 * decisions, spec and tickets. Both renders are asserted here, because a prompt
 * and a kickoff that name different opening skills is the older bug (F2) this
 * codebase already paid for once.
 */
describe('the one chat opens on the move its state calls for', () => {
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

  it('sends a feature with no decisions, spec or tickets to ideation', async () => {
    const feature = await planningFeature('fresh-chat', [])

    const { prompt, command } = await chatBriefing(feature)

    expect(prompt).toContain('/runcastle:ideate')
    expect(prompt).not.toContain('/runcastle:revisit')
    // the ideation contract, not the amend-a-record one
    expect(prompt).toContain('complete_phase')
    expect(prompt).not.toContain('a revisit never moves the pipeline')
    expect(command).toContain('/runcastle:ideate')
    expect(command).not.toContain('/runcastle:revisit')
  })

  it('sends a feature that has already been grilled to a revisit', async () => {
    const feature = await planningFeature('grilled-chat', ['decisions.md'])

    const { prompt, command } = await chatBriefing(feature)

    expect(prompt).toContain('/runcastle:revisit')
    expect(prompt).not.toContain('/runcastle:ideate')
    expect(command).toContain('/runcastle:revisit')
  })
})
