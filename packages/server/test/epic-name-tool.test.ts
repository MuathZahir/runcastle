import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { SessionRow } from '@runcastle/core'
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

    expect(toolNameEpic(ctx, chat, { name: '  Payment   System ' })).toEqual({ name: 'Payment System' })

    expect(await listed(chat.id)).toMatchObject({ title: 'Payment System', epicNamed: true, humanNamed: false })
    expect(readThreadEvents(chat.id).at(-1)).toMatchObject({ type: 'title', title: 'Payment System', by: 'orchestrator' })
  })

  it("refuses over the human's rename, naming it, and changes nothing", async () => {
    const chat = orchestratorChat()
    await createCallerFactory(appRouter)(ctx).thread.rename({ threadId: chat.id, title: 'Money stuff' })
    const before = readThreadEvents(chat.id).length

    expect(() => toolNameEpic(ctx, chat, { name: 'Payment System' })).toThrow(new GateError('The human named this chat "Money stuff"; keep it.'))

    expect(readThreadEvents(chat.id)).toHaveLength(before)
    expect(await listed(chat.id)).toMatchObject({ title: 'Money stuff', epicNamed: false, humanNamed: true })
  })

  it('refuses an empty or over-long name', () => {
    const chat = orchestratorChat()
    expect(() => toolNameEpic(ctx, chat, { name: '   ' })).toThrow(InvalidInputError)
    expect(() => toolNameEpic(ctx, chat, { name: 'x'.repeat(41) })).toThrow(InvalidInputError)
    expect(readThreadEvents(chat.id).filter((e) => e.type === 'title' && e.by)).toEqual([])
  })

  it("refuses a feature's lead", () => {
    const feature = seedFeature(ctx, projectId, { slug: 'pay' })
    const lead = createSessionRow(ctx, { kind: 'chat', featureId: feature.id, worktreePath: repoPath })
    expect(() => toolNameEpic(ctx, lead, { name: 'Payment System' })).toThrow(GateError)
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
