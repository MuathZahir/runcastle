import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { AppCtx } from '../src/db/types'
import { createSessionRow } from '../src/launcher/sessions'
import { createAgentHost, setAgentHostForTests } from '../src/threads/host'
import { listThreads } from '../src/threads/read'
import type { AgentHost } from '../src/threads/types'
import { makeTestCtx } from './helpers/db'
import { seedProject } from './helpers/fixtures'
import { createFakeAcp, FAKE_LAUNCH } from './support/fake-acp-agent'

let ctx: AppCtx
let host: AgentHost
let projectId: string

beforeEach(async () => {
  ctx = await makeTestCtx()
  projectId = seedProject(ctx).id
  host = createAgentHost({ ctx, transport: createFakeAcp({}).transport, launch: FAKE_LAUNCH, idleMs: 60_000 })
  setAgentHostForTests(host)
})

afterEach(async () => {
  await host.stopAll('shutdown')
  setAgentHostForTests(undefined)
})

describe('a new orchestrator chat in the thread list', () => {
  it('counts as written in once the human sent its first message (the sidebar keeps it listed)', async () => {
    const row = createSessionRow(ctx, { projectId, kind: 'project', worktreePath: '/wt' })
    // What `thread.send` does for a thread nobody has started: the kickoff held, then the human's words.
    await host.prompt(row.id, { text: 'kickoff' }, { source: 'runcastle', hold: true })
    await host.prompt(row.id, { text: 'hello' }, { source: 'human' })
    const entry = listThreads(ctx, { projectId }).find((t) => t.id === row.id)
    expect(entry?.lastHumanAt).toBeTypeOf('number')
  })
})
