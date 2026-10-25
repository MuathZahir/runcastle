import { rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Feature, SessionRow } from '@runcastle/core'
import { worktreeDir } from '@runcastle/core/paths'
import { simpleGit } from 'simple-git'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
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

describe('the orchestrator’s headless-run tools', () => {
  let ctx: AppCtx
  let repoPath: string
  let projectId: string
  let restoreDataDir: () => void
  const cleanup: string[] = []

  beforeEach(async () => {
    restoreDataDir = withTempDataDir()
    ctx = await makeTestCtx()
    repoPath = await gitRepo()
    projectId = (await openProject(ctx, repoPath)).id
    setRuntimeCtx(ctx)
  })

  afterEach(() => {
    clearRuntimeCtx()
    for (const d of cleanup) rmSync(d, { recursive: true, force: true })
    cleanup.length = 0
    restoreDataDir()
    rmTemp(repoPath)
  })

  /** A live project session — the orchestrator. */
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
  it('send_to_feature reaches the feature’s lead as a human message whatever its state, launching nothing', async () => {
    for (const phase of ['planning', 'building', 'review'] as const) {
      const f = await feature(`led-${phase}`, { phase })
      const result = await toolSendToFeature(ctx, orchestrator(), {
        slug: f.slug,
        message: 'The empty state still says nothing.',
      })

      expect(result).toEqual({ deliveredToLead: true })
      const events = listAfter(ctx, f.id, 0)
      expect(events.some((e) => e.type === 'session.launched')).toBe(false)
      const pending = events.find((e) => e.type === 'lead.message_pending')
      expect(pending?.data).toEqual({
        source: 'human',
        text: "From the project's orchestrator, not the human:\n\nThe empty state still says nothing.",
        sessionId: null,
      })
      expect(getFeatureRow(ctx, f.id).lastHumanMessageAt).toEqual(expect.any(Number))
    }
  })

  it('send_to_feature with relaysHuman marks the message as the human’s relayed answer', async () => {
    const f = await feature('relayed')
    await toolSendToFeature(ctx, orchestrator(), { slug: f.slug, message: 'Yes, go ahead.', relaysHuman: true })
    const pending = listAfter(ctx, f.id, 0).find((e) => e.type === 'lead.message_pending')
    expect((pending?.data as { text: string }).text).toBe(
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
    })
  })

  describe('refuses through the shared gate', () => {
    it('from a session that is not a project session', async () => {
      const f = await feature('humans')
      const chat = createSessionRow(ctx, { featureId: f.id, kind: 'chat', worktreePath: repoPath })
      const call = () => toolSendToFeature(ctx, chat, { slug: 'humans', message: 'x' })
      await expect(call()).rejects.toBeInstanceOf(GateError)
      await expect(call()).rejects.toThrow(/only the orchestrator/)
    })

    it('from a project session that has ended', async () => {
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
