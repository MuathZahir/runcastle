import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { EPIC_ICON_IDS, type SessionRow } from '@runcastle/core'
import { events } from '../src/db/schema'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { simpleGit } from 'simple-git'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { AppCtx } from '../src/db/types'
import { GateError, InvalidInputError } from '../src/errors'
import { clearRuntimeCtx, setRuntimeCtx } from '../src/launcher/runtime'
import { createSessionRow, getSessionRow, markSessionLive } from '../src/launcher/sessions'
import { toolNameEpic } from '../src/mcp/orchestrator-tools'
import { buildMcpServer, toolsForAudience, type McpAudience } from '../src/mcp/server'
import { openProject } from '../src/services/projects'
import { appendThreadEvent, readThreadEvents } from '../src/threads/types'
import { createCallerFactory } from '../src/trpc/context'
import { appRouter } from '../src/trpc/router'
import { withTempDataDir } from './helpers/data-dir'
import { makeTestCtx } from './helpers/db'
import { rmTemp, seedFeature, tmpRepo } from './helpers/fixtures'

/** `name_epic` (orchestrator-chats-become-epics decision 12): an orchestrator names its own chat, never over the human's rename. */

let ctx: AppCtx
let repoPath: string
let projectId: string
let restoreDataDir: () => void

beforeEach(async () => {
  restoreDataDir = withTempDataDir()
  ctx = await makeTestCtx()
  repoPath = tmpRepo()
  const g = simpleGit(repoPath)
  await g.init(['-b', 'main'])
  await g.addConfig('user.email', 'test@runcastle.dev')
  await g.addConfig('user.name', 'Runcastle Test')
  writeFileSync(join(repoPath, 'README.md'), 'base\n')
  await g.add(['README.md'])
  await g.commit('initial commit')
  projectId = (await openProject(ctx, repoPath)).id
  setRuntimeCtx(ctx)
})

afterEach(() => {
  clearRuntimeCtx()
  restoreDataDir()
  rmTemp(repoPath)
})

function orchestratorChat(): SessionRow {
  const row = createSessionRow(ctx, { projectId, kind: 'project', worktreePath: repoPath })
  markSessionLive(ctx, row.id, { ccSessionId: `cc-${row.id}` })
  appendThreadEvent(row.id, { type: 'prompt', id: 'p1', text: 'I want people to pay with Stripe', source: 'human' })
  appendThreadEvent(row.id, { type: 'title', title: 'Adding Stripe payments to the checkout page' })
  return getSessionRow(ctx, row.id) as SessionRow
}

/** The look events emitted for a chat, oldest first. */
const lookEvents = (sessionId: string) =>
  ctx.db
    .select()
    .from(events)
    .all()
    .filter((e) => e.type.startsWith('session.epic_') && (e.data as { sessionId?: string } | null)?.sessionId === sessionId)

const listed = async (id: string) =>
  (await createCallerFactory(appRouter)(ctx).thread.list({ projectId })).find((t) => t.id === id)

async function toolNames(audience: McpAudience): Promise<string[]> {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  const client = new Client({ name: 'epic-test', version: '1' })
  await Promise.all([buildMcpServer(audience).connect(serverTransport), client.connect(clientTransport)])
  const { tools } = await client.listTools()
  await client.close()
  return tools.map((t) => t.name)
}

describe('name_epic', () => {
  it("names the orchestrator's chat on the chat list, and says the orchestrator named it", async () => {
    const chat = orchestratorChat()
    expect(await listed(chat.id)).toMatchObject({ title: 'Adding Stripe payments to the checkout page', epicNamed: false, humanNamed: false })

    expect(toolNameEpic(ctx, chat, { name: '  Payment   System ', icon: 'credit-card' })).toMatchObject({ name: 'Payment System', nameApplied: true, icon: 'credit-card', iconApplied: true })

    expect(await listed(chat.id)).toMatchObject({ title: 'Payment System', epicNamed: true, humanNamed: false, icon: 'credit-card' })
    expect(readThreadEvents(chat.id).at(-1)).toMatchObject({ type: 'title', title: 'Payment System', by: 'orchestrator' })
    expect(lookEvents(chat.id).map((e) => e.type)).toEqual(['session.epic_icon_named'])
  })

  it("keeps the human's rename, still sets the icon, and says so", async () => {
    const chat = orchestratorChat()
    await createCallerFactory(appRouter)(ctx).thread.rename({ threadId: chat.id, title: 'Money stuff' })
    const before = readThreadEvents(chat.id).length

    const out = toolNameEpic(ctx, chat, { name: 'Payment System', icon: 'credit-card' })
    expect(out).toMatchObject({ name: 'Money stuff', nameApplied: false, icon: 'credit-card', iconApplied: true })
    expect(out.note).toContain('The human named this chat "Money stuff"; keep it.')

    expect(readThreadEvents(chat.id)).toHaveLength(before)
    expect(await listed(chat.id)).toMatchObject({ title: 'Money stuff', epicNamed: false, humanNamed: true, icon: 'credit-card' })
  })

  it("never changes an icon the human picked, and still names the chat", async () => {
    const chat = orchestratorChat()
    await createCallerFactory(appRouter)(ctx).thread.setLook({ threadId: chat.id, icon: 'bug' })

    const out = toolNameEpic(ctx, chat, { name: 'Payment System', icon: 'credit-card' })
    expect(out).toMatchObject({ name: 'Payment System', nameApplied: true, icon: 'bug', iconApplied: false })
    expect(await listed(chat.id)).toMatchObject({ title: 'Payment System', icon: 'bug', iconByHuman: true })
    expect(lookEvents(chat.id).map((e) => e.type)).toEqual(['session.epic_look_set'])
  })

  it('refuses, changing nothing, when the human set both the name and the icon', async () => {
    const chat = orchestratorChat()
    const caller = createCallerFactory(appRouter)(ctx)
    await caller.thread.rename({ threadId: chat.id, title: 'Money stuff' })
    await caller.thread.setLook({ threadId: chat.id, icon: 'bug' })
    expect(() => toolNameEpic(ctx, chat, { name: 'Payment System', icon: 'credit-card' })).toThrow(GateError)
    expect(await listed(chat.id)).toMatchObject({ title: 'Money stuff', icon: 'bug' })
  })

  it('refuses an icon outside the curated ids, changing nothing', async () => {
    const chat = orchestratorChat()
    expect(() => toolNameEpic(ctx, chat, { name: 'Payment System', icon: 'unicorn' })).toThrow(InvalidInputError)
    expect(readThreadEvents(chat.id).filter((e) => e.type === 'title' && e.by)).toEqual([])
    expect((await listed(chat.id))?.icon).toBeUndefined()
  })

  it('refuses an unknown icon at the MCP boundary too: the input is an enum of the curated ids', async () => {
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
    const client = new Client({ name: 'epic-test', version: '1' })
    await Promise.all([buildMcpServer('project').connect(serverTransport), client.connect(clientTransport)])
    const { tools } = await client.listTools()
    await client.close()
    const schema = tools.find((t) => t.name === 'name_epic')?.inputSchema as { required?: string[]; properties?: Record<string, { enum?: string[] }> }
    expect(schema.required).toEqual(expect.arrayContaining(['name', 'icon']))
    expect(schema.properties?.icon?.enum).toEqual([...EPIC_ICON_IDS])
  })

  it('refuses an empty or over-long name', () => {
    const chat = orchestratorChat()
    expect(() => toolNameEpic(ctx, chat, { name: '   ', icon: 'rocket' })).toThrow(InvalidInputError)
    expect(() => toolNameEpic(ctx, chat, { name: 'x'.repeat(41), icon: 'rocket' })).toThrow(InvalidInputError)
    expect(readThreadEvents(chat.id).filter((e) => e.type === 'title' && e.by)).toEqual([])
  })

  it("refuses a feature's lead", () => {
    const feature = seedFeature(ctx, projectId, { slug: 'pay' })
    const lead = createSessionRow(ctx, { kind: 'chat', featureId: feature.id, worktreePath: repoPath })
    expect(() => toolNameEpic(ctx, lead, { name: 'Payment System', icon: 'rocket' })).toThrow(GateError)
  })

  it('is offered to orchestrator sessions only', async () => {
    expect(await toolNames('project')).toContain('name_epic')
    // Retired kinds (old drive chats) get every tool by design; the call-time gate refuses them.
    for (const audience of ['chat', 'side', 'worker', 'review', 'fix-drive-worker', 'scenario-worker'] as const) {
      expect(toolsForAudience(audience), audience).not.toContain('name_epic')
    }
    expect(await toolNames('chat')).not.toContain('name_epic')
  })
})
