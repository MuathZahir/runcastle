import { rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Feature, SessionRow } from '@runcastle/core'
import { worktreeDir } from '@runcastle/core/paths'
import { simpleGit } from 'simple-git'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AppCtx } from '../src/db/types'
import { GateError } from '../src/errors'
import { clearRuntimeCtx, setRuntimeCtx } from '../src/launcher/runtime'
import { createSessionRow, getSessionRow, markSessionEnded, markSessionLive } from '../src/launcher/sessions'
import { toolReadFeatureChat, toolSendToFeature } from '../src/mcp/orchestrator-run-tools'
import { humanTypedAt, markHumanMessage } from '../src/services/lead-status'
import { getFeatureRow } from '../src/services/repo'
import { listAfter } from '../src/services/events'
import { createFeatureBranch } from '../src/services/git'
import { openProject } from '../src/services/projects'
import { withTempDataDir } from './helpers/data-dir'
import { makeTestCtx } from './helpers/db'
import { rmTemp, seedFeature, tmpRepo } from './helpers/fixtures'
import { claudeRuntime } from '../src/launcher/runtimes/claude'
import { createAgentHost, setAgentHostForTests } from '../src/threads/host'
import type { AgentHost } from '../src/threads/types'
import { createFakeAcp, FAKE_LAUNCH } from './support/fake-acp-agent'
import { promptsOf } from './support/thread-launch'

/**
 * `send_to_feature` (`whole-cuts-plan-themselves`, `the-feature-lead-runs-rounds`,
 * "Headless runs on a feature", `one-orchestrator-no-mode`): it reaches the
 * lead of any feature of the project, and refuses through the shared gate.
 */

async function gitRepo(): Promise<string> {
  const dir = tmpRepo()
  const g = simpleGit(dir)
  await g.init(['-b', 'main'])
  await g.addConfig('user.email', 'test@runcastle.dev')
  await g.addConfig('user.name', 'Runcastle Test')
  writeFileSync(join(dir, 'README.md'), 'base\n')
  await g.add(['README.md'])
  await g.commit('initial commit')
  return dir
}

describe('the orchestrator’s tools on a feature’s lead', () => {
  let ctx: AppCtx
  let repoPath: string
  let projectId: string
  let restoreDataDir: () => void
  let host: AgentHost
  const cleanup: string[] = []

  beforeEach(async () => {
    restoreDataDir = withTempDataDir()
    ctx = await makeTestCtx()
    repoPath = await gitRepo()
    projectId = (await openProject(ctx, repoPath)).id
    setRuntimeCtx(ctx)
    vi.spyOn(claudeRuntime, 'checkReady').mockReturnValue({ ok: true })
    host = createAgentHost({ ctx, transport: createFakeAcp().transport, launch: FAKE_LAUNCH })
    setAgentHostForTests(host)
  })

  afterEach(async () => {
    await host.stopAll('shutdown')
    setAgentHostForTests(undefined)
    vi.restoreAllMocks()
    clearRuntimeCtx()
    for (const d of cleanup) rmSync(d, { recursive: true, force: true })
    cleanup.length = 0
    restoreDataDir()
    rmTemp(repoPath)
  })

  /** A live orchestrator — the orchestrator. */
  function orchestrator(): SessionRow {
    const row = createSessionRow(ctx, { projectId, kind: 'project', worktreePath: repoPath })
    markSessionLive(ctx, row.id, { ccSessionId: `cc-${row.id}` })
    return getSessionRow(ctx, row.id) as SessionRow
  }

  /** A started feature the orchestrator did not create. */
  async function feature(slug: string, overrides: Partial<Feature> = {}): Promise<Feature> {
    const f = seedFeature(ctx, projectId, { slug, ...overrides })
    await createFeatureBranch({ id: projectId, name: 't', repoPath }, slug, 'main')
    cleanup.push(worktreeDir(projectId, slug))
    return f
  }

  /**
   * Every chat on a feature is its lead: the orchestrator's message reaches it
   * as the human's would, through the one lead-delivery path, and counts as a
   * human message — whatever the feature's state, with no planning relay.
   */
  it('send_to_feature reaches the feature’s lead as a human message whatever its state, starting its chat', async () => {
    for (const phase of ['planning', 'building', 'review'] as const) {
      const f = await feature(`led-${phase}`, { phase })
      const result = await toolSendToFeature(ctx, orchestrator(), {
        slug: f.slug,
        message: 'The empty state still says nothing.',
      })

      expect(result).toEqual({ deliveredToLead: true })
      const queued = listAfter(ctx, f.id, 0).find((e) => e.type === 'lead.message_queued')
      expect(queued?.data).toMatchObject({
        source: 'human',
        route: 'prompt',
        text: "From the project's orchestrator, not the human:\n\nThe empty state still says nothing.",
      })
      const thread = (queued?.data as { sessionId: string }).sessionId
      expect(getSessionRow(ctx, thread)?.kind).toBe('chat')
      expect(promptsOf(thread).at(-1)?.text).toBe(
        "[runcastle] From the project's orchestrator, not the human:\n\nThe empty state still says nothing.",
      )
      expect(getFeatureRow(ctx, f.id).lastHumanMessageAt).toEqual(expect.any(Number))
    }
  })

  it('send_to_feature with relaysHuman marks the message as the human’s relayed answer', async () => {
    const f = await feature('relayed')
    await toolSendToFeature(ctx, orchestrator(), { slug: f.slug, message: 'Yes, go ahead.', relaysHuman: true })
    const queued = listAfter(ctx, f.id, 0).find((e) => e.type === 'lead.message_queued')
    expect((queued?.data as { text: string }).text).toBe(
      "The human's own answer, relayed by the project's orchestrator:\n\nYes, go ahead.",
    )
  })

  it('send_to_feature is not a typed human message, a typed prompt is', async () => {
    const f = await feature('typed')
    await toolSendToFeature(ctx, orchestrator(), { slug: f.slug, message: 'x' })
    expect(humanTypedAt(ctx, f.id)).toBeNull()
    markHumanMessage(ctx, f.id, { typed: true })
    expect(humanTypedAt(ctx, f.id)).toEqual(expect.any(Number))
  })

  it('read_feature_chat gives a null quote with a reason when the feature has no chat', async () => {
    const f = await feature('quiet')
    expect(toolReadFeatureChat(ctx, orchestrator(), { slug: f.slug })).toEqual({
      slug: 'quiet',
      quote: null,
      transcriptPath: null,
      reason: 'no chat on disk yet',
      shown: [],
      reviewShots: [],
    })
  })

  describe('read_feature_chat from where this thread left off', () => {
    const line = (role: 'user' | 'assistant', text: string): string =>
      JSON.stringify({ type: role, message: { content: text } })

    function writeTranscript(name: string, turns: Array<['user' | 'assistant', string]>): string {
      const path = join(repoPath, `${name}.jsonl`)
      writeFileSync(path, `${turns.map(([r, t]) => line(r, t)).join('\n')}\n`)
      return path
    }

    async function chatting(slug: string, path: string): Promise<Feature> {
      const f = await feature(slug)
      const chat = createSessionRow(ctx, { featureId: f.id, kind: 'chat', worktreePath: repoPath })
      markSessionLive(ctx, chat.id, { transcriptPath: path })
      return f
    }

    it('returns only the turns added since the last read, and says when nothing is new', async () => {
      const path = writeTranscript('chat', [
        ['user', 'make the cache hourly'],
        ['assistant', 'done, it expires hourly'],
      ])
      const f = await chatting('talking', path)
      const me = orchestrator()

      const first = toolReadFeatureChat(ctx, me, { slug: f.slug })
      expect(first.quote).toBe('Human: make the cache hourly\n\nAssistant: done, it expires hourly')

      expect(toolReadFeatureChat(ctx, me, { slug: f.slug })).toMatchObject({
        quote: null,
        transcriptPath: path,
        reason: 'nothing new since your last read',
        shown: [],
        reviewShots: [],
      })

      writeTranscript('chat', [
        ['user', 'make the cache hourly'],
        ['assistant', 'done, it expires hourly'],
        ['assistant', 'should it also expire on deploy?'],
      ])
      const next = toolReadFeatureChat(ctx, me, { slug: f.slug })
      expect(next).toMatchObject({ quote: 'Assistant: should it also expire on deploy?', earlierNewTurnsOmitted: 0 })
      expect(next).not.toHaveProperty('reason')

      // `full` reads as the first read did; another thread starts from scratch.
      expect(toolReadFeatureChat(ctx, me, { slug: f.slug, full: true }).quote).toContain('make the cache hourly')
      expect(toolReadFeatureChat(ctx, orchestrator(), { slug: f.slug }).quote).toContain('make the cache hourly')
    })

    it('reads a different transcript as a new chat', async () => {
      const f = await chatting('cleared', writeTranscript('before', [['user', 'old talk about pears']]))
      const me = orchestrator()
      toolReadFeatureChat(ctx, me, { slug: f.slug })

      const chat = createSessionRow(ctx, { featureId: f.id, kind: 'chat', worktreePath: repoPath })
      markSessionLive(ctx, chat.id, { transcriptPath: writeTranscript('after', [['user', 'new talk about plums']]) })
      expect(toolReadFeatureChat(ctx, me, { slug: f.slug }).quote).toBe('Human: new talk about plums')
    })

    it('counts the new turns the cap left out', async () => {
      const long = 'x'.repeat(2_000)
      const path = writeTranscript('long', [['user', 'start']])
      const f = await chatting('long', path)
      const me = orchestrator()
      toolReadFeatureChat(ctx, me, { slug: f.slug })
      writeTranscript('long', [['user', 'start'], ...Array.from({ length: 6 }, (): ['assistant', string] => ['assistant', long])])
      const out = toolReadFeatureChat(ctx, me, { slug: f.slug })
      // 8k of quote holds three 2k turns; the three older new ones are counted, not sent.
      expect(out.earlierNewTurnsOmitted).toBe(3)
      expect(out.quote?.split('\n\n')).toHaveLength(3)
    })
  })

  describe('refuses through the shared gate', () => {
    it('from a session that is not an orchestrator', async () => {
      const f = await feature('humans')
      const chat = createSessionRow(ctx, { featureId: f.id, kind: 'chat', worktreePath: repoPath })
      const call = () => toolSendToFeature(ctx, chat, { slug: 'humans', message: 'x' })
      await expect(call()).rejects.toBeInstanceOf(GateError)
      await expect(call()).rejects.toThrow(/only the orchestrator/)
    })

    it('from an orchestrator that has ended', async () => {
      await feature('stopped')
      const session = orchestrator()
      markSessionEnded(ctx, session.id)
      const ended = getSessionRow(ctx, session.id) as SessionRow
      await expect(
        toolSendToFeature(ctx, ended, { slug: 'stopped', message: 'x' }),
      ).rejects.toThrow(/has ended/)
    })
  })
})
