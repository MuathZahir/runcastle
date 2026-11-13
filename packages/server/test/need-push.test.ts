import { FEATURE_NEEDS_YOU, type NeedsYouData } from '@runcastle/core'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AppCtx } from '../src/db/types'
import { createSessionRow } from '../src/launcher/sessions'
import { emit, emitProject, listAfter, listByProject } from '../src/services/events'
import { pushNeed, startNeedPush } from '../src/services/need-push'
import { type PushMessage, type PushTarget, addPushSubscription } from '../src/services/push'
import { makeTestCtx } from './helpers/db'
import { seedFeature, seedProject } from './helpers/fixtures'

/**
 * Needs you is the agent's call, decision 14: runcastle pushes to the phone
 * itself each time a chat enters a need, saying the agent's line, and the tap
 * opens that chat. A fake sender records what would leave.
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
  return emit(ctx, featureId, { type: FEATURE_NEEDS_YOU, message: `needs you · ${data.why}`, data })
}

const sentLines = (featureId: string) => listAfter(ctx, featureId).filter((e) => e.type === 'notification.sent')

beforeEach(async () => {
  ctx = await makeTestCtx()
  projectId = seedProject(ctx).id
})

describe('runcastle’s own phone pings', () => {
  it('pushes the agent’s line to every phone, opening the chat it waits in, with one timeline line', async () => {
    const f = seedFeature(ctx, projectId, { slug: 'export-csv', title: 'Export CSV' })
    addPushSubscription(ctx, phone('a'))
    addPushSubscription(ctx, phone('b'))
    const { sent, send } = fakeSender()

    await pushNeed(ctx, needEvent(f.id, { why: 'Which delimiter?', threadId: 'sess_lead', by: 'agent', featureId: f.id }), send)

    expect(sent.map((s) => s.target.endpoint)).toEqual([phone('a').endpoint, phone('b').endpoint])
    expect(sent[0]?.message).toEqual({
      title: 'Export CSV',
      body: 'Which delimiter?',
      url: `/p/${projectId}/f/export-csv/chat?thread=sess_lead`,
    })
    expect(sentLines(f.id)).toHaveLength(1)
  })

  it('says a line with no stop of its own as a sentence', async () => {
    const f = seedFeature(ctx, projectId)
    addPushSubscription(ctx, phone('a'))
    const { sent, send } = fakeSender()
    await pushNeed(ctx, needEvent(f.id, { why: 'Ready to test · Export a report', threadId: 's1', by: 'agent', featureId: f.id }), send)
    expect(sent[0]?.message.body).toBe('Ready to test · Export a report.')
  })

  it('opens an orchestrator chat’s own need in that chat, named after it', async () => {
    const epic = createSessionRow(ctx, { projectId, kind: 'project', worktreePath: '/wt' })
    addPushSubscription(ctx, phone('a'))
    const { sent, send } = fakeSender()
    const event = emitProject(ctx, projectId, {
      type: FEATURE_NEEDS_YOU,
      message: 'needs you · Start the batch?',
      data: { why: 'Start the batch?', threadId: epic.id, by: 'agent', featureId: null } satisfies NeedsYouData,
    })
    await pushNeed(ctx, event, send)
    expect(sent[0]?.message.url).toBe(`/p/${projectId}/chat?thread=${epic.id}`)
    expect(sent[0]?.message.body).toBe('Start the batch?')
    expect(listByProject(ctx, projectId).filter((e) => e.type === 'notification.sent')).toHaveLength(1)
  })

  it('pushes nothing for malformed data', async () => {
    const f = seedFeature(ctx, projectId)
    addPushSubscription(ctx, phone('a'))
    const { sent, send } = fakeSender()
    const old = emit(ctx, f.id, { type: FEATURE_NEEDS_YOU, message: 'needs you', data: { kind: 'plan', words: 'Plan to approve', held: false, why: null } })
    expect(await pushNeed(ctx, old, send)).toBeNull()
    expect(sent).toEqual([])
  })

  it('with no phone subscribed sends nothing and records nothing, quietly', async () => {
    const f = seedFeature(ctx, projectId)
    const { sent, send } = fakeSender()

    await expect(pushNeed(ctx, needEvent(f.id, { why: 'x', threadId: 's1', by: 'agent', featureId: f.id }), send)).resolves.toEqual({
      phones: 0,
      sent: 0,
    })

    expect(sent).toEqual([])
    expect(sentLines(f.id)).toEqual([])
  })

  it('pushes from the live bus as the event is emitted', async () => {
    const f = seedFeature(ctx, projectId)
    addPushSubscription(ctx, phone('a'))
    const { sent, send } = fakeSender()
    const stop = startNeedPush(ctx, send)
    try {
      emit(ctx, f.id, { type: 'session.waiting', message: 'unrelated' })
      needEvent(f.id, { why: 'Which delimiter?', threadId: 's1', by: 'agent', featureId: f.id })
      await vi.waitFor(() => expect(sentLines(f.id)).toHaveLength(1))
      expect(sent).toHaveLength(1)
    } finally {
      stop()
    }
  })
})
