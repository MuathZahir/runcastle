import { FEATURE_NEEDS_YOU, type NeedsYouData, YOU_STOPPED_IT } from '@runcastle/core'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AppCtx } from '../src/db/types'
import { emit, listAfter } from '../src/services/events'
import { pushNeed, startNeedPush } from '../src/services/need-push'
import { type PushMessage, type PushTarget, addPushSubscription } from '../src/services/push'
import { makeTestCtx } from './helpers/db'
import { seedFeature, seedProject } from './helpers/fixtures'

/**
 * you-always-know-what-s-waiting ticket 3, decision 12: runcastle pushes to the
 * phone itself whenever the desktop would ping — a need that is not held and is
 * not the human's own Stop. A fake sender records what would leave.
 */

let ctx: AppCtx
let projectId: string

const phone = (name: string): PushTarget => ({
  endpoint: `https://push.example/${name}`,
  keys: { p256dh: `key-${name}`, auth: `auth-${name}` },
})

function fakeSender() {
  const sent: { target: PushTarget; message: PushMessage }[] = []
  const send = async (target: PushTarget, message: PushMessage) => {
    sent.push({ target, message })
  }
  return { sent, send }
}

function needEvent(featureId: string, data: NeedsYouData) {
  return emit(ctx, featureId, { type: FEATURE_NEEDS_YOU, message: `needs you · ${data.words}`, data })
}

const plan: NeedsYouData = { kind: 'plan', words: 'Plan to approve', held: false, why: null }
const sentLines = (featureId: string) => listAfter(ctx, featureId).filter((e) => e.type === 'notification.sent')

beforeEach(async () => {
  ctx = await makeTestCtx()
  projectId = seedProject(ctx).id
})

describe('runcastle’s own phone pings', () => {
  it('pushes a need to every phone, opening the feature’s chat, with one timeline line', async () => {
    const f = seedFeature(ctx, projectId, { slug: 'export-csv', title: 'Export CSV' })
    addPushSubscription(ctx, phone('a'))
    addPushSubscription(ctx, phone('b'))
    const { sent, send } = fakeSender()

    await pushNeed(ctx, needEvent(f.id, plan), send)

    expect(sent.map((s) => s.target.endpoint)).toEqual([phone('a').endpoint, phone('b').endpoint])
    expect(sent[0]?.message).toEqual({
      title: 'Export CSV',
      body: 'Plan to approve.',
      url: `/p/${projectId}/f/export-csv/chat`,
    })
    expect(sentLines(f.id)).toHaveLength(1)
  })

  it('names the worker that needs the human, and the tap opens that worker’s thread', async () => {
    const f = seedFeature(ctx, projectId, { slug: 'export-csv', title: 'Export CSV' })
    addPushSubscription(ctx, phone('a'))
    const { sent, send } = fakeSender()
    const worker: NeedsYouData = { kind: 'worker', words: 'Header needs you', held: false, why: 'Header', threadId: 'sess_w1' }

    await pushNeed(ctx, needEvent(f.id, worker), send)

    expect(sent[0]?.message).toEqual({
      title: 'Export CSV',
      body: 'Header needs you.',
      url: `/p/${projectId}/f/export-csv/chat?thread=sess_w1`,
    })
  })

  it('names the need in one sentence', async () => {
    const f = seedFeature(ctx, projectId)
    addPushSubscription(ctx, phone('a'))
    const { sent, send } = fakeSender()

    await pushNeed(ctx, needEvent(f.id, { kind: 'permission', words: 'Needs permission · Bash: git push', held: false, why: 'Bash: git push' }), send)
    await pushNeed(ctx, needEvent(f.id, { kind: 'answer', words: 'Needs your answer · which model?', held: false, why: 'which model?' }), send)
    await pushNeed(ctx, needEvent(f.id, { kind: 'merge', words: 'Ready to merge', held: false, why: null }), send)

    expect(sent.map((s) => s.message.body)).toEqual([
      'Waiting for your permission to run Bash: git push.',
      'Needs your answer: which model?',
      'Ready to merge.',
    ])
  })

  it('pushes nothing for a held need, nor for the stop the human made', async () => {
    const f = seedFeature(ctx, projectId)
    addPushSubscription(ctx, phone('a'))
    const { sent, send } = fakeSender()

    expect(await pushNeed(ctx, needEvent(f.id, { ...plan, held: true, words: 'With the orchestrator · Plan to approve' }), send)).toBeNull()
    expect(
      await pushNeed(ctx, needEvent(f.id, { kind: 'stopped', words: `Stopped · ${YOU_STOPPED_IT}`, held: false, why: YOU_STOPPED_IT }), send),
    ).toBeNull()

    expect(sent).toEqual([])
    expect(sentLines(f.id)).toEqual([])
  })

  it('with no phone subscribed sends nothing and records nothing, quietly', async () => {
    const f = seedFeature(ctx, projectId)
    const { sent, send } = fakeSender()

    await expect(pushNeed(ctx, needEvent(f.id, plan), send)).resolves.toEqual({ phones: 0, sent: 0 })

    expect(sent).toEqual([])
    expect(sentLines(f.id)).toEqual([])
  })

  it('pushes from the live bus as the event is emitted', async () => {
    const f = seedFeature(ctx, projectId)
    addPushSubscription(ctx, phone('a'))
    const { sent, send } = fakeSender()
    const stop = startNeedPush(ctx, send)
    try {
      emit(ctx, f.id, { type: 'feature.waiting', message: 'unrelated' })
      needEvent(f.id, plan)
      await vi.waitFor(() => expect(sentLines(f.id)).toHaveLength(1))
      expect(sent).toHaveLength(1)
    } finally {
      stop()
    }
  })
})
