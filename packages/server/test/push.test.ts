import { createECDH, randomBytes } from 'node:crypto'
import type { SessionKind, SessionRow } from '@runcastle/core'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import webpush from 'web-push'
import { pushSubscriptions } from '../src/db/schema'
import type { AppCtx } from '../src/db/types'
import { GateError } from '../src/errors'
import { createSessionRow, getSessionRow, markSessionEnded, markSessionLive } from '../src/launcher/sessions'
import { NOTIFY_MAX_CHARS, toolNotifyHuman } from '../src/mcp/notify-tool'
import { toolsForAudience } from '../src/mcp/server'
import { listAfter, listByProject } from '../src/services/events'
import {
  type PushMessage,
  type PushTarget,
  addPushSubscription,
  pushPublicKey,
  sendPushToAll,
} from '../src/services/push'
import { createCallerFactory } from '../src/trpc/context'
import { appRouter } from '../src/trpc/router'
import { makeTestCtx } from './helpers/db'
import { seedFeature, seedProject } from './helpers/fixtures'

/**
 * Notifying the phone (`agents-can-notify-your-phone`). Delivery is the one thing
 * that cannot run here, so a fake sender records what would leave; the router
 * reaches for the real sender, so for it `web-push`'s network call is mocked.
 */

const realSend = vi.hoisted(() => ({
  calls: [] as { endpoint: string; payload: string; options: Record<string, unknown> }[],
  fails: null as null | { statusCode: number },
}))

vi.mock('web-push', async (importOriginal) => {
  const actual = await importOriginal<{ default: Record<string, unknown> }>()
  return {
    ...actual,
    default: {
      ...actual.default,
      sendNotification: async (
        target: { endpoint: string },
        payload: string,
        options: Record<string, unknown>,
      ) => {
        realSend.calls.push({ endpoint: target.endpoint, payload, options })
        if (realSend.fails) throw Object.assign(new Error('refused'), realSend.fails)
      },
    },
  }
})

const phone = (name: string): PushTarget => ({
  endpoint: `https://push.example/${name}`,
  keys: { p256dh: `key-${name}`, auth: `auth-${name}` },
})

/** A sender recording each message, refusing the endpoints named in `refuse` with that status. */
function fakeSender(refuse: Record<string, number> = {}) {
  const sent: { target: PushTarget; message: PushMessage }[] = []
  const send = async (target: PushTarget, message: PushMessage) => {
    const status = refuse[target.endpoint]
    if (status) throw Object.assign(new Error('refused'), { statusCode: status })
    sent.push({ target, message })
  }
  return { sent, send }
}

describe('phone notifications', () => {
  let ctx: AppCtx
  let projectId: string

  beforeEach(async () => {
    ctx = await makeTestCtx()
    projectId = seedProject(ctx).id
    realSend.calls = []
    realSend.fails = null
    vi.spyOn(console, 'warn').mockImplementation(() => {})
  })

  const endpoints = () => ctx.db.select().from(pushSubscriptions).all().map((row) => row.endpoint)

  function session(kind: SessionKind, featureId?: string): SessionRow {
    const row = createSessionRow(ctx, {
      kind,
      worktreePath: 'x',
      ...(featureId ? { featureId } : { projectId }),
    })
    markSessionLive(ctx, row.id, { ccSessionId: `cc-${row.id}` })
    return getSessionRow(ctx, row.id) as SessionRow
  }

  describe('who may notify', () => {
    it('offers the tool to a feature’s main chat and an orchestrator thread, and to nobody else', () => {
      expect(toolsForAudience('chat')).toContain('notify_human')
      expect(toolsForAudience('project')).toContain('notify_human')
      for (const other of ['side', 'run', 'drive-fix', 'scenario'] as const) {
        expect(toolsForAudience(other), other).not.toContain('notify_human')
      }
    })

    it('lets a feature’s chat notify while no thread holds the feature', async () => {
      addPushSubscription(ctx, phone('a'))
      const feature = seedFeature(ctx, projectId, { slug: 'coupons', title: 'Checkout coupons' })
      const chat = session('chat', feature.id)
      const { sent, send } = fakeSender()

      expect(await toolNotifyHuman(ctx, chat, { message: 'Screenshots are ready.' }, send)).toEqual({ sent: 1 })

      expect(sent[0]?.message).toEqual({
        title: 'Checkout coupons',
        body: 'Screenshots are ready.',
        url: `/p/${projectId}/f/coupons/chat?thread=${chat.id}`,
      })
    })

    it('refuses a feature’s chat on a held feature, naming the holder, even if a phone is on', async () => {
      addPushSubscription(ctx, phone('a'))
      const holder = session('project')
      const feature = seedFeature(ctx, projectId, { heldBy: holder.id })
      const { sent, send } = fakeSender()

      const refused = await toolNotifyHuman(ctx, session('chat', feature.id), { message: 'Hi' }, send).catch((e) => e)

      expect(refused).toBeInstanceOf(GateError)
      expect((refused as GateError).message).toMatch(/holds this feature/)
      expect(sent).toEqual([])
    })

    it('lets an orchestrator thread notify, and a tap opens that exact thread', async () => {
      addPushSubscription(ctx, phone('a'))
      const thread = session('project')
      const { sent, send } = fakeSender()

      await toolNotifyHuman(ctx, thread, { message: 'The cut is ready.' }, send)

      expect(sent[0]?.message.url).toBe(`/p/${projectId}/chat?thread=${thread.id}`)
      expect(sent[0]?.message.title.length).toBeGreaterThan(0)
    })

    it('refuses a closed orchestrator thread, and any other kind that reaches the tool', async () => {
      const closed = session('project')
      markSessionEnded(ctx, closed.id)
      const feature = seedFeature(ctx, projectId, {})
      const { send } = fakeSender()

      await expect(
        toolNotifyHuman(ctx, getSessionRow(ctx, closed.id) as SessionRow, { message: 'Hi' }, send),
      ).rejects.toBeInstanceOf(GateError)
      await expect(toolNotifyHuman(ctx, session('side', feature.id), { message: 'Hi' }, send)).rejects.toBeInstanceOf(
        GateError,
      )
    })

    it('caps the sentence at 200 characters', () => {
      expect(NOTIFY_MAX_CHARS).toBe(200)
    })
  })

  describe('what the tool answers', () => {
    it('with no phone on, sends nothing and tells the agent where to turn it on', async () => {
      const feature = seedFeature(ctx, projectId, {})
      const result = await toolNotifyHuman(ctx, session('chat', feature.id), { message: 'Hi' }, fakeSender().send)

      expect(result.sent).toBe(0)
      expect(result.note).toMatch(/foot of the feature list/)
      expect(listAfter(ctx, feature.id).some((e) => e.type === 'notification.sent')).toBe(false)
    })

    it('says so when every phone failed, and leaves no line on the timeline', async () => {
      addPushSubscription(ctx, phone('a'))
      const feature = seedFeature(ctx, projectId, {})
      const { send } = fakeSender({ [phone('a').endpoint]: 500 })

      const result = await toolNotifyHuman(ctx, session('chat', feature.id), { message: 'Hi' }, send)

      expect(result.sent).toBe(0)
      expect(result.note).toMatch(/could not be sent/)
      expect(listAfter(ctx, feature.id).some((e) => e.type === 'notification.sent')).toBe(false)
    })

    it('leaves one timeline line, without the sentence', async () => {
      addPushSubscription(ctx, phone('a'))
      addPushSubscription(ctx, phone('b'))
      const feature = seedFeature(ctx, projectId, {})

      await toolNotifyHuman(ctx, session('chat', feature.id), { message: 'A private sentence' }, fakeSender().send)

      const lines = listAfter(ctx, feature.id).filter((e) => e.type === 'notification.sent')
      expect(lines).toHaveLength(1)
      expect(lines[0]?.message).toBe('sent a phone notification to 2 phones')
      expect(JSON.stringify(lines[0])).not.toContain('private sentence')
    })

    it('puts an orchestrator thread’s line on the project’s timeline', async () => {
      addPushSubscription(ctx, phone('a'))
      await toolNotifyHuman(ctx, session('project'), { message: 'Hi' }, fakeSender().send)

      expect(listByProject(ctx, projectId).some((e) => e.type === 'notification.sent')).toBe(true)
    })
  })

  describe('delivery', () => {
    const message = { title: 't', body: 'b', url: '/' }

    it('reaches every phone, and one failure does not stop the rest', async () => {
      addPushSubscription(ctx, phone('a'))
      addPushSubscription(ctx, phone('b'))
      const { sent, send } = fakeSender({ [phone('a').endpoint]: 500 })

      expect(await sendPushToAll(ctx, message, send)).toEqual({ phones: 2, sent: 1 })
      expect(sent.map((s) => s.target.endpoint)).toEqual([phone('b').endpoint])
    })

    it.each([404, 410])('forgets a phone its push service answers %i for', async (status) => {
      addPushSubscription(ctx, phone('a'))
      await sendPushToAll(ctx, message, fakeSender({ [phone('a').endpoint]: status }).send)
      expect(endpoints()).toEqual([])
    })

    it.each([403, 429, 500])('keeps a phone through a %i, which may pass', async (status) => {
      addPushSubscription(ctx, phone('a'))
      await sendPushToAll(ctx, message, fakeSender({ [phone('a').endpoint]: status }).send)
      expect(endpoints()).toEqual([phone('a').endpoint])
    })

    it('gives up on a push service that never answers, and keeps the phone', async () => {
      addPushSubscription(ctx, phone('a'))
      vi.useFakeTimers()
      try {
        const sending = sendPushToAll(ctx, message, () => new Promise(() => {}))
        await vi.advanceTimersByTimeAsync(10_000)
        expect(await sending).toEqual({ phones: 1, sent: 0 })
      } finally {
        vi.useRealTimers()
      }
      expect(endpoints()).toEqual([phone('a').endpoint])
    })

    it('sends high urgency with a day to live, so a sleeping phone wakes and a stale one drops it', async () => {
      addPushSubscription(ctx, phone('a'))
      await sendPushToAll(ctx, message)

      const { options, payload } = realSend.calls[0] ?? {}
      expect(options).toMatchObject({ urgency: 'high', TTL: 86_400 })
      expect(options?.vapidDetails).toMatchObject({ subject: 'https://runcastle.dev' })
      expect(JSON.parse(payload ?? '')).toEqual(message)
    })

    it('makes its signing keys once and keeps them', () => {
      expect(pushPublicKey(ctx)).toBe(pushPublicKey(ctx))
    })

    it('encrypts the sentence, so a push service cannot read it', () => {
      const browser = createECDH('prime256v1')
      browser.generateKeys()
      const keys = webpush.generateVAPIDKeys()

      const request = webpush.generateRequestDetails(
        {
          endpoint: 'https://push.example/1',
          keys: { p256dh: browser.getPublicKey('base64url'), auth: randomBytes(16).toString('base64url') },
        },
        JSON.stringify({ ...message, body: 'A private sentence' }),
        { vapidDetails: { subject: 'https://runcastle.dev', ...keys } },
      )

      expect(request.headers['Content-Encoding']).toBe('aes128gcm')
      expect(Buffer.from(request.body as Buffer).toString('latin1')).not.toContain('A private sentence')
    })
  })

  describe('the phone’s switch', () => {
    const caller = () => createCallerFactory(appRouter)(ctx)
    const subscription = phone('a')

    it('turning on stores the phone, sends the test notification and notes it', async () => {
      await caller().push.subscribe({ projectId, subscription })

      expect(endpoints()).toEqual([subscription.endpoint])
      expect(realSend.calls).toHaveLength(1)
      expect(JSON.parse(realSend.calls[0]?.payload ?? '')).toMatchObject({ url: `/p/${projectId}` })
      expect(listByProject(ctx, projectId).some((e) => e.type === 'phone_notifications.changed')).toBe(true)
    })

    it('a failed test leaves the phone off and says why', async () => {
      realSend.fails = { statusCode: 500 }

      await expect(caller().push.subscribe({ projectId, subscription })).rejects.toThrow(/could not be sent/)

      expect(endpoints()).toEqual([])
      expect(listByProject(ctx, projectId).some((e) => e.type === 'phone_notifications.changed')).toBe(false)
    })

    it('turning on twice keeps one row', async () => {
      await caller().push.subscribe({ projectId, subscription })
      await caller().push.subscribe({ projectId, subscription })
      expect(endpoints()).toHaveLength(1)
    })

    it('turning off forgets only that phone', async () => {
      addPushSubscription(ctx, phone('a'))
      addPushSubscription(ctx, phone('b'))

      await caller().push.unsubscribe({ projectId, endpoint: phone('a').endpoint })

      expect(endpoints()).toEqual([phone('b').endpoint])
    })
  })
})
