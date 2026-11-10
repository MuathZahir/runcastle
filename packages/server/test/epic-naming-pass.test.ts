import { existsSync } from 'node:fs'
import type { ThreadEvent } from '@runcastle/core'
import { epicNamingPassMarkerPath } from '@runcastle/core/paths'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { AppCtx } from '../src/db/types'
import { createSessionRow, setSessionTitle } from '../src/launcher/sessions'
import { cleanEpicName, namingPrompt, runEpicNamingPassOnce, type NameModel } from '../src/threads/epic-naming-pass'
import { readThreadEvents, seedThreadLog } from '../src/threads/log'
import { listThreads } from '../src/threads/read'
import { withTempDataDir } from './helpers/data-dir'
import { makeTestCtx } from './helpers/db'
import { rmTemp, seedFeature, seedProject, tmpRepo } from './helpers/fixtures'

/**
 * The one-off naming pass (orchestrator-chats-become-epics decision 13), with
 * the model stubbed: it names only the listed orchestrator chats nobody named,
 * as the orchestrator, ignores an odd answer, and runs once per install.
 */

const NOW = 1_800_000_000_000
const HOUR = 60 * 60 * 1000

let ctx: AppCtx
let projectId: string
let repoPath: string
let restoreDataDir: () => void

beforeEach(async () => {
  restoreDataDir = withTempDataDir()
  ctx = await makeTestCtx()
  repoPath = tmpRepo()
  projectId = seedProject(ctx, repoPath).id
})

afterEach(() => {
  restoreDataDir()
  rmTemp(repoPath)
})

let n = 0
/** An orchestrator chat whose human wrote `text` at `at`, with whatever else `extra` says. */
function chat(text: string, at: number, extra: Record<string, unknown>[] = []): string {
  const id = createSessionRow(ctx, { projectId, kind: 'project', worktreePath: repoPath }).id
  const events = [
    { type: 'prompt', id: `p${n++}`, text, source: 'human' },
    { type: 'title', title: `${text} (generated)` },
    ...extra,
  ].map((body, i) => ({ ...body, i, at })) as ThreadEvent[]
  seedThreadLog(id, events)
  return id
}

const titleOf = (id: string) => listThreads(ctx, { projectId }).find((t) => t.id === id)

function stub(answers: Record<string, string | Error>): NameModel & { prompts: string[] } {
  const prompts: string[] = []
  const model = async (prompt: string) => {
    prompts.push(prompt)
    const key = Object.keys(answers).find((k) => prompt.includes(k))
    const answer = key === undefined ? 'Something' : answers[key]
    if (answer instanceof Error) throw answer
    return answer ?? null
  }
  return Object.assign(model, { prompts })
}

describe('the epic naming pass', () => {
  it("names only listed chats nobody named, as the orchestrator's title", async () => {
    const recent = chat('people should pay with stripe', NOW - HOUR)
    const old = chat('an old question', NOW - 48 * HOUR)
    const holding = chat('the login rework', NOW - 48 * HOUR)
    seedFeature(ctx, projectId, { slug: 'login', heldBy: holding, status: 'active' })
    const epic = chat('already an epic', NOW - HOUR, [{ type: 'title', title: 'Search', by: 'orchestrator' }])
    const renamed = chat('the human named it', NOW - HOUR, [{ type: 'title', title: 'Mine', renamed: true }])
    const legacy = chat('renamed long ago', NOW - HOUR)
    setSessionTitle(ctx, legacy, 'Old rename')

    const model = stub({ stripe: 'Payment System', login: '"Login Rework."' })
    const logs: string[] = []
    const result = await runEpicNamingPassOnce(ctx, { model, now: NOW, log: (l) => logs.push(l) })

    expect(result).toEqual({ ran: true, named: 2, skipped: 0 })
    expect(model.prompts).toHaveLength(2)
    expect(readThreadEvents(recent).at(-1)).toMatchObject({ type: 'title', title: 'Payment System', by: 'orchestrator' })
    expect(titleOf(recent)).toMatchObject({ title: 'Payment System', epicNamed: true })
    expect(titleOf(holding)).toMatchObject({ title: 'Login Rework', epicNamed: true })
    for (const id of [old, epic, renamed, legacy]) expect(readThreadEvents(id).filter((e) => e.type === 'title')).toHaveLength(id === old || id === legacy ? 1 : 2)
    expect(titleOf(epic)?.title).toBe('Search')
    expect(titleOf(renamed)?.title).toBe('Mine')
    expect(logs).toEqual([])
  })

  it('gives the model only the title and the first messages, cut short', () => {
    const events = [1, 2, 3, 4].map((k) => ({ type: 'prompt', id: `q${k}`, text: `message ${k} ${'x'.repeat(600)}`, source: 'human', i: k, at: 0 }))
    const prompt = namingPrompt('A title', events as ThreadEvent[])
    expect(prompt).toContain('Title: A title')
    expect(prompt).toContain('message 1')
    expect(prompt).not.toContain('message 4')
    // The excerpt sits fenced as data between lines of ===.
    const excerpt = prompt.split('===\n')[1]?.split('\n===')[0] ?? ''
    expect(excerpt.startsWith('Title: A title')).toBe(true)
    expect(excerpt.length).toBeLessThanOrEqual(1500)
  })

  it('ignores an odd answer and a failed run, with one log line each', async () => {
    const odd = chat('the odd one', NOW - HOUR)
    const failed = chat('the failing one', NOW - HOUR)
    const logs: string[] = []
    const model = stub({ odd: 'Sure! Here is a name:\nPayment System', failing: new Error('could not launch claude') })

    expect(await runEpicNamingPassOnce(ctx, { model, now: NOW, log: (l) => logs.push(l) })).toEqual({ ran: true, named: 0, skipped: 2 })

    for (const id of [odd, failed]) expect(titleOf(id)).toMatchObject({ epicNamed: false })
    expect(logs).toHaveLength(2)
    expect(logs.some((l) => l.includes('could not launch claude'))).toBe(true)
    expect(logs.some((l) => l.includes('was not a name'))).toBe(true)
  })

  it('does nothing on a second start', async () => {
    chat('people should pay with stripe', NOW - HOUR)
    expect((await runEpicNamingPassOnce(ctx, { model: stub({}), now: NOW })).ran).toBe(true)
    expect(existsSync(epicNamingPassMarkerPath())).toBe(true)

    const later = chat('a newer chat', NOW - HOUR)
    const model = stub({})
    expect(await runEpicNamingPassOnce(ctx, { model, now: NOW })).toEqual({ ran: false, named: 0, skipped: 0 })
    expect(model.prompts).toEqual([])
    expect(titleOf(later)).toMatchObject({ epicNamed: false })
  })
})

describe('an answer as an epic name', () => {
  it.each([
    ['Payment System', 'Payment System'],
    ['  "Payment System."  ', 'Payment System'],
    ['**Feature Ownership**', 'Feature Ownership'],
    ['Monday Burn\n', 'Monday Burn'],
  ])('takes %j as %j', (answer, name) => expect(cleanEpicName(answer)).toBe(name))

  it.each(['', 'Here is a name:\nPayments', 'One two three four five', 'x'.repeat(41), 'Payments <script>'])('refuses %j', (answer) => {
    expect(cleanEpicName(answer)).toBeNull()
  })
})
