import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { DECIDED_WITHOUT_YOU_MARK, type Feature, type Project, readyToTestWhy, type ReviewFindingInput, type SessionRow } from '@runcastle/core'
import { simpleGit, type SimpleGit } from 'simple-git'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { AppCtx } from '../src/db/types'
import { GateError } from '../src/errors'
import { createSessionRow, getSessionRow, markSessionLive } from '../src/launcher/sessions'
import { toolCreateFeature, toolDeclareReady, toolGetFeatureContext } from '../src/mcp/server'
import { listAfter } from '../src/services/events'
import { __resetTestDriveState, createFeatureBranch } from '../src/services/git'
import { INVOLVEMENT_CHANGED, setEpicInvolvement, setInvolvement } from '../src/services/involvement'
import { openProject } from '../src/services/projects'
import { getFeatureRow } from '../src/services/repo'
import { reportFinding } from '../src/services/review-findings'
import { setWait, waitOf } from '../src/services/waits'
import { createAgentHost, setAgentHostForTests } from '../src/threads/host'
import { readThreadEvents, type AgentHost } from '../src/threads/types'
import { createCallerFactory } from '../src/trpc/context'
import { appRouter } from '../src/trpc/router'
import { getWorker } from '../src/workers/service'
import { withTempDataDir } from './helpers/data-dir'
import { makeTestCtx } from './helpers/db'
import { rmTemp, seedFeature, seedHostReview, seedProject, tmpRepo } from './helpers/fixtures'
import { createFakeAcp, FAKE_LAUNCH } from './support/fake-acp-agent'
import { promptsOf } from './support/thread-launch'

/**
 * "Involve me in" (`how-involved-am-i`): the one writer of a feature's level,
 * what its lead hears when the level changes, the tools that carry it, and
 * the "ready" that merges by itself at Nothing.
 */

let ctx: AppCtx
let host: AgentHost
let restoreDataDir: () => void

beforeEach(async () => {
  restoreDataDir = withTempDataDir()
  ctx = await makeTestCtx()
  host = createAgentHost({ ctx, transport: createFakeAcp().transport, launch: FAKE_LAUNCH })
  setAgentHostForTests(host)
})

afterEach(async () => {
  await host.stopAll('shutdown')
  setAgentHostForTests(undefined)
  restoreDataDir()
})

/** The feature's lead chat, with a conversation, so it can be told things. */
function leadOf(feature: Feature): SessionRow {
  const row = createSessionRow(ctx, { featureId: feature.id, kind: 'chat', worktreePath: '/wt' })
  markSessionLive(ctx, row.id, { ccSessionId: `cc-${row.id}` })
  return getSessionRow(ctx, row.id) as SessionRow
}

const notices = (threadId: string) => readThreadEvents(threadId).flatMap((e) => (e.type === 'notice' ? [e.text] : []))
const changes = (f: Feature) => listAfter(ctx, f.id, 0).filter((e) => e.type === INVOLVEMENT_CHANGED)

describe('setInvolvement', () => {
  let projectId: string
  beforeEach(() => {
    projectId = seedProject(ctx).id
  })

  it('is Everything for a new feature, and a change stores the level with one event', async () => {
    const f = seedFeature(ctx, projectId, { slug: 'cart' })
    expect(f.involvement).toBe('everything')

    const out = await setInvolvement(ctx, f.id, 'resultOnly')

    expect(out.involvement).toBe('resultOnly')
    expect(getFeatureRow(ctx, f.id).involvement).toBe('resultOnly')
    expect(changes(f)).toEqual([
      expect.objectContaining({ message: 'Involve me in: Result only', data: { from: 'everything', to: 'resultOnly' } }),
    ])
  })

  it('changes nothing and emits nothing for the level it already has', async () => {
    const f = seedFeature(ctx, projectId, { slug: 'cart', involvement: 'nothing' })
    await setInvolvement(ctx, f.id, 'nothing')
    expect(changes(f)).toEqual([])
  })

  it('is refused for a shipped or archived feature', async () => {
    for (const status of ['shipped', 'archived'] as const) {
      const f = seedFeature(ctx, projectId, { slug: `cart-${status}`, status })
      await expect(setInvolvement(ctx, f.id, 'nothing')).rejects.toThrow(GateError)
      expect(getFeatureRow(ctx, f.id).involvement).toBe('everything')
      expect(changes(f)).toEqual([])
    }
  })

  it('wakes a lead waiting on a question when the new level no longer asks, to decide it itself', async () => {
    const f = seedFeature(ctx, projectId, { slug: 'cart' })
    const lead = leadOf(f)
    setWait(ctx, lead.id, 'Which currency?', 'agent')

    await setInvolvement(ctx, f.id, 'designsAndResult')

    const [prompt] = promptsOf(lead.id)
    expect(promptsOf(lead.id)).toHaveLength(1)
    expect(prompt?.held).toBeUndefined()
    expect(prompt?.text).toContain('"Involve me in" to Designs and result')
    expect(prompt?.text).toContain('decide your open question yourself')
    expect(prompt?.text).toContain('keep waiting')
    expect(prompt?.text).toContain(DECIDED_WITHOUT_YOU_MARK)
    expect(prompt?.text).toContain('wait_for_you({ withdraw: true })')
    expect(prompt?.text).toContain('still waits for their yes')
  })

  it('tells a lead that is not waiting on a question as held news', async () => {
    const f = seedFeature(ctx, projectId, { slug: 'cart' })
    const lead = leadOf(f)

    await setInvolvement(ctx, f.id, 'nothing')

    const [prompt] = promptsOf(lead.id)
    expect(promptsOf(lead.id)).toHaveLength(1)
    expect(prompt?.held).toBe(true)
    expect(prompt?.text).toContain('"Involve me in" to Nothing. From now on:')
    expect(prompt?.text).not.toContain('decide your open question')
  })

  it('leaves a notice row in the lead’s chat naming the level and what it now means', async () => {
    const f = seedFeature(ctx, projectId, { slug: 'cart' })
    const lead = leadOf(f)

    await setInvolvement(ctx, f.id, 'resultOnly')
    await setInvolvement(ctx, f.id, 'everything')

    expect(notices(lead.id)).toEqual([
      'Involve me in: Result only · the lead decides its open questions and screens itself',
      'Involve me in: Everything · the lead asks you its open questions',
    ])
    // The row comes before the line the lead is sent.
    const kinds = readThreadEvents(lead.id).filter((e) => e.type === 'notice' || e.type === 'prompt').map((e) => e.type)
    expect(kinds.slice(0, 2)).toEqual(['notice', 'prompt'])
  })

  it('tells news, not a question, when the lead waits on a test drive or the new level still asks', async () => {
    const drive = seedFeature(ctx, projectId, { slug: 'drive' })
    const driveLead = leadOf(drive)
    setWait(ctx, driveLead.id, readyToTestWhy('checkout'), 'agent')
    await setInvolvement(ctx, drive.id, 'resultOnly')
    expect(promptsOf(driveLead.id).map((p) => p.held)).toEqual([true])

    const asks = seedFeature(ctx, projectId, { slug: 'asks', involvement: 'nothing' })
    const asksLead = leadOf(asks)
    setWait(ctx, asksLead.id, 'Which currency?', 'agent')
    await setInvolvement(ctx, asks.id, 'everything')
    expect(promptsOf(asksLead.id).map((p) => p.held)).toEqual([true])
    expect(waitOf(ctx, asksLead.id)?.why).toBe('Which currency?')
  })

  it('wakes a lead already waiting as Ready to test when the level becomes Nothing, to declare ready again', async () => {
    const f = seedFeature(ctx, projectId, { slug: 'cart', involvement: 'resultOnly' })
    const lead = leadOf(f)
    setWait(ctx, lead.id, readyToTestWhy('checkout'), 'agent')

    await setInvolvement(ctx, f.id, 'nothing')

    const [prompt] = promptsOf(lead.id)
    expect(promptsOf(lead.id)).toHaveLength(1)
    expect(prompt?.held).toBeUndefined()
    expect(prompt?.text).toContain('Call declare_ready again with the same scenario')
  })

  it('opens no chat for a feature whose lead never started, and still stores the level', async () => {
    const f = seedFeature(ctx, projectId, { slug: 'cart' })
    const never = createSessionRow(ctx, { featureId: f.id, kind: 'chat', worktreePath: '/wt' })

    await setInvolvement(ctx, f.id, 'resultOnly')

    expect(promptsOf(never.id)).toEqual([])
    expect(notices(never.id)).toEqual([])
    expect(getFeatureRow(ctx, f.id).involvement).toBe('resultOnly')
    expect(changes(f)).toHaveLength(1)
  })
})

describe('setEpicInvolvement', () => {
  it('sets every draft and active feature of the epic, each with its own event, and counts the changed ones', async () => {
    const projectId = seedProject(ctx).id
    const epic = createSessionRow(ctx, { projectId, kind: 'project', worktreePath: '/wt' })
    const other = createSessionRow(ctx, { projectId, kind: 'project', worktreePath: '/wt' })
    const a = seedFeature(ctx, projectId, { slug: 'a', chatId: epic.id })
    const draft = seedFeature(ctx, projectId, { slug: 'draft', chatId: epic.id, status: 'draft', baseBranch: null })
    const already = seedFeature(ctx, projectId, { slug: 'already', chatId: epic.id, involvement: 'resultOnly' })
    const shipped = seedFeature(ctx, projectId, { slug: 'shipped', chatId: epic.id, status: 'shipped' })
    const archived = seedFeature(ctx, projectId, { slug: 'archived', chatId: epic.id, status: 'archived' })
    const theirs = seedFeature(ctx, projectId, { slug: 'theirs', chatId: other.id })
    const lead = leadOf(a)

    expect(await setEpicInvolvement(ctx, epic.id, 'resultOnly')).toEqual({ changed: 2 })

    expect(getFeatureRow(ctx, a.id).involvement).toBe('resultOnly')
    expect(getFeatureRow(ctx, draft.id).involvement).toBe('resultOnly')
    for (const f of [shipped, archived, theirs]) expect(getFeatureRow(ctx, f.id).involvement, f.slug).toBe('everything')
    expect(changes(a)).toHaveLength(1)
    expect(changes(draft)).toHaveLength(1)
    expect(changes(already)).toHaveLength(0)
    expect(promptsOf(lead.id)).toHaveLength(1)
  })
})

describe('the tRPC procedures', () => {
  it('feature.setInvolvement and feature.setEpicInvolvement set the level that feature.get and feature.list carry', async () => {
    const projectId = seedProject(ctx).id
    const epic = createSessionRow(ctx, { projectId, kind: 'project', worktreePath: '/wt' })
    const a = seedFeature(ctx, projectId, { slug: 'a', chatId: epic.id })
    const b = seedFeature(ctx, projectId, { slug: 'b', chatId: epic.id })
    const caller = createCallerFactory(appRouter)(ctx)

    expect((await caller.feature.setInvolvement({ featureId: a.id, level: 'designsAndResult' })).involvement).toBe('designsAndResult')
    expect((await caller.feature.get({ id: a.id })).feature.involvement).toBe('designsAndResult')

    expect(await caller.feature.setEpicInvolvement({ chatId: epic.id, level: 'nothing' })).toEqual({ changed: 2 })
    const listed = await caller.feature.list({ projectId })
    expect(listed.map((f) => [f.slug, f.involvement])).toEqual(expect.arrayContaining([['a', 'nothing'], ['b', 'nothing']]))
    expect(b.involvement).toBe('everything')

    await expect(caller.feature.setInvolvement({ featureId: a.id, level: 'some' as never })).rejects.toThrow()
  })
})

describe('with a real repo', () => {
  let repoPath: string
  let g: SimpleGit
  let project: Project

  beforeEach(async () => {
    __resetTestDriveState()
    repoPath = tmpRepo()
    g = simpleGit(repoPath)
    await g.init(['-b', 'main'])
    await g.addConfig('user.email', 'test@runcastle.dev')
    await g.addConfig('user.name', 'Runcastle Test')
    await g.addConfig('core.autocrlf', 'false')
    writeFileSync(join(repoPath, 'README.md'), 'base\n')
    await g.add(['README.md'])
    await g.commit('initial commit')
    project = await openProject(ctx, repoPath)
  })

  afterEach(() => {
    __resetTestDriveState()
    rmTemp(repoPath)
  })

  describe('create_feature and get_feature_context', () => {
    it('create_feature stores the level and names it once in the brief', async () => {
      const orchestrator = createSessionRow(ctx, { projectId: project.id, kind: 'project', worktreePath: repoPath })
      const out = await toolCreateFeature(ctx, orchestrator, {
        title: 'Export CSV',
        oneLiner: 'export the table',
        brief: '# Export CSV\n\nThe table as a file.',
        involvement: 'resultOnly',
      })

      expect(getFeatureRow(ctx, out.id).involvement).toBe('resultOnly')
      const brief = await g.show([`feature/${out.slug}:docs/features/${out.slug}/brief.md`])
      expect(brief.match(/^Involve me in: Result only$/gm)).toHaveLength(1)
      expect(brief).not.toMatch(/Planning mode/)

      const again = await toolCreateFeature(ctx, orchestrator, {
        title: 'Import CSV',
        oneLiner: 'import a file',
        brief: '# Import CSV\n\nInvolve me in: Nothing',
        involvement: 'nothing',
      })
      const briefAgain = await g.show([`feature/${again.slug}:docs/features/${again.slug}/brief.md`])
      expect(briefAgain.match(/^Involve me in:/gm)).toHaveLength(1)
    })

    it('create_feature leaves a feature at Everything when no level is passed', async () => {
      const orchestrator = createSessionRow(ctx, { projectId: project.id, kind: 'project', worktreePath: repoPath })
      const out = await toolCreateFeature(ctx, orchestrator, { title: 'Dark mode', oneLiner: 'dark' })
      expect(getFeatureRow(ctx, out.id).involvement).toBe('everything')
    })

    it('get_feature_context carries the level and what it stops for', () => {
      const f = seedFeature(ctx, project.id, { slug: 'cart', involvement: 'nothing' })
      const lead = createSessionRow(ctx, { featureId: f.id, kind: 'chat', worktreePath: repoPath })
      expect(toolGetFeatureContext(ctx, lead).involvement).toEqual({
        level: 'nothing',
        label: 'Nothing',
        stopsFor: expect.stringContaining('runcastle merges it'),
      })
    })
  })

  describe('declare_ready at Nothing', () => {
    /** A started feature with a branch holding one commit, ready to merge. */
    async function mergeable(slug: string, overrides: Partial<Feature> = {}): Promise<Feature> {
      await createFeatureBranch(project, slug, 'main')
      await g.checkout(`feature/${slug}`)
      writeFileSync(join(repoPath, `${slug}.txt`), `${slug}\n`)
      await g.add([`${slug}.txt`])
      await g.commit(`feat: ${slug}`)
      await g.checkout('main')
      return seedFeature(ctx, project.id, { slug, ...overrides })
    }

    const defect = (title: string): ReviewFindingInput => ({
      kind: 'defect',
      severity: 'high',
      title,
      location: 'Settings',
      citation: 'spec.md',
      detail: 'Broken.',
      reproStep: 'Open it.',
    })

    it('merges the feature as runcastle, with no wait left on the lead', async () => {
      const f = await mergeable('export-csv', { involvement: 'nothing' })
      const lead = leadOf(f)

      const out = await toolDeclareReady(ctx, lead, { scenario: 'export' })

      expect(out).toMatchObject({ ok: true, need: null, autoMerge: { merged: true, base: 'main' } })
      expect(getFeatureRow(ctx, f.id).status).toBe('shipped')
      const shipped = listAfter(ctx, f.id, 0).find((e) => e.type === 'feature.shipped')
      expect(shipped?.data).toMatchObject({ base: 'main', mergedBy: 'runcastle' })
      expect((await g.raw(['ls-tree', '--name-only', 'main'])).split('\n')).toContain('export-csv.txt')
    })

    it('falls back to "Ready to test" with an open defect, and tells the lead why', async () => {
      const f = await mergeable('export-csv', { involvement: 'nothing' })
      const lead = leadOf(f)
      const review = seedHostReview(ctx, f, repoPath, 'handed-back')
      reportFinding(ctx, { featureId: f.id, reviewWorker: getWorker(ctx, review.id)!, input: defect('The export is empty') })

      const out = await toolDeclareReady(ctx, lead, { scenario: 'export' })

      expect(out.autoMerge).toEqual({ merged: false, why: expect.stringContaining('"The export is empty"') })
      expect(out.need?.why).toBe(readyToTestWhy('export'))
      expect(getFeatureRow(ctx, f.id).status).toBe('active')
      expect(listAfter(ctx, f.id, 0).some((e) => e.type === 'feature.shipped')).toBe(false)
      const told = promptsOf(lead.id).map((p) => p.text)
      expect(told).toEqual([expect.stringContaining('runcastle did not merge it: 1 review defect is still open')])
    })

    it('waits for the human as today below Nothing, without merging', async () => {
      const f = await mergeable('export-csv', { involvement: 'resultOnly' })
      const lead = leadOf(f)

      const out = await toolDeclareReady(ctx, lead, { scenario: 'export' })

      expect(out.autoMerge).toBeUndefined()
      expect(out.need?.why).toBe(readyToTestWhy('export'))
      expect(getFeatureRow(ctx, f.id).status).toBe('active')
    })
  })
})
