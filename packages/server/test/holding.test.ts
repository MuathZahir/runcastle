import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Feature, SessionRow, ThreadEvent } from '@runcastle/core'
import { eq } from 'drizzle-orm'
import { simpleGit } from 'simple-git'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { events, sessions } from '../src/db/schema'
import type { AppCtx } from '../src/db/types'
import { launchProjectSession } from '../src/launcher/launcher'
import {
  createSessionRow,
  getSessionRow,
  markSessionEnded,
  markSessionLive,
  setSessionTitle,
} from '../src/launcher/sessions'
import { toolReadFeatureChat, toolSendToFeature } from '../src/mcp/orchestrator-run-tools'
import {
  toolAddToBrief,
  toolDrive,
  toolMergeFeature,
  toolPlanFeature,
  toolStartFeature,
  toolStopFeatureRun,
  toolTakeFeature,
} from '../src/mcp/orchestrator-tools'
import {
  featureContext,
  projectFeatureReader,
  toolCreateFeature,
  toolGetProjectContext,
  toolSetFeatureDependencies,
} from '../src/mcp/server'
import { emit, listByProject, listAfter, runAsActor } from '../src/services/events'
import { HOLDERS_SWEPT, inheritHolds, sweepHolders } from '../src/services/holding'
import { openProject } from '../src/services/projects'
import { getFeatureRow } from '../src/services/repo'
import { seedThreadLog } from '../src/threads/log'
import { withTempDataDir } from './helpers/data-dir'
import { makeTestCtx } from './helpers/db'
import { rmTemp, seedFeature, tmpRepo } from './helpers/fixtures'

/**
 * `threads-hold-features`: one thread holds a feature, a second thread is refused
 * until it takes it, reads are free, and features in flight get their real holder
 * once. What the holder hears is in orchestrator-notify.test.ts.
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

describe('threads hold features', () => {
  let ctx: AppCtx
  let repoPath: string
  let projectId: string
  let restoreDataDir: () => void

  beforeEach(async () => {
    restoreDataDir = withTempDataDir()
    ctx = await makeTestCtx()
    repoPath = await gitRepo()
    projectId = (await openProject(ctx, repoPath)).id
  })

  afterEach(() => {
    restoreDataDir()
    rmTemp(repoPath)
  })

  function thread(name: string): SessionRow {
    const row = createSessionRow(ctx, { projectId, kind: 'project', worktreePath: repoPath })
    markSessionLive(ctx, row.id, { ccSessionId: `cc-${row.id}` })
    setSessionTitle(ctx, row.id, name)
    return getSessionRow(ctx, row.id) as SessionRow
  }

  const holderOfSlug = (feature: Feature): string | undefined => getFeatureRow(ctx, feature.id).heldBy

  const typesOn = (feature: Feature): string[] => listAfter(ctx, feature.id, 0).map((e) => e.type)

  describe('acting', () => {
    it('gives a feature nobody holds to the first thread that acts on it', async () => {
      const a = thread('A')
      const feature = seedFeature(ctx, projectId, { slug: 'free', status: 'draft' })

      await toolAddToBrief(ctx, a, { slug: 'free', text: 'more' })

      expect(holderOfSlug(feature)).toBe(a.id)
      expect(listAfter(ctx, feature.id, 0).find((e) => e.type === 'feature.held')?.message).toBe('held by the thread "A"')
    })

    it('lets the holder act again without a second timeline line', async () => {
      const a = thread('A')
      const feature = seedFeature(ctx, projectId, { slug: 'mine', status: 'draft', heldBy: a.id })

      await toolAddToBrief(ctx, a, { slug: 'mine', text: 'more' })

      expect(typesOn(feature)).not.toContain('feature.held')
    })

    it('refuses every acting tool on a feature another thread holds, naming that thread', async () => {
      const a = thread('Burn cut')
      const b = thread('B')
      const held = seedFeature(ctx, projectId, { slug: 'held', heldBy: a.id })
      const calls: [string, () => unknown][] = [
        ['start_feature', () => toolStartFeature(ctx, b, { slug: 'held' })],
        ['plan_feature', () => toolPlanFeature(ctx, b, { slug: 'held' })],
        ['send_to_feature', () => toolSendToFeature(ctx, b, { slug: 'held', message: 'hi' })],
        ['stop_feature_run', () => toolStopFeatureRun(ctx, b, { slug: 'held' })],
        ['drive', () => toolDrive(ctx, b, { slug: 'held', action: 'start' })],
        ['merge_feature', () => toolMergeFeature(ctx, b, { slug: 'held' })],
        ['add_to_brief', () => toolAddToBrief(ctx, b, { slug: 'held', text: 'x' })],
        ['set_feature_dependencies', () => toolSetFeatureDependencies(ctx, b, { slug: 'held', dependsOn: [] })],
      ]
      for (const [name, call] of calls) {
        await expect((async () => call())(), name).rejects.toThrow(/`held` is held by the thread "Burn cut"/)
      }
      expect(holderOfSlug(held)).toBe(a.id)
    })

    it('guards only the draft being reordered, not the features it names', () => {
      const a = thread('A')
      const b = thread('B')
      const dep = seedFeature(ctx, projectId, { slug: 'dep', heldBy: a.id })
      const draft = seedFeature(ctx, projectId, { slug: 'draft', status: 'draft' })

      toolSetFeatureDependencies(ctx, b, { slug: 'draft', dependsOn: ['dep'] })

      expect(holderOfSlug(draft)).toBe(b.id)
      expect(holderOfSlug(dep)).toBe(a.id)
    })

    it('neither holds nor refuses on a read', () => {
      const a = thread('A')
      const b = thread('B')
      const free = seedFeature(ctx, projectId, { slug: 'free' })
      seedFeature(ctx, projectId, { slug: 'held', heldBy: a.id })

      toolReadFeatureChat(ctx, b, { slug: 'free' })
      toolReadFeatureChat(ctx, b, { slug: 'held' })
      featureContext(ctx, projectFeatureReader(ctx, b, 'held'))

      expect(holderOfSlug(free)).toBeUndefined()
    })

    it('leaves a drive of the base branch alone: it touches no feature', async () => {
      const a = thread('A')
      seedFeature(ctx, projectId, { slug: 'held', heldBy: a.id })
      await expect(toolDrive(ctx, thread('B'), { action: 'stop' })).resolves.toBeDefined()
    })

    it('does not make a thread the holder of a shipped feature', async () => {
      const feature = seedFeature(ctx, projectId, { slug: 'old', status: 'shipped' })
      await expect(toolMergeFeature(ctx, thread('A'), { slug: 'old' })).rejects.toThrow()
      expect(holderOfSlug(feature)).toBeUndefined()
    })
  })

  describe('creating', () => {
    it('makes a project thread the holder of what it creates, started or parked', async () => {
      const a = thread('A')
      const started = await toolCreateFeature(ctx, a, { title: 'Login form', oneLiner: 'log in' })
      const parked = await toolCreateFeature(ctx, a, { title: 'Later', oneLiner: 'later', draft: true, brief: 'b' })

      expect(getFeatureRow(ctx, started.id).heldBy).toBe(a.id)
      expect(getFeatureRow(ctx, parked.id).heldBy).toBe(a.id)
    })

    it('leaves a draft a feature’s agent parks to the human', async () => {
      const lead = seedFeature(ctx, projectId, { slug: 'lead' })
      const chat = createSessionRow(ctx, { featureId: lead.id, kind: 'chat', worktreePath: repoPath })

      const parked = await toolCreateFeature(ctx, chat, { title: 'Parked', oneLiner: 'p', draft: true, brief: 'b' })

      expect(getFeatureRow(ctx, parked.id).heldBy).toBeUndefined()
    })
  })

  describe('taking', () => {
    it('moves a held feature and records both threads on the timeline', () => {
      const a = thread('A')
      const b = thread('B')
      const feature = seedFeature(ctx, projectId, { slug: 'held', heldBy: a.id })

      expect(toolTakeFeature(ctx, b, { slug: 'held' })).toEqual({ slug: 'held', heldBy: 'B', takenFrom: 'A' })

      expect(holderOfSlug(feature)).toBe(b.id)
      const taken = listAfter(ctx, feature.id, 0).find((e) => e.type === 'feature.taken')
      expect(taken?.message).toBe('taken by the thread "B" from "A"')
      expect(taken?.data).toMatchObject({ threadId: b.id, from: a.id, name: 'B', actor: 'orchestrator' })
    })

    it('takes a feature nobody holds, as a hold with no loser', () => {
      const a = thread('A')
      const feature = seedFeature(ctx, projectId, { slug: 'free' })

      expect(toolTakeFeature(ctx, a, { slug: 'free' }).takenFrom).toBeNull()

      expect(typesOn(feature)).toContain('feature.held')
      expect(typesOn(feature)).not.toContain('feature.taken')
    })

    it('changes nothing when the thread already holds it', () => {
      const a = thread('A')
      const feature = seedFeature(ctx, projectId, { slug: 'mine', heldBy: a.id })

      toolTakeFeature(ctx, a, { slug: 'mine' })

      expect(typesOn(feature)).toEqual([])
    })

    it('lets the later of two takes win', () => {
      const a = thread('A')
      const b = thread('B')
      const c = thread('C')
      const feature = seedFeature(ctx, projectId, { slug: 'held', heldBy: a.id })

      toolTakeFeature(ctx, b, { slug: 'held' })
      toolTakeFeature(ctx, c, { slug: 'held' })

      expect(holderOfSlug(feature)).toBe(c.id)
    })

    it('refuses a shipped feature', () => {
      seedFeature(ctx, projectId, { slug: 'old', status: 'shipped' })
      expect(() => toolTakeFeature(ctx, thread('A'), { slug: 'old' })).toThrow(/has shipped/)
    })
  })

  describe('seeing the holder', () => {
    it('marks each index line and names the holder in the feature’s context', async () => {
      const a = thread('Phone cut')
      const b = thread('B')
      seedFeature(ctx, projectId, { slug: 'theirs', heldBy: a.id })
      seedFeature(ctx, projectId, { slug: 'mine', heldBy: b.id })
      seedFeature(ctx, projectId, { slug: 'free' })
      seedFeature(ctx, projectId, { slug: 'done', status: 'shipped', heldBy: a.id })

      const index = (await toolGetProjectContext(ctx, b)).featureIndex

      const line = (slug: string) => index.find((l) => l.startsWith(`${slug} —`))
      expect(line('theirs')).toContain('· held by "Phone cut"')
      expect(line('mine')).toContain('· held by you')
      expect(line('free')).not.toContain('held by')
      expect(line('done')).not.toContain('held by')
      expect(featureContext(ctx, projectFeatureReader(ctx, b, 'theirs')).heldBy).toBe('Phone cut')
      expect(featureContext(ctx, projectFeatureReader(ctx, b, 'free')).heldBy).toBeNull()
    })
  })

  describe('a chat too long to reopen', () => {
    it('hands everything it held to the thread replacing it, and the briefing lists them', async () => {
      const old = thread('Old')
      const feature = seedFeature(ctx, projectId, { slug: 'mine', heldBy: old.id })
      seedFeature(ctx, projectId, { slug: 'done', status: 'shipped', heldBy: old.id })
      markSessionEnded(ctx, old.id)
      const transcript = join(repoPath, 'huge.jsonl')
      writeFileSync(transcript, 'x'.repeat(1_100_000))
      ctx.db.update(sessions).set({ transcriptPath: transcript }).where(eq(sessions.id, old.id)).run()

      const { sessionId } = await launchProjectSession(ctx, { projectId, resumeSessionId: old.id }, { spawn: false })

      expect(sessionId).not.toBe(old.id)
      expect(holderOfSlug(feature)).toBe(sessionId)
      const inherited = listAfter(ctx, feature.id, 0).find((e) => e.type === 'feature.held')
      expect(inherited?.data).toMatchObject({ threadId: sessionId, inheritedFrom: old.id })
    })

    it('moves nothing it did not hold', () => {
      const a = thread('A')
      const b = thread('B')
      const c = thread('C')
      const other = seedFeature(ctx, projectId, { slug: 'other', heldBy: c.id })

      inheritHolds(ctx, a.id, b.id)

      expect(holderOfSlug(other)).toBe(c.id)
    })
  })

  describe('the first-boot sweep', () => {
    function toolCall(tool: string, at: number): ThreadEvent {
      return {
        type: 'tool',
        call: { id: `call-${at}`, kind: 'other', title: tool, status: 'pending' },
        i: 0,
        at,
      } as ThreadEvent
    }

    function stamped(slug: string, overrides: Partial<Feature> = {}): Feature {
      const feature = seedFeature(ctx, projectId, { slug, ...overrides })
      runAsActor('orchestrator', () => emit(ctx, feature.id, { type: 'brief.added', message: 'x' }))
      return feature
    }

    it('places a feature on the thread whose acting call sits nearest its last stamped event', () => {
      const far = thread('Far')
      const near = thread('Near')
      seedThreadLog(far.id, [toolCall('mcp__runcastle__send_to_feature', Date.now() - 90_000)])
      seedThreadLog(near.id, [toolCall('mcp__runcastle__add_to_brief', Date.now() - 1_000)])
      const feature = stamped('in-flight')

      sweepHolders(ctx)

      expect(holderOfSlug(feature)).toBe(near.id)
      expect(listAfter(ctx, feature.id, 0).find((e) => e.type === 'feature.held')?.data).toMatchObject({
        threadId: near.id,
        swept: true,
      })
    })

    it('walks back past a stamped event no call is near, such as a docs checkpoint', () => {
      const a = thread('A')
      const feature = stamped('checkpointed')
      seedThreadLog(a.id, [toolCall('mcp__runcastle__add_to_brief', Date.now() - 200_000)])
      const [first] = listAfter(ctx, feature.id, 0)
      ctx.db
        .update(events)
        .set({ ts: Date.now() - 199_000 })
        .where(eq(events.id, first.id))
        .run()
      runAsActor('orchestrator', () => emit(ctx, feature.id, { type: 'docs.changed', message: 'x' }))

      sweepHolders(ctx)

      expect(holderOfSlug(feature)).toBe(a.id)
    })

    it('leaves a feature it cannot place unheld, says so on its timeline, and never falls back to the newest thread', () => {
      const newest = thread('Newest')
      seedThreadLog(newest.id, [toolCall('mcp__runcastle__send_to_feature', Date.now() - 600_000)])
      const feature = stamped('unplaced')

      sweepHolders(ctx)

      expect(holderOfSlug(feature)).toBeUndefined()
      expect(typesOn(feature)).toContain('feature.hold_unplaced')
    })

    it('ignores a thread that only read or searched for a tool’s name', () => {
      const a = thread('A')
      seedThreadLog(a.id, [
        toolCall('mcp__runcastle__get_feature_context', Date.now() - 1_000),
        toolCall('grep "send_to_feature"', Date.now() - 1_000),
      ])
      const feature = stamped('read-only')

      sweepHolders(ctx)

      expect(holderOfSlug(feature)).toBeUndefined()
    })

    it('leaves alone features held already, shipped, or never touched by a thread', () => {
      const a = thread('A')
      const b = thread('B')
      seedThreadLog(b.id, [toolCall('mcp__runcastle__send_to_feature', Date.now() - 1_000)])
      const held = stamped('held', { heldBy: a.id })
      const shipped = stamped('shipped', { status: 'shipped' })
      const human = seedFeature(ctx, projectId, { slug: 'human' })

      sweepHolders(ctx)

      expect(holderOfSlug(held)).toBe(a.id)
      expect(holderOfSlug(shipped)).toBeUndefined()
      expect(holderOfSlug(human)).toBeUndefined()
      expect(typesOn(human)).toEqual([])
    })

    it('runs once per project, so a later boot cannot place a feature left unheld', () => {
      const feature = stamped('unplaced')
      sweepHolders(ctx)
      expect(listByProject(ctx, projectId).filter((e) => e.type === HOLDERS_SWEPT)).toHaveLength(1)

      const a = thread('A')
      seedThreadLog(a.id, [toolCall('mcp__runcastle__send_to_feature', Date.now() - 1_000)])
      runAsActor('orchestrator', () => emit(ctx, feature.id, { type: 'brief.added', message: 'x' }))
      sweepHolders(ctx)

      expect(holderOfSlug(feature)).toBeUndefined()
      expect(listByProject(ctx, projectId).filter((e) => e.type === HOLDERS_SWEPT)).toHaveLength(1)
      expect(typesOn(feature).filter((t) => t === 'feature.hold_unplaced')).toHaveLength(1)
    })
  })
})
