import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Feature, SessionRow, ThreadEvent } from '@runcastle/core'
import { eq } from 'drizzle-orm'
import { Hono } from 'hono'
import { simpleGit } from 'simple-git'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { events, features, sessions } from '../src/db/schema'
import { clearRuntimeCtx, setRuntimeCtx } from '../src/launcher/runtime'
import hooksApp from '../src/routes/hooks'
import { listDesigns, recordDesign } from '../src/services/designs'
import { heldOpening } from '../src/launcher/launcher'
import { tagRuncastlePrompt } from '../src/services/lead-prompt'
import { readThreadEvents } from '../src/threads/log'
import { createCallerFactory } from '../src/trpc/context'
import { appRouter } from '../src/trpc/router'
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
  toolShowDesign,
  toolShowPlan,
  toolWaitForYou,
} from '../src/mcp/server'
import { emit, listByProject, listAfter, runAsActor } from '../src/services/events'
import {
  HOLDERS_SWEPT,
  inheritHolds,
  moveOwners,
  OWNER_CHANGED,
  OWNERS_MOVED,
  FINISHES_MOVED,
  moveHumanFinishes,
  planOwnerMove,
  releaseNeedsYou,
  releaseToHuman,
  sweepHolders,
} from '../src/services/holding'
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
    it('refuses every acting tool on a human-owned feature, claiming nothing, and says how the human hands it over', async () => {
      const a = thread('A')
      const free = seedFeature(ctx, projectId, { slug: 'free', status: 'draft', chatId: a.id })
      const calls: [string, () => unknown][] = [
        ['start_feature', () => toolStartFeature(ctx, a, { slug: 'free' })],
        ['plan_feature', () => toolPlanFeature(ctx, a, { slug: 'free' })],
        ['stop_feature_run', () => toolStopFeatureRun(ctx, a, { slug: 'free' })],
        ['drive', () => toolDrive(ctx, a, { slug: 'free', action: 'start' })],
        ['merge_feature', () => toolMergeFeature(ctx, a, { slug: 'free' })],
        ['add_to_brief', () => toolAddToBrief(ctx, a, { slug: 'free', text: 'x' })],
        ['set_feature_dependencies', () => toolSetFeatureDependencies(ctx, a, { slug: 'free', dependsOn: [] })],
      ]
      for (const [name, call] of calls) {
        await expect((async () => call())(), name).rejects.toThrow(/the human owns `free`.*"run free for me"/)
      }
      expect(holderOfSlug(free)).toBeUndefined()
      expect(typesOn(free)).toEqual([])
    })

    it('says when the human took the feature from this chat', async () => {
      const a = thread('A')
      const feature = seedFeature(ctx, projectId, { slug: 'taken', heldBy: a.id, chatId: a.id, finish: 'show' })
      releaseToHuman(ctx, feature.id, 'typed')
      const day = new Date().toISOString().slice(0, 10)

      await expect(toolAddToBrief(ctx, a, { slug: 'taken', text: 'x' })).rejects.toThrow(
        new RegExp(`the human took \`taken\` on ${day}`),
      )
    })

    it('lets send_to_feature reach a human-owned feature, which stays the human’s', async () => {
      const a = thread('A')
      const feature = seedFeature(ctx, projectId, { slug: 'free', chatId: a.id })

      await expect(toolSendToFeature(ctx, a, { slug: 'free', message: 'a sibling merged' })).resolves.toEqual({ deliveredToLead: true })

      expect(holderOfSlug(feature)).toBeUndefined()
      expect(typesOn(feature)).not.toContain(OWNER_CHANGED)
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
        await expect((async () => call())(), name).rejects.toThrow(/`held` is held by the orchestrator chat "Burn cut"/)
      }
      expect(holderOfSlug(held)).toBe(a.id)
    })

    it('guards only the draft being reordered, not the features it names', () => {
      const a = thread('A')
      const b = thread('B')
      const dep = seedFeature(ctx, projectId, { slug: 'dep', heldBy: a.id })
      const draft = seedFeature(ctx, projectId, { slug: 'draft', status: 'draft', heldBy: b.id })

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
    // The epic owns it exactly when the finish is its own ("Run it for me": one-place-to-answer decision 14).
    const pairs: { planning: 'with-me' | 'self'; finish: 'you' | 'show' | 'merge'; owned: boolean }[] = [
      { planning: 'with-me', finish: 'you', owned: false },
      { planning: 'self', finish: 'you', owned: false },
      { planning: 'self', finish: 'show', owned: true },
      { planning: 'self', finish: 'merge', owned: true },
    ]
    for (const { planning, finish, owned } of pairs) {
      it(`planning ${planning}, finish ${finish}: ${owned ? 'the chat owns it' : 'the human owns it'}, and it is the feature’s chat`, async () => {
        const a = thread('A')
        const made = await toolCreateFeature(ctx, a, { title: `F ${planning} ${finish}`, oneLiner: 'x', draft: true, brief: 'Why.', planning, finish })
        const row = getFeatureRow(ctx, made.id)

        expect(row.heldBy).toBe(owned ? a.id : undefined)
        expect(row.chatId).toBe(a.id)
        expect(row.finish).toBe(finish)
        expect(row.brief).toContain(planning === 'self' ? 'Planning mode: automatic' : 'Planning mode: with you')
        const created = listAfter(ctx, made.id, 0).find((e) => e.type === 'feature.created')
        expect(created?.data).toMatchObject({ createdBy: a.id })
        const changes = listAfter(ctx, made.id, 0).filter((e) => e.type === OWNER_CHANGED)
        expect(changes.map((e) => e.data)).toEqual(
          owned ? [expect.objectContaining({ owner: a.id, chatId: a.id, finish, cause: 'create', from: null })] : [],
        )
      })
    }

    for (const finish of ['show', 'merge'] as const) {
      it(`refuses "Plan it with me" handed to the epic (finish ${finish}), creating nothing`, async () => {
        const a = thread('A')
        await expect(
          toolCreateFeature(ctx, a, { title: `Grilled ${finish}`, oneLiner: 'x', draft: true, brief: 'Why.', planning: 'with-me', finish }),
        ).rejects.toThrow(/"Plan it with me"\) is theirs.*owner button.*"run it for me"/)
        expect(ctx.db.select().from(features).all()).toHaveLength(0)
      })
    }

    it('owns a feature by its finish alone: "run it for me" with no planning given plans automatically', async () => {
      const a = thread('A')
      const made = await toolCreateFeature(ctx, a, { title: 'Away', oneLiner: 'x', draft: true, brief: 'Why.', finish: 'merge' })
      expect(getFeatureRow(ctx, made.id)).toMatchObject({ heldBy: a.id, chatId: a.id, finish: 'merge' })
      expect(getFeatureRow(ctx, made.id).brief).toContain('Planning mode: automatic')
    })

    it('keeps a planning line the brief already has, and starts a feature as the human’s when no choice is given', async () => {
      const a = thread('A')
      const made = await toolCreateFeature(ctx, a, { title: 'Plain', oneLiner: 'x', draft: true, brief: 'Planning mode: plans itself — small', planning: 'self', finish: 'show' })
      expect(getFeatureRow(ctx, made.id).brief).toBe('Planning mode: plans itself — small')
      const bare = await toolCreateFeature(ctx, a, { title: 'Bare', oneLiner: 'x', draft: true, brief: 'b' })
      expect(getFeatureRow(ctx, bare.id)).toMatchObject({ heldBy: undefined, chatId: a.id, finish: 'you', brief: 'b' })
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

      expect(toolTakeFeature(ctx, b, { slug: 'held' })).toEqual({ slug: 'held', heldBy: 'B', takenFrom: 'A', finish: 'show' })

      expect(holderOfSlug(feature)).toBe(b.id)
      const taken = listAfter(ctx, feature.id, 0).filter((e) => e.type === OWNER_CHANGED)
      expect(taken).toHaveLength(1)
      expect(taken[0]?.message).toBe('owned by the orchestrator chat "B", which shows you before merging (you asked the chat to run it)')
      expect(taken[0]?.data).toMatchObject({ owner: b.id, chatId: b.id, finish: 'show', cause: 'take', from: a.id, actor: 'orchestrator' })
    })

    it('takes a human-owned feature with the finish asked for, making the taking chat its chat', () => {
      const a = thread('A')
      const b = thread('B')
      const feature = seedFeature(ctx, projectId, { slug: 'free', chatId: a.id })

      expect(toolTakeFeature(ctx, b, { slug: 'free', finish: 'merge' }).takenFrom).toBeNull()

      expect(getFeatureRow(ctx, feature.id)).toMatchObject({ heldBy: b.id, chatId: b.id, finish: 'merge' })
      expect(typesOn(feature).filter((t) => t === OWNER_CHANGED)).toHaveLength(1)
    })

    it('changes nothing when the thread already owns it', () => {
      const a = thread('A')
      const feature = seedFeature(ctx, projectId, { slug: 'mine', heldBy: a.id, chatId: a.id, finish: 'show' })

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

  describe('a long chat', () => {
    // Orchestrator chats are compacted, not replaced (agents-are-woken-only-when-it-matters decision 26).
    it('reopens past the 1 MB cap and keeps everything it held', async () => {
      const old = thread('Old')
      const feature = seedFeature(ctx, projectId, { slug: 'mine', heldBy: old.id })
      seedFeature(ctx, projectId, { slug: 'done', status: 'shipped', heldBy: old.id })
      markSessionEnded(ctx, old.id)
      const transcript = join(repoPath, 'huge.jsonl')
      writeFileSync(transcript, 'x'.repeat(1_100_000))
      ctx.db.update(sessions).set({ transcriptPath: transcript }).where(eq(sessions.id, old.id)).run()

      const { sessionId } = await launchProjectSession(ctx, { projectId, resumeSessionId: old.id }, { spawn: false })

      expect(sessionId).toBe(old.id)
      expect(holderOfSlug(feature)).toBe(old.id)
      expect(listAfter(ctx, feature.id, 0).some((e) => e.type === 'feature.held')).toBe(false)
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

  describe('changing the owner', () => {
    const caller = () => createCallerFactory(appRouter)(ctx)
    const changes = (feature: Feature) => listAfter(ctx, feature.id, 0).filter((e) => e.type === OWNER_CHANGED)

    function lead(feature: Feature, kind: 'chat' | 'side' = 'chat'): SessionRow {
      return createSessionRow(ctx, { featureId: feature.id, kind, worktreePath: repoPath })
    }

    it('the control’s "I’ll finish it" makes it the human’s, keeping its chat: one event', async () => {
      const a = thread('A')
      const feature = seedFeature(ctx, projectId, { slug: 'f', heldBy: a.id, chatId: a.id, finish: 'merge' })

      const after = await caller().feature.setOwner({ featureId: feature.id, choice: 'you' })

      expect(after).toMatchObject({ heldBy: undefined, chatId: a.id, finish: 'you' })
      expect(changes(feature).map((e) => e.data)).toEqual([
        expect.objectContaining({ owner: null, chatId: a.id, finish: 'you', cause: 'control', from: a.id }),
      ])
    })

    for (const choice of ['show', 'merge'] as const) {
      it(`the control’s "${choice}" gives a human-owned feature to its chat: one event`, async () => {
        const a = thread('A')
        const feature = seedFeature(ctx, projectId, { slug: `f-${choice}`, chatId: a.id })

        const after = await caller().feature.setOwner({ featureId: feature.id, choice })

        expect(after).toMatchObject({ heldBy: a.id, chatId: a.id, finish: choice })
        expect(changes(feature).map((e) => e.data)).toEqual([
          expect.objectContaining({ owner: a.id, chatId: a.id, finish: choice, cause: 'control', from: null }),
        ])
      })
    }

    it('refuses a chat’s choice on a feature with no chat (BAD_REQUEST), changing nothing', async () => {
      const feature = seedFeature(ctx, projectId, { slug: 'lonely' })
      await expect(caller().feature.setOwner({ featureId: feature.id, choice: 'show' })).rejects.toMatchObject({ code: 'BAD_REQUEST' })
      expect(changes(feature)).toHaveLength(0)
    })

    describe('typing in the lead’s chat', () => {
      beforeEach(() => setRuntimeCtx(ctx))
      afterEach(() => clearRuntimeCtx())

      async function prompt(session: SessionRow, text: string): Promise<void> {
        const app = new Hono()
        app.route('/api/hooks', hooksApp)
        await app.request('/api/hooks/user-prompt', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ sessionId: session.id, payload: { hook_event_name: 'UserPromptSubmit', prompt: text } }),
        })
      }

      it('a typed message in the main chat makes a chat-owned feature the human’s: one event', async () => {
        const a = thread('A')
        const feature = seedFeature(ctx, projectId, { slug: 'typed', heldBy: a.id, chatId: a.id, finish: 'show' })

        const typer = lead(feature)
        await prompt(typer, 'I will take it from here')

        expect(getFeatureRow(ctx, feature.id)).toMatchObject({ heldBy: undefined, chatId: a.id, finish: 'you' })
        expect(changes(feature).map((e) => e.data)).toEqual([expect.objectContaining({ owner: null, cause: 'typed', from: a.id })])
        // A typed take is the human's own move: no "it needed you" line in the chat (one-place-to-answer decision 13).
        expect(readThreadEvents(typer.id).some((e) => e.type === 'notice' && e.text.includes('This is yours now'))).toBe(false)
      })

      it('the first message to a lead nobody started takes it, though it rides behind runcastle’s held opening', async () => {
        const a = thread('A')
        const feature = seedFeature(ctx, projectId, { slug: 'idle', heldBy: a.id, chatId: a.id, finish: 'show' })
        const opening = heldOpening(tagRuncastlePrompt('Proceed with your task.'))

        // A relay carried behind the opening is still runcastle's, and takes nothing.
        await prompt(lead(feature), `${opening}\n\n${tagRuncastlePrompt('From the orchestrator: carry on')}`)
        expect(holderOfSlug(feature)).toBe(a.id)

        await prompt(lead(feature), `${opening}\n\nThis is mine now`)
        expect(getFeatureRow(ctx, feature.id)).toMatchObject({ heldBy: undefined, finish: 'you' })
        expect(changes(feature).map((e) => e.data)).toEqual([expect.objectContaining({ owner: null, cause: 'typed', from: a.id })])
      })

      it('runcastle’s own prompt, a side chat, and the chat’s send_to_feature never take it', async () => {
        const a = thread('A')
        const feature = seedFeature(ctx, projectId, { slug: 'kept', heldBy: a.id, chatId: a.id, finish: 'show' })

        await prompt(lead(feature), tagRuncastlePrompt('a delivered message'))
        await prompt(lead(feature, 'side'), 'a side question')
        await toolSendToFeature(ctx, a, { slug: 'kept', message: 'carry on' })

        expect(holderOfSlug(feature)).toBe(a.id)
        expect(changes(feature)).toHaveLength(0)
      })

      it('the chat hears of it once, on its next turn, and is not woken', async () => {
        const a = thread('A')
        const feature = seedFeature(ctx, projectId, { slug: 'gone', heldBy: a.id, chatId: a.id, finish: 'show' })
        await prompt(lead(feature), 'mine now')

        const first = (await toolGetProjectContext(ctx, a)).takenByHuman
        expect(first).toEqual([expect.stringMatching(/^The human took `gone`/)])
        expect((await toolGetProjectContext(ctx, a)).takenByHuman).toBeUndefined()
      })
    })

    it('a lead’s wait on the human releases a chat-owned feature: finish you, one needs-you event', () => {
      const a = thread('A')
      const feature = seedFeature(ctx, projectId, { slug: 'needs', heldBy: a.id, chatId: a.id, finish: 'merge' })

      expect(releaseNeedsYou(ctx, feature.id)).toBe(a.id)

      expect(getFeatureRow(ctx, feature.id)).toMatchObject({ heldBy: undefined, chatId: a.id, finish: 'you' })
      expect(changes(feature).map((e) => e.data)).toEqual([
        expect.objectContaining({ owner: null, chatId: a.id, finish: 'you', cause: 'needs-you', from: a.id }),
      ])
      // Already the human's: nothing changes.
      expect(releaseNeedsYou(ctx, feature.id)).toBeNull()
      expect(changes(feature)).toHaveLength(1)
    })

    it('a replacement chat inherits what the old one owned and every feature whose chat it was', () => {
      const old = thread('Old')
      const next = thread('Next')
      const owned = seedFeature(ctx, projectId, { slug: 'owned', heldBy: old.id, chatId: old.id, finish: 'show' })
      const human = seedFeature(ctx, projectId, { slug: 'human', chatId: old.id })

      inheritHolds(ctx, old.id, next.id)

      expect(getFeatureRow(ctx, owned.id)).toMatchObject({ heldBy: next.id, chatId: next.id, finish: 'show' })
      expect(getFeatureRow(ctx, human.id)).toMatchObject({ heldBy: undefined, chatId: next.id, finish: 'you' })
      expect(changes(owned).map((e) => e.data)).toEqual([expect.objectContaining({ owner: next.id, cause: 'replacement', from: old.id })])
      expect(changes(human)).toHaveLength(1)
    })
  })

  describe('what each side may do', () => {
    // Under a chat owner it makes the feature the human's: lead-handback.test.ts covers that, with the wake.
    it('allows the lead’s wait_for_you under the human', async () => {
      const a = thread('Notes triage')
      const mine = seedFeature(ctx, projectId, { slug: 'mine', chatId: a.id })
      const lead = createSessionRow(ctx, { featureId: mine.id, kind: 'chat', worktreePath: repoPath })

      expect((await toolWaitForYou(ctx, lead, { why: 'pick a theme' })).need?.why).toBe('pick a theme')
    })

    it('posts a feature’s plan card in an orchestrator chat by slug, marked with its feature', () => {
      const a = thread('A')
      const feature = seedFeature(ctx, projectId, { slug: 'planned' })
      const docs = join(repoPath, 'docs', 'features', 'planned')
      mkdirSync(docs, { recursive: true })
      writeFileSync(join(docs, 'spec.md'), '# Spec\n')

      expect(toolShowPlan(ctx, a, { slug: 'planned' })).toEqual({ shown: true })

      expect(readThreadEvents(a.id).filter((e) => e.type === 'plan_shown')).toEqual([
        expect.objectContaining({ type: 'plan_shown', featureId: feature.id }),
      ])
      // The lead's "new to the human" mark is the lead's to set.
      expect(typesOn(feature)).not.toContain('panel.show')
    })

    it('posts the card of a design the lead recorded, by slug and path, never approving it', () => {
      const a = thread('A')
      const feature = seedFeature(ctx, projectId, { slug: 'designed' })
      const design = recordDesign(ctx, feature.id, { path: '/designs/owner.html', title: 'Owner control' })

      expect(toolShowDesign(ctx, a, { slug: 'designed', path: 'designs/owner.html' })).toEqual({ recorded: true, state: 'waiting' })

      expect(readThreadEvents(a.id).filter((e) => e.type === 'design_shown')).toEqual([
        expect.objectContaining({ designId: design.id, featureId: feature.id }),
      ])
      expect(listDesigns(ctx, feature.id)).toEqual([expect.objectContaining({ id: design.id, state: 'waiting' })])
      expect(() => toolShowDesign(ctx, a, { slug: 'designed', path: '/nope.html' })).toThrow(/recorded no design at \/nope.html/)
    })
  })

  describe('moving today’s features', () => {
    const ev = (id: number, featureId: string, type: string, data?: unknown) => ({ id, featureId, type, data })

    it('plans: held keeps its chat with show; unheld gets its chat from its creation record; else stays chatless', () => {
      const base = { status: 'active' as const, chatId: null, finish: 'you' as const }
      const moves = planOwnerMove(
        [
          { ...base, id: 'f1', slug: 'held', title: 'Held', heldBy: 't1' },
          { ...base, id: 'f2', slug: 'grilled', title: 'Grilled' },
          { ...base, id: 'f3', slug: 'by-field', title: 'By field' },
          { ...base, id: 'f4', slug: 'new-feature', title: 'New feature' },
          { ...base, id: 'f5', slug: 'old', title: 'Old', status: 'shipped', heldBy: 't1' },
          { ...base, id: 'f6', slug: 'moved', title: 'Moved', heldBy: 't1', chatId: 't1', finish: 'merge' },
        ],
        [
          ev(3, 'f2', 'feature.held', { threadId: 't2' }),
          ev(2, 'f2', 'feature.created', {}),
          ev(4, 'f2', 'feature.held', { threadId: 't9' }),
          ev(5, 'f3', 'feature.created', { createdBy: 't3' }),
          ev(6, 'f4', 'feature.created', {}),
        ],
      )
      expect(moves).toEqual([
        expect.objectContaining({ slug: 'held', owner: 't1', chatId: 't1', finish: 'show' }),
        expect.objectContaining({ slug: 'grilled', owner: null, chatId: 't2', finish: 'you' }),
        expect.objectContaining({ slug: 'by-field', owner: null, chatId: 't3', finish: 'you' }),
      ])
      for (const m of moves) expect(m.reason).toBeTruthy()
    })

    it('runs once per project at boot, records what it moved, and stops the old sweep from placing holds', () => {
      const a = thread('A')
      const held = seedFeature(ctx, projectId, { slug: 'held', heldBy: a.id })
      const grilled = seedFeature(ctx, projectId, { slug: 'grilled' })
      emit(ctx, grilled.id, { type: 'feature.held', message: 'x', data: { threadId: a.id } })
      ctx.db.update(features).set({ heldBy: null }).where(eq(features.id, grilled.id)).run()

      moveOwners(ctx)
      moveOwners(ctx)

      expect(getFeatureRow(ctx, held.id)).toMatchObject({ heldBy: a.id, chatId: a.id, finish: 'show' })
      expect(getFeatureRow(ctx, grilled.id)).toMatchObject({ heldBy: undefined, chatId: a.id, finish: 'you' })
      const markers = listByProject(ctx, projectId).filter((e) => e.type === OWNERS_MOVED)
      expect(markers).toHaveLength(1)
      expect((markers[0]?.data as { moves: unknown[] }).moves).toHaveLength(2)
      expect(typesOn(held).filter((t) => t === OWNER_CHANGED)).toHaveLength(1)

      // An unheld feature an orchestrator touched is the human's on purpose now: the sweep places nothing.
      seedThreadLog(a.id, [
        { type: 'tool', call: { id: 'c', kind: 'other', title: 'mcp__runcastle__add_to_brief', status: 'pending' }, i: 0, at: Date.now() } as ThreadEvent,
      ])
      runAsActor('orchestrator', () => emit(ctx, grilled.id, { type: 'brief.added', message: 'x' }))
      ctx.db.delete(events).where(eq(events.type, HOLDERS_SWEPT)).run()
      sweepHolders(ctx)
      expect(holderOfSlug(grilled)).toBeUndefined()
    })

    it('never stops the server, and tries again on the next boot', () => {
      seedFeature(ctx, projectId, { slug: 'held', heldBy: thread('A').id })
      const logged = vi.spyOn(console, 'error').mockImplementation(() => {})
      const select = vi.spyOn(ctx.db, 'select').mockImplementationOnce(() => {
        throw new Error('disk full')
      })
      expect(() => moveOwners(ctx)).not.toThrow()
      expect(logged).toHaveBeenCalled()
      select.mockRestore()
      logged.mockRestore()

      moveOwners(ctx)
      expect(listByProject(ctx, projectId).filter((e) => e.type === OWNERS_MOVED)).toHaveLength(1)
    })
  })

  describe('the human’s features finish with them (one-place-to-answer decision 10)', () => {
    it('once per project: a human-owned feature with an epic finish gets you; epic-owned and shipped ones are untouched; it records what moved', () => {
      const a = thread('A')
      const grilled = seedFeature(ctx, projectId, { slug: 'grilled', chatId: a.id, finish: 'merge' })
      const owned = seedFeature(ctx, projectId, { slug: 'owned', heldBy: a.id, chatId: a.id, finish: 'show' })
      const mine = seedFeature(ctx, projectId, { slug: 'mine', chatId: a.id, finish: 'you' })
      const old = seedFeature(ctx, projectId, { slug: 'old', chatId: a.id, finish: 'show', status: 'shipped' })

      moveHumanFinishes(ctx)
      moveHumanFinishes(ctx)

      expect(getFeatureRow(ctx, grilled.id)).toMatchObject({ heldBy: undefined, chatId: a.id, finish: 'you' })
      expect(getFeatureRow(ctx, owned.id)).toMatchObject({ heldBy: a.id, chatId: a.id, finish: 'show' })
      expect(getFeatureRow(ctx, mine.id).finish).toBe('you')
      expect(getFeatureRow(ctx, old.id).finish).toBe('show')
      expect(listAfter(ctx, grilled.id, 0).filter((e) => e.type === OWNER_CHANGED).map((e) => e.data)).toEqual([
        expect.objectContaining({ owner: null, chatId: a.id, finish: 'you', cause: 'finish-moved', from: null }),
      ])
      for (const f of [owned, mine, old]) expect(typesOn(f)).not.toContain(OWNER_CHANGED)
      const markers = listByProject(ctx, projectId).filter((e) => e.type === FINISHES_MOVED)
      expect(markers).toHaveLength(1)
      expect(markers[0]?.data).toEqual({ moved: [{ featureId: grilled.id, slug: 'grilled', from: 'merge' }] })

      // A later feature in that state (none should arise) is not moved by a later boot.
      const later = seedFeature(ctx, projectId, { slug: 'later', chatId: a.id, finish: 'show' })
      moveHumanFinishes(ctx)
      expect(getFeatureRow(ctx, later.id).finish).toBe('show')
    })

    it('never stops the server, and tries again on the next boot', () => {
      seedFeature(ctx, projectId, { slug: 'grilled', chatId: thread('A').id, finish: 'show' })
      const logged = vi.spyOn(console, 'error').mockImplementation(() => {})
      const select = vi.spyOn(ctx.db, 'select').mockImplementationOnce(() => {
        throw new Error('disk full')
      })
      expect(() => moveHumanFinishes(ctx)).not.toThrow()
      expect(logged).toHaveBeenCalled()
      select.mockRestore()
      logged.mockRestore()

      moveHumanFinishes(ctx)
      expect(listByProject(ctx, projectId).filter((e) => e.type === FINISHES_MOVED)).toHaveLength(1)
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

    it('never stops the server, and tries again on the next boot', () => {
      const feature = stamped('unplaced')
      const logged = vi.spyOn(console, 'error').mockImplementation(() => {})
      const select = vi.spyOn(ctx.db, 'select').mockImplementationOnce(() => {
        throw new Error('disk full')
      })

      expect(() => sweepHolders(ctx)).not.toThrow()
      expect(logged).toHaveBeenCalled()
      select.mockRestore()
      logged.mockRestore()

      sweepHolders(ctx)
      expect(typesOn(feature)).toContain('feature.hold_unplaced')
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
