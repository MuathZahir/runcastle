import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { featureDocsRel, sessionDir, worktreeDir } from '@runcastle/core/paths'
import { simpleGit } from 'simple-git'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Feature } from '@runcastle/core'
import type { AppCtx } from '../src/db/types'
import { launchSession } from '../src/launcher/launcher'
import { claudeRuntime } from '../src/launcher/runtimes/claude'
import { stopAllDocsWatch } from '../src/services/docs-watch'
import { listAfter } from '../src/services/events'
import { createFeatureBranch } from '../src/services/git'
import { createAgentHost, setAgentHostForTests } from '../src/threads/host'
import type { AgentHost } from '../src/threads/types'
import { useDataDir } from './helpers/data-dir'
import { makeTestCtx } from './helpers/db'
import { rmTemp, seedFeature, seedProject } from './helpers/fixtures'
import { createFakeAcp, FAKE_LAUNCH } from './support/fake-acp-agent'
import { promptsOf } from './support/thread-launch'

/**
 * `session.kickoff` is the record that an agent was handed its briefing, and
 * the briefing is the thread's first prompt (ADR-0015) — so the event belongs
 * to the agent host taking the prompt, never to composing it. It is not
 * claimed for the `spawn:false` smoke driver (no agent at all) nor for a
 * prompt the host refused.
 */
describe('session.kickoff — emitted once the host took the prompt, never before', () => {
  let ctx: AppCtx
  let projectId: string
  let repoPath: string
  let restoreDataDir: () => void
  const cleanup: string[] = []

  beforeEach(async () => {
    const home = mkdtempSync(join(tmpdir(), 'runcastle-kickoff-home-'))
    cleanup.push(home)
    restoreDataDir = useDataDir(home)

    ctx = await makeTestCtx()
    repoPath = mkdtempSync(join(tmpdir(), 'runcastle-kickoff-repo-'))
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
    setAgentHostForTests(undefined)
    vi.restoreAllMocks()
    stopAllDocsWatch()
    restoreDataDir()
    for (const dir of cleanup) rmTemp(dir)
    cleanup.length = 0
  })

  /** A feature with its docs committed on a real branch + talk worktree. */
  async function featureWithWorktree(slug: string): Promise<Feature> {
    const feature = seedFeature(ctx, projectId, { slug })
    const docsSegments = featureDocsRel(slug).split('/')
    mkdirSync(join(repoPath, ...docsSegments), { recursive: true })
    writeFileSync(join(repoPath, ...docsSegments, 'brief.md'), '# brief\n', 'utf8')
    const git = simpleGit(repoPath)
    await git.add('.')
    await git.commit(`scaffold docs for ${slug}`)
    await createFeatureBranch({ id: projectId, name: 't', repoPath }, slug, 'main')
    cleanup.push(worktreeDir(projectId, slug))
    return feature
  }

  /** Put a fake agent behind the host, past the readiness gate. */
  function fakeHost(): AgentHost {
    vi.spyOn(claudeRuntime, 'checkReady').mockReturnValue({ ok: true })
    const host = createAgentHost({ ctx, transport: createFakeAcp().transport, launch: FAKE_LAUNCH })
    setAgentHostForTests(host)
    return host
  }

  function kickoffs(featureId: string): { data: Record<string, unknown> | null }[] {
    return listAfter(ctx, featureId, 0).filter((e) => e.type === 'session.kickoff')
  }

  it('records the briefing once the agent host has taken it', async () => {
    const feature = await featureWithWorktree('spawned')
    const host = fakeHost()

    const { sessionId } = await launchSession(ctx, { featureId: feature.id, kind: 'chat' })
    cleanup.push(sessionDir(sessionId))

    expect(kickoffs(feature.id)).toHaveLength(1)
    const recorded = kickoffs(feature.id)[0]?.data
    expect(recorded).toMatchObject({ sessionId, kind: 'chat', mechanism: 'prompt' })
    // what was recorded is the composed chat briefing: the opening this feature's
    // state calls for (nothing on disk yet, so ideation), then the state header
    expect(recorded?.line).toContain('/runcastle:feature')
    expect(recorded?.line).toContain('Feature status: Talking with you')
    expect(promptsOf(sessionId)[0].text).toBe(recorded?.line)
    await host.stopAll('shutdown')
  })

  it('records nothing for a smoke launch, which starts no agent to brief', async () => {
    const feature = await featureWithWorktree('smoke')

    const { sessionId } = await launchSession(
      ctx,
      { featureId: feature.id, kind: 'chat' },
      { spawn: false },
    )
    cleanup.push(sessionDir(sessionId))

    expect(promptsOf(sessionId)).toHaveLength(1)
    expect(kickoffs(feature.id)).toHaveLength(0)
  })

  it('records nothing when the host refuses the prompt', async () => {
    const feature = await featureWithWorktree('stillborn')
    const host = fakeHost()
    setAgentHostForTests({
      ...host,
      prompt: async () => {
        throw new Error('no agent here')
      },
    })

    await expect(launchSession(ctx, { featureId: feature.id, kind: 'chat' })).rejects.toThrow('no agent here')

    expect(kickoffs(feature.id)).toHaveLength(0)
  })
})
