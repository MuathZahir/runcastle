import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Feature, Phase } from '@runcastle/core'
import { featureDocsRel, sessionDir, worktreeDir } from '@runcastle/core/paths'
import { simpleGit } from 'simple-git'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AppCtx } from '../src/db/types'
import { launchSession } from '../src/launcher/launcher'
import { createSessionRow, markSessionLive } from '../src/launcher/sessions'
import { claudeRuntime } from '../src/launcher/runtimes/claude'
import { stopAllDocsWatch } from '../src/services/docs-watch'
import { listAfter } from '../src/services/events'
import { createFeatureBranch } from '../src/services/git'
import { listSessionsByFeature } from '../src/services/repo'
import { createAgentHost, setAgentHostForTests } from '../src/threads/host'
import { threadLifecycle } from '../src/threads/lifecycle'
import type { AgentHost } from '../src/threads/types'
import { useDataDir } from './helpers/data-dir'
import { makeTestCtx } from './helpers/db'
import { rmTemp, seedFeature, seedProject } from './helpers/fixtures'
import { createFakeAcp, FAKE_LAUNCH, type FakeAcp } from './support/fake-acp-agent'
import { promptsOf } from './support/thread-launch'

/**
 * The Chat door on a chat that is already open (`one-chat-per-feature`
 * decision 12; chat-as-web-components decision 7). The door is constant in
 * all four states and never disabled, so the one thing it must never do is
 * throw: clicking it again answers with the feature's one main-chat thread.
 * Nothing is created a second time, and a briefing the door brings is said
 * into that thread.
 */
describe('the Chat door on an open chat', () => {
  let ctx: AppCtx
  let projectId: string
  let repoPath: string
  let restoreDataDir: () => void
  let host: AgentHost | undefined
  const cleanup: string[] = []

  beforeEach(async () => {
    const home = mkdtempSync(join(tmpdir(), 'runcastle-chat-door-home-'))
    cleanup.push(home)
    restoreDataDir = useDataDir(home)

    ctx = await makeTestCtx()
    repoPath = mkdtempSync(join(tmpdir(), 'runcastle-chat-door-repo-'))
    cleanup.push(repoPath)
    const git = simpleGit(repoPath)
    await git.init(['-b', 'main'])
    await git.addConfig('user.email', 'test@runcastle.dev')
    await git.addConfig('user.name', 'Runcastle Test')
    await git.addConfig('core.autocrlf', 'false')
    await git.raw(['commit', '--allow-empty', '-m', 'initial commit'])
    projectId = seedProject(ctx, repoPath).id
  })

  afterEach(async () => {
    await host?.stopAll('shutdown')
    setAgentHostForTests(undefined)
    vi.restoreAllMocks()
    stopAllDocsWatch()
    restoreDataDir()
    for (const dir of cleanup) rmTemp(dir)
    cleanup.length = 0
  })

  /** A feature on a real branch, in whichever state the door is clicked from. */
  async function featureIn(phase: Phase, slug: string): Promise<Feature> {
    const feature = seedFeature(ctx, projectId, { slug, phase })
    const docsDir = join(repoPath, ...featureDocsRel(slug).split('/'))
    mkdirSync(docsDir, { recursive: true })
    writeFileSync(join(docsDir, 'brief.md'), '# brief.md\n', 'utf8')
    const git = simpleGit(repoPath)
    await git.add('.')
    await git.commit(`scaffold docs for ${slug}`)
    await createFeatureBranch({ id: projectId, name: 't', repoPath }, slug, 'main')
    cleanup.push(worktreeDir(projectId, slug))
    return feature
  }

  /** Open the chat without a terminal and mark it live, as a real spawn would. */
  async function openChat(feature: Feature): Promise<string> {
    const { sessionId } = await launchSession(
      ctx,
      { featureId: feature.id, kind: 'chat' },
      { spawn: false },
    )
    cleanup.push(sessionDir(sessionId))
    markSessionLive(ctx, sessionId, { ccSessionId: `cc-${sessionId}` })
    return sessionId
  }

  /** A fake agent behind the host, with the lifecycle's fresh state header, past the readiness gate. */
  function fakeHost(): { host: AgentHost; fake: FakeAcp } {
    vi.spyOn(claudeRuntime, 'checkReady').mockReturnValue({ ok: true })
    const fake = createFakeAcp()
    host = createAgentHost({ ctx, transport: fake.transport, launch: FAKE_LAUNCH, lifecycle: threadLifecycle(ctx) })
    setAgentHostForTests(host)
    return { host, fake }
  }

  it('gives two opens at once one chat and one briefing', async () => {
    const { fake } = fakeHost()
    const feature = await featureIn('ideate', 'two-tabs')
    const [first, second] = await Promise.all([
      launchSession(ctx, { featureId: feature.id, kind: 'chat' }),
      launchSession(ctx, { featureId: feature.id, kind: 'chat' }),
    ])
    cleanup.push(sessionDir(first.sessionId))
    expect(second.sessionId).toBe(first.sessionId)
    expect(listSessionsByFeature(ctx, feature.id).filter((s) => s.kind === 'chat')).toHaveLength(1)
    await vi.waitFor(() => expect(sentToAgent(fake)).toHaveLength(1))
  })

  /** The text of each `session/prompt` the agent received. */
  function sentToAgent(fake: FakeAcp): string[] {
    return fake.processes.flatMap((p) =>
      p.received
        .filter((r) => r.method === 'session/prompt')
        .map((r) => ((r.params as { prompt: { text?: string }[] }).prompt[0]?.text ?? '')),
    )
  }

  function kickoffs(featureId: string): { data: Record<string, unknown> | null }[] {
    return listAfter(ctx, featureId, 0).filter((e) => e.type === 'session.kickoff')
  }

  it('answers with the main thread instead of opening a second one', async () => {
    const feature = await featureIn('planning', 'live-chat')
    const first = await openChat(feature)

    const again = await launchSession(
      ctx,
      { featureId: feature.id, kind: 'chat' },
      { spawn: false },
    )

    expect(again.sessionId).toBe(first)
    expect(listSessionsByFeature(ctx, feature.id).map((s) => s.id)).toEqual([first])
  })

  it('answers the same way from review', async () => {
    const feature = await featureIn('review', 'review-chat')
    const first = await openChat(feature)

    const again = await launchSession(
      ctx,
      { featureId: feature.id, kind: 'chat' },
      { spawn: false },
    )

    expect(again.sessionId).toBe(first)
    expect(listSessionsByFeature(ctx, feature.id).map((s) => s.id)).toEqual([first])
  })

  // One main chat thread per feature; other threads run beside it.
  it('opens the main chat beside a Fix-it thread', async () => {
    const feature = await featureIn('planning', 'drive-fix-chat')
    const driveFix = createSessionRow(ctx, {
      featureId: feature.id,
      kind: 'drive-fix',
      worktreePath: worktreeDir(projectId, feature.slug),
    })
    markSessionLive(ctx, driveFix.id, { ccSessionId: 'cc-drive-fix' })

    const { sessionId } = await launchSession(ctx, { featureId: feature.id, kind: 'chat' }, { spawn: false })
    cleanup.push(sessionDir(sessionId))

    expect(sessionId).not.toBe(driveFix.id)
  })

  /**
   * Decision 13: a purpose-specific briefing rides the conversation it is
   * headed for — resolve-conflict, stop-drive-and-iterate and a lap briefing
   * each say the reason the human opened it, queued to a running turn's end.
   */
  it('says a purpose-specific briefing into the running conversation, with the feature’s state', async () => {
    const feature = await featureIn('review', 'briefed-chat')
    const first = await openChat(feature)
    const { host, fake } = fakeHost()
    await host.prompt(first, { text: 'hello' }, { source: 'human' })

    const again = await launchSession(ctx, { featureId: feature.id, kind: 'chat', kickoffLine: 'OVERRIDE' })

    expect(again.sessionId).toBe(first)
    // Queued behind the running turn, it is logged as it is sent.
    await vi.waitFor(() => expect(sentToAgent(fake)).toHaveLength(2))
    const said = promptsOf(first).map((p) => p.text)
    expect(said.at(-1)?.startsWith('[runcastle] OVERRIDE ')).toBe(true)
    expect(said.at(-1)).toContain('Feature status:')
    expect(kickoffs(feature.id).at(-1)?.data).toMatchObject({
      sessionId: first,
      kind: 'chat',
      line: said.at(-1),
      mechanism: 'prompt',
    })
  })

  it('starts an idle conversation with the briefing, the host handing it the fresh state', async () => {
    const feature = await featureIn('review', 'idle-chat')
    const first = await openChat(feature)
    const { fake } = fakeHost()

    await launchSession(ctx, { featureId: feature.id, kind: 'chat', kickoffLine: 'OVERRIDE' })

    expect(promptsOf(first).at(-1)?.text).toBe('[runcastle] OVERRIDE')
    await vi.waitFor(() => expect(sentToAgent(fake)).toHaveLength(1))
    expect(sentToAgent(fake)[0]).toMatch(/^\[runcastle\] OVERRIDE\n\n.*Feature status:/s)
  })

  // Start lap retired with laps: a `start-lap` launch is a plain Chat open.
  it('says nothing for a start-lap launch, as a plain open', async () => {
    const feature = await featureIn('review', 'start-lap-chat')
    const first = await openChat(feature)
    const before = promptsOf(first).length

    const again = await launchSession(
      ctx,
      { featureId: feature.id, kind: 'chat', purpose: 'start-lap' },
      { spawn: false },
    )

    expect(again.sessionId).toBe(first)
    expect(promptsOf(first)).toHaveLength(before)
  })

  it('says nothing into a conversation the door merely returns to', async () => {
    const feature = await featureIn('shipped', 'quiet-chat')
    const first = await openChat(feature)
    const before = promptsOf(first).length

    const again = await launchSession(ctx, { featureId: feature.id, kind: 'chat' }, { spawn: false })

    expect(again.sessionId).toBe(first)
    expect(promptsOf(first)).toHaveLength(before)
    expect(kickoffs(feature.id)).toEqual([])
  })
})
