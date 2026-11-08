import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Hono } from 'hono'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Feature, Project, SessionKind, SessionPurpose, SessionRow } from '@runcastle/core'
import type { AppCtx } from '../src/db/types'
import { GateError } from '../src/errors'
import { clearRuntimeCtx, setRuntimeCtx } from '../src/launcher/runtime'
import { createSessionRow } from '../src/launcher/sessions'
import {
  sessionAudience,
  toolDriveWorkerHandBack,
  toolRetryDrive,
  toolRunScenario,
  toolSetScenarioRunner,
  toolsForAudience,
} from '../src/mcp/server'
import hooksApp from '../src/routes/hooks'
import { agentSlots, resetAgentSlotsForTests } from '../src/services/agent-slots'
import { acpLaunchInput } from '../src/threads/launch'
import { isHostWorker } from '../src/workers/drive'
import { takeHostHandback } from '../src/workers/review'
import {
  dropWorker,
  getWorker,
  landWorker,
  listProjectWorkers,
  listWorkers,
  messageWorker,
  queueHoldOf,
  sendBackWorker,
  withWorkers,
  workersHoldingReady,
  workerTurnSlot,
} from '../src/workers/service'
import { withTempDataDir } from './helpers/data-dir'
import { makeTestCtx } from './helpers/db'
import { rmTemp, seedDriveWorker, seedFeature, seedHostReview, seedProject, tmpRepo } from './helpers/fixtures'

/**
 * Drive workers (drive-chats-become-workers, ticket 1): the Fix-drive and
 * Scenarios workers run on the host in the drive's checkout, owned by a
 * feature or the project, outside the agents-at-once slots, under the drive
 * chats' guards and tools, and out of reach of the lead's worker tools.
 */

let ctx: AppCtx
let repo: string
let project: Project
let feature: Feature
let restoreDataDir: () => void

beforeEach(async () => {
  restoreDataDir = withTempDataDir()
  ctx = await makeTestCtx()
  repo = tmpRepo()
  project = seedProject(ctx, repo)
  feature = seedFeature(ctx, project.id, { slug: 'drive-me' })
  setRuntimeCtx(ctx)
})

afterEach(() => {
  clearRuntimeCtx()
  resetAgentSlotsForTests()
  restoreDataDir()
  rmTemp(repo)
})

describe('owner', () => {
  it("lists a project drive's Scenarios worker with the project, never with a feature", () => {
    const own = seedDriveWorker(ctx, { project }, 'scenario', repo)
    const featureOwned = seedDriveWorker(ctx, { feature }, 'scenario', repo)
    expect(listProjectWorkers(ctx, project.id).map((w) => w.id)).toEqual([own.id])
    expect(listWorkers(ctx, feature.id).map((w) => w.id)).toEqual([featureOwned.id])
    expect(getWorker(ctx, own.id)).toMatchObject({ featureId: null, projectId: project.id })
  })
})

describe('host placement', () => {
  it('runs the drive review and both drive kinds on the host, and no other kind', () => {
    expect(isHostWorker({ kind: 'review', reviewMode: 'drive' })).toBe(true)
    expect(isHostWorker({ kind: 'fix-drive', reviewMode: null })).toBe(true)
    expect(isHostWorker({ kind: 'scenario', reviewMode: null })).toBe(true)
    expect(isHostWorker({ kind: 'review', reviewMode: 'gates' })).toBe(false)
    expect(isHostWorker({ kind: 'on-its-own', reviewMode: null })).toBe(false)
  })

  it.each([
    ['claude-code', 'bypassPermissions'],
    ['codex', undefined],
  ] as const)('launches a drive worker on %s in the project checkout with the drive-chat posture', async (runtime, mode) => {
    const session = seedDriveWorker(ctx, { feature }, 'fix-drive', '/elsewhere', { runtime })
    const input = await acpLaunchInput(ctx, session)
    expect(input.worktreePath).toBe(repo)
    expect(input.permissionMode).toBe(mode)
    expect(input.hostWorker?.briefing).toContain('Fix drive')
    expect(input.feature?.id).toBe(feature.id)
  })

  it("launches a project drive's Scenarios worker with no feature", async () => {
    const input = await acpLaunchInput(ctx, seedDriveWorker(ctx, { project }, 'scenario', repo))
    expect(input.worktreePath).toBe(repo)
    expect(input.feature).toBeUndefined()
    expect(input.hostWorker).toBeDefined()
  })

  it('routes a drive worker to the host transport, never a sandbox', async () => {
    const session = seedDriveWorker(ctx, { feature }, 'scenario', repo)
    const base = vi.fn(async () => ({}) as never)
    await withWorkers(ctx, base)({} as never, session)
    expect(base).toHaveBeenCalledOnce()
  })
})

describe('the agents-at-once slots', () => {
  it('gives a drive worker turn no slot, while a build worker turn takes one', () => {
    ctx.config = { ...ctx.config, burnConcurrency: 1 }
    const drive = seedDriveWorker(ctx, { feature }, 'fix-drive', repo)
    expect(workerTurnSlot(ctx)(drive)).toBeUndefined()
    const review = seedHostReview(ctx, feature, repo)
    expect(workerTurnSlot(ctx)(review)).toBeInstanceOf(Promise)
  })

  it('never holds a drive worker behind an account hold', () => {
    const drive = seedDriveWorker(ctx, { feature }, 'scenario', repo, { status: 'queued' })
    const review = seedHostReview(ctx, feature, repo, 'queued')
    agentSlots(ctx.config.burnConcurrency).hold('claude-code', 'usage limit')
    expect(queueHoldOf(ctx, getWorker(ctx, drive.id)!)).toBeNull()
    expect(queueHoldOf(ctx, getWorker(ctx, review.id)!)).toBe('usage limit')
  })
})

/** The guards' answers, as the hook route gives them, to one write and a set of shell commands. */
describe("the drive chats' guards", () => {
  let checkout: string

  beforeEach(() => {
    checkout = mkdtempSync(join(tmpdir(), 'rc-drive-worker-guard-'))
    const run = (...args: string[]) => execFileSync('git', args, { cwd: checkout, stdio: 'ignore' })
    run('init', '-q')
    mkdirSync(join(checkout, '.runcastle'))
    writeFileSync(join(checkout, '.runcastle', 'drive-setup.sh'), 'echo\n')
    writeFileSync(join(checkout, 'mine.ts'), 'x\n')
    run('add', 'mine.ts')
  })
  afterEach(() => rmSync(checkout, { recursive: true, force: true }))

  const calls = [
    { tool_name: 'Write', tool_input: { file_path: 'src/app.ts' } },
    { tool_name: 'Write', tool_input: { file_path: '.runcastle/drive-setup.sh' } },
    { tool_name: 'Write', tool_input: { file_path: '.runcastle/scenarios/a.ts' } },
    { tool_name: 'Edit', tool_input: { file_path: '.gitignore' } },
    { tool_name: 'Bash', tool_input: { command: 'bun install' } },
    { tool_name: 'Bash', tool_input: { command: 'git push origin main' } },
    { tool_name: 'Bash', tool_input: { command: 'git checkout main' } },
    { tool_name: 'Bash', tool_input: { command: 'git add -A' } },
    { tool_name: 'Bash', tool_input: { command: 'git add src/app.ts' } },
    { tool_name: 'Bash', tool_input: { command: 'git commit -m fix' } },
    { tool_name: 'Bash', tool_input: { command: 'git status' } },
  ]

  async function answers(session: SessionRow): Promise<unknown[]> {
    const app = new Hono()
    app.route('/api/hooks', hooksApp)
    const out: unknown[] = []
    for (const payload of calls) {
      const res = await app.request('/api/hooks/pre-tool', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sessionId: session.id, payload: { hook_event_name: 'PreToolUse', ...payload } }),
      })
      out.push(await res.json())
    }
    return out
  }

  const oldChat = (kind: SessionKind, owner: { featureId: string } | { projectId: string }, purpose?: SessionPurpose) =>
    createSessionRow(ctx, { ...owner, kind, worktreePath: checkout, ...(purpose ? { purpose } : {}) })

  it("guards a Fix-drive worker exactly as today's drive-fix chat", async () => {
    const today = await answers(oldChat('drive-fix', { featureId: feature.id }))
    expect(today.filter((a) => JSON.stringify(a).includes('"deny"')).length).toBeGreaterThan(3)
    expect(await answers(seedDriveWorker(ctx, { feature }, 'fix-drive', checkout))).toEqual(today)
  })

  it("guards a Scenarios worker exactly as today's scenario chat, on a feature or a project drive", async () => {
    expect(await answers(seedDriveWorker(ctx, { feature }, 'scenario', checkout))).toEqual(
      await answers(oldChat('scenario', { featureId: feature.id })),
    )
    expect(await answers(seedDriveWorker(ctx, { project }, 'scenario', checkout))).toEqual(
      await answers(oldChat('scenario', { projectId: project.id })),
    )
  })

  it('opens the whole checkout to a Scenarios worker in scenario setup mode, as today', async () => {
    const setup = await answers(seedDriveWorker(ctx, { project }, 'scenario', checkout, { purpose: 'scenario-setup' }))
    expect(setup).toEqual(await answers(oldChat('scenario', { projectId: project.id }, 'scenario-setup')))
    expect(setup[0]).toEqual({})
  })
})

describe('MCP tools', () => {
  it("offers a Fix-drive worker today's drive-fix tools plus hand_back", () => {
    const session = seedDriveWorker(ctx, { feature }, 'fix-drive', repo)
    expect(toolsForAudience(sessionAudience(ctx, session))).toEqual([
      'get_feature_context',
      'hand_back',
      'read_feature_doc',
      'record_event',
      'retry_drive',
      'show_file',
    ])
  })

  it('offers a Scenarios worker the scenario tools plus hand_back', () => {
    const session = seedDriveWorker(ctx, { project }, 'scenario', repo)
    expect(toolsForAudience(sessionAudience(ctx, session))).toEqual([
      'hand_back',
      'record_event',
      'run_scenario',
      'set_scenario_runner',
      'show_file',
    ])
  })

  it('lets the Fix-drive worker retry the drive, and no other worker', async () => {
    const fix = seedDriveWorker(ctx, { feature }, 'fix-drive', repo)
    const kindRefusal = /belongs to the Fix-drive worker/
    const tried = await toolRetryDrive(ctx, fix).catch((e: Error) => e)
    expect(tried instanceof Error ? tried.message : '').not.toMatch(kindRefusal)
    await expect(toolRetryDrive(ctx, seedDriveWorker(ctx, { feature }, 'scenario', repo))).rejects.toThrow(kindRefusal)
  })

  it('lets the Scenarios worker run scenarios and set the runner, and not the Fix-drive worker', async () => {
    const scenario = seedDriveWorker(ctx, { project }, 'scenario', repo)
    // Past the kind check: it stops only at there being no drive to run on.
    await expect(toolRunScenario(ctx, scenario, 'a.ts')).rejects.toThrow(/no longer running/)
    expect(toolSetScenarioRunner(ctx, scenario, 'bun {file}')).toEqual({ scenarioRunner: 'bun {file}' })
    const fix = seedDriveWorker(ctx, { feature }, 'fix-drive', repo)
    await expect(toolRunScenario(ctx, fix, 'a.ts')).rejects.toThrow(/belongs to the Scenarios worker/)
  })

  it("writes a drive worker's hand_back to the host handback file", () => {
    const session = seedDriveWorker(ctx, { feature }, 'scenario', repo)
    expect(toolDriveWorkerHandBack(ctx, session, { summary: '  Added login.ts on feature/drive-me  ' })).toEqual({ handedBack: true })
    expect(takeHostHandback(session.id)?.summary).toBe('Added login.ts on feature/drive-me')
    expect(() => toolDriveWorkerHandBack(ctx, seedHostReview(ctx, feature, repo), { summary: 'x' })).toThrow(GateError)
  })
})

describe("the lead's worker tools", () => {
  const reason = /drive worker: a drive worker commits straight onto the driven branch and only the human talks to it/

  it('refuses to land, send back, drop or message a drive worker', async () => {
    const id = seedDriveWorker(ctx, { feature }, 'fix-drive', repo, { status: 'handed-back' }).id
    await expect(landWorker(ctx, id)).rejects.toThrow(reason)
    await expect(sendBackWorker(ctx, id, 'again')).rejects.toThrow(reason)
    await expect(dropWorker(ctx, id)).rejects.toThrow(reason)
    await expect(messageWorker(ctx, id, 'hello')).rejects.toThrow(reason)
    expect(getWorker(ctx, id)?.status).toBe('handed-back')
  })

  it('never counts a drive worker as holding ready', () => {
    seedDriveWorker(ctx, { feature }, 'fix-drive', repo, { status: 'working' })
    seedDriveWorker(ctx, { feature }, 'scenario', repo, { status: 'handed-back' })
    expect(workersHoldingReady(ctx, feature.id)).toEqual([])
    const review = seedHostReview(ctx, feature, repo, 'working')
    expect(workersHoldingReady(ctx, feature.id).map((w) => w.id)).toEqual([review.id])
  })
})
