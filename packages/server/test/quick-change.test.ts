import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Ticket } from '@runcastle/core'
import { simpleGit } from 'simple-git'
import { beforeEach, describe, expect, it } from 'vitest'
import type { AppCtx } from '../src/db/types'
import { listAfter } from '../src/services/events'
import * as features from '../src/services/features'
import { checkGate } from '../src/services/gates'
import { scaffoldDocs } from '../src/services/knowledge'
import { openProject } from '../src/services/projects'
import { getFeatureRow } from '../src/services/repo'
import { listByFeature } from '../src/services/tickets'
import { createCallerFactory } from '../src/trpc/context'
import { appRouter } from '../src/trpc/router'
import { makeTestCtx } from './helpers/db'
import { seedFeature, seedProject, tmpRepo } from './helpers/fixtures'

/**
 * The quick-change door (decision 21): work too small to deserve a grill enters
 * as an ORDINARY feature born directly at `implementation` on lap 1, carrying
 * one ticket per sentence the human typed (decisions.md #4) — each ticket's
 * goal, and its sole acceptance criterion, being that sentence.
 *
 * Driven through the SERVICE and the tRPC proc (both are real seams here —
 * unlike `feature.rethink`, nothing in this path launches a terminal).
 */

/** A real git repo with a seed commit on `main` — branch creation needs one. */
async function gitRepo(): Promise<string> {
  const dir = tmpRepo()
  const g = simpleGit(dir)
  await g.init(['-b', 'main'])
  await g.addConfig('user.email', 'test@runcastle.dev')
  await g.addConfig('user.name', 'Runcastle Test')
  await g.addConfig('core.autocrlf', 'false')
  writeFileSync(join(dir, 'README.md'), 'base\n')
  await g.add(['README.md'])
  await g.commit('initial commit')
  return dir
}

const PROSE = 'Make the empty state darker — it washes out on the light theme.'

/**
 * The tickets the human typed. Every batch also closes with a review ticket
 * (decisions.md #9), which the tests above pin on its own — the ones below are
 * about what the typed sentences become, so they filter it out.
 */
function typedTickets(ctx: AppCtx, featureId: string): Ticket[] {
  return listByFeature(ctx, featureId).filter((t) => t.kind === 'implementation')
}

describe('quickChange service — a one-ticket feature born at implementation', () => {
  let ctx: AppCtx
  let repoPath: string
  let projectId: string

  beforeEach(async () => {
    ctx = await makeTestCtx()
    repoPath = await gitRepo()
    projectId = (await openProject(ctx, repoPath)).id
  })

  it('creates an active lap-1 feature at implementation on a real feature branch', async () => {
    const feature = await features.quickChange(ctx, {
      projectId,
      title: 'Darker empty state',
      tickets: [PROSE],
    })

    expect(feature.phase).toBe('implementation')
    expect(feature.lap).toBe(1)
    expect(feature.status).toBe('active')
    expect(feature.mapped).toBe(false)
    expect(feature.slug).toBe('darker-empty-state')
    expect(feature.branch).toBe('feature/darker-empty-state')
    expect(feature.baseBranch).toBe('main')

    // The row is what was stored, not just what was returned.
    const row = getFeatureRow(ctx, feature.id)
    expect(row.phase).toBe('implementation')
    expect(row.lap).toBe(1)

    // A real branch, forked off the resolved base.
    const branches = await simpleGit(repoPath).branchLocal()
    expect(branches.all).toContain('feature/darker-empty-state')
  })

  it('forks off an explicit base branch when one is given', async () => {
    const g = simpleGit(repoPath)
    await g.checkoutLocalBranch('release')
    await g.checkout('main')

    const feature = await features.quickChange(ctx, {
      projectId,
      title: 'Off release',
      tickets: [PROSE],
      baseBranch: 'release',
    })
    expect(feature.baseBranch).toBe('release')
  })

  it('falls back to the branch the checkout is standing on when none is given', async () => {
    await simpleGit(repoPath).checkoutLocalBranch('develop')

    const feature = await features.quickChange(ctx, {
      projectId,
      title: 'Off whatever we are on',
      tickets: [PROSE],
    })

    expect(feature.baseBranch).toBe('develop')
    expect(getFeatureRow(ctx, feature.id).baseBranch).toBe('develop')
  })

  /**
   * decisions.md #9 — "a review always runs". The tickets skill mandates a
   * review ticket per batch, but no agent emits tickets on this path, so the
   * invariant has to hold in the service or not at all.
   */
  it('closes the batch with a review ticket blocked by every typed one', async () => {
    const feature = await features.quickChange(ctx, {
      projectId,
      title: 'Three small things',
      tickets: ['Darken the empty state.', 'Fix the run chip.', 'Drop the lap chip.'],
    })

    const tickets = listByFeature(ctx, feature.id)
    // N typed in, N+1 stored.
    expect(tickets).toHaveLength(4)
    expect(tickets.slice(0, 3).every((t) => t.kind === 'implementation')).toBe(true)

    const review = tickets[3]
    expect(review.kind).toBe('review')
    expect(review.seq).toBe(4)
    expect(review.blockedBy).toEqual([1, 2, 3])
    expect(review.status).toBe('pending')
    expect(review.lap).toBe(1)
    expect(review.seams).toEqual([])
  })

  it('appends the review ticket to a one-sentence quick change too', async () => {
    const feature = await features.quickChange(ctx, {
      projectId,
      title: 'Darker empty state',
      tickets: [PROSE],
    })

    const tickets = listByFeature(ctx, feature.id)
    expect(tickets).toHaveLength(2)
    expect(tickets[1].kind).toBe('review')
    expect(tickets[1].blockedBy).toEqual([1])
  })

  /**
   * The prose is the whole deliverable of this ticket — it is what the review
   * agent is handed, and the quick door has no session to write it. It carries
   * the contract the tickets skill states: code review always, drive only when
   * there is something drivable, digest = the lap's summary.
   */
  it('gives the review ticket the contract prose the tickets skill mandates', async () => {
    const feature = await features.quickChange(ctx, {
      projectId,
      title: 'Darker empty state',
      tickets: [PROSE, 'Fix the run chip.'],
    })

    const review = listByFeature(ctx, feature.id)[2]
    expect(review.title).toBe('Review the integrated change')
    expect(review.goal).toContain('always')
    expect(review.goal).toContain('drive the app when the diff touches something a human can')
    expect(review.context).toContain('no spec.md or decisions.md')
    expect(review.context).toContain('let the code review stand alone')
    expect(review.context).toContain("Your digest is the lap's prose summary")
    // One criterion for the unconditional code review, then one per sentence
    // the human typed — the review agent walks them in order.
    expect(review.acceptanceCriteria).toEqual([
      "The branch's diff against its base is code-reviewed on both axes — the repo's own standards, and the change against what was asked for.",
      `Landed and does what it says: ${PROSE}`,
      'Landed and does what it says: Fix the run chip.',
    ])
  })

  it('carries one pending lap-1 ticket whose goal and criterion are the prose', async () => {
    const feature = await features.quickChange(ctx, {
      projectId,
      title: 'Darker empty state',
      tickets: [`  ${PROSE}  `],
    })

    const tickets = typedTickets(ctx, feature.id)
    expect(tickets).toHaveLength(1)
    expect(tickets[0]).toMatchObject({
      seq: 1,
      lap: 1,
      status: 'pending',
      // Titled from its own prose, not from the feature — see the multi-ticket
      // case below, where the feature's title would name all three the same.
      title: PROSE,
      goal: PROSE,
      context: PROSE,
      acceptanceCriteria: [PROSE],
      seams: [],
      blockedBy: [],
    })
  })

  it('stores one ticket per sentence, in order, all pending on lap 1', async () => {
    const feature = await features.quickChange(ctx, {
      projectId,
      title: 'Three small things',
      tickets: ['Darken the empty state.', 'Fix the run chip colour.', '   ', 'Drop the lap chip.'],
    })

    const tickets = typedTickets(ctx, feature.id)
    // The blank row the human left behind is not a ticket.
    expect(tickets).toHaveLength(3)
    expect(tickets.map((t) => t.seq)).toEqual([1, 2, 3])
    expect(tickets.map((t) => t.goal)).toEqual([
      'Darken the empty state.',
      'Fix the run chip colour.',
      'Drop the lap chip.',
    ])
    expect(tickets.every((t) => t.status === 'pending' && t.lap === 1)).toBe(true)
    expect(tickets[1].acceptanceCriteria).toEqual(['Fix the run chip colour.'])
    // Each is named by its own sentence, so the ledger says which is which.
    expect(tickets.map((t) => t.title)).toEqual([
      'Darken the empty state.',
      'Fix the run chip colour.',
      'Drop the lap chip.',
    ])
  })

  it('cuts a long first line down to a title while the goal keeps every word', async () => {
    const long =
      'The run chip stays grey after a cancelled run instead of going back to amber, which nobody notices until the next burn.'
    const feature = await features.quickChange(ctx, {
      projectId,
      title: 'Chip colour',
      tickets: [long],
    })

    const [ticket] = listByFeature(ctx, feature.id)
    expect(ticket.title.length).toBeLessThanOrEqual(73)
    expect(ticket.title.endsWith('…')).toBe(true)
    expect(long.startsWith(ticket.title.slice(0, -1))).toBe(true)
    expect(ticket.goal).toBe(long)
  })

  it('keeps the one-liner to one line while brief.md and the ticket carry it all', async () => {
    const multiline = `${PROSE}\n\nRepro: open a fresh project with no features.`
    const feature = await features.quickChange(ctx, {
      projectId,
      title: 'Darker empty state',
      tickets: [multiline],
    })

    // `oneLiner` feeds single-line consumers (the hook status line, the burner's
    // brief header), so it gets the first line only.
    expect(feature.oneLiner).toBe(PROSE)
    expect(listByFeature(ctx, feature.id)[0].goal).toBe(multiline)
    expect(
      readFileSync(join(repoPath, 'docs', 'features', feature.slug, 'brief.md'), 'utf8'),
    ).toContain('Repro: open a fresh project')
  })

  it('writes the prose verbatim into brief.md and creates no spec.md or decisions.md', async () => {
    const feature = await features.quickChange(ctx, {
      projectId,
      title: 'Darker empty state',
      tickets: [PROSE],
    })

    const dir = join(repoPath, 'docs', 'features', feature.slug)
    expect(readFileSync(join(dir, 'brief.md'), 'utf8')).toContain(PROSE)
    expect(existsSync(join(dir, 'spec.md'))).toBe(false)
    expect(existsSync(join(dir, 'decisions.md'))).toBe(false)
    expect(existsSync(join(dir, 'map.md'))).toBe(false)
  })

  it('gives each sentence its own numbered section of brief.md', async () => {
    const feature = await features.quickChange(ctx, {
      projectId,
      title: 'Three small things',
      tickets: ['Darken the empty state.', 'Drop the lap chip.'],
    })

    const brief = readFileSync(
      join(repoPath, 'docs', 'features', feature.slug, 'brief.md'),
      'utf8',
    )
    // Numbered to match the seqs the sentences were stored under, so the burner
    // reading the brief can tell which paragraph is which ticket.
    expect(brief).toBe(
      '# Three small things\n\n## Ticket 1\n\nDarken the empty state.\n\n## Ticket 2\n\nDrop the lap chip.\n',
    )
  })

  it('commits the scaffolded brief so the checkout stays clean', async () => {
    const feature = await features.quickChange(ctx, {
      projectId,
      title: 'Darker empty state',
      tickets: [PROSE],
    })

    const status = await simpleGit(repoPath).status()
    expect(status.isClean()).toBe(true)
    const log = await simpleGit(repoPath).log()
    expect(log.latest?.message).toContain(feature.slug)
  })

  it('emits a timeline that spells out the born-at-implementation path', async () => {
    const feature = await features.quickChange(ctx, {
      projectId,
      title: 'Darker empty state',
      tickets: [PROSE],
    })

    const events = listAfter(ctx, feature.id, 0)
    expect(events.map((e) => e.type)).toEqual([
      'feature.created',
      'docs.scaffolded',
      'tickets.stored',
      'feature.quick_change',
    ])
    const quick = events.find((e) => e.type === 'feature.quick_change')
    expect(quick?.message).toContain('born at implementation on lap 1')
    expect(quick?.message).toContain('one ticket (#1)')
    // Named apart from the tally: the review ticket is the pipeline's doing,
    // not one of the sentences the human typed.
    expect(quick?.message).toContain('plus a review ticket (#2)')
    expect(quick?.message).toContain('no grill session, no spec.md')
    expect(quick?.data).toMatchObject({ ticketSeqs: [1, 2], phase: 'implementation' })
  })

  it('names every ticket it was born with in that timeline entry', async () => {
    const feature = await features.quickChange(ctx, {
      projectId,
      title: 'Three small things',
      tickets: ['Darken the empty state.', 'Fix the run chip.', 'Drop the lap chip.'],
    })

    const quick = listAfter(ctx, feature.id, 0).find((e) => e.type === 'feature.quick_change')
    expect(quick?.message).toContain('3 tickets (#1, #2, #3) plus a review ticket (#4)')
    expect(quick?.data).toMatchObject({ ticketSeqs: [1, 2, 3, 4] })
  })

  it('leaves G1/G2 unevaluated and opens G3 on the single pending ticket', async () => {
    const feature = await features.quickChange(ctx, {
      projectId,
      title: 'Darker empty state',
      tickets: [PROSE],
    })
    const row = getFeatureRow(ctx, feature.id)

    // The feature starts past G1/G2, so the only gate ahead of it is G4 — the
    // G1/G2 checks are never reached. They would both fail if they were: there
    // is no decisions.md and no spec.md on disk.
    expect(checkGate(ctx, 'decisions-file-exists', row).satisfied).toBe(false)
    expect(checkGate(ctx, 'spec-file-exists', row).satisfied).toBe(false)

    // G3's precondition — what the Burn click needs — is satisfied by the one
    // pending lap-1 ticket.
    expect(checkGate(ctx, 'tickets-approved', row).satisfied).toBe(true)
  })

  it('deduplicates slugs against existing features, like create does', async () => {
    const first = await features.quickChange(ctx, { projectId, title: 'Tweak', tickets: [PROSE] })
    const second = await features.quickChange(ctx, { projectId, title: 'Tweak', tickets: [PROSE] })
    expect(first.slug).toBe('tweak')
    expect(second.slug).toBe('tweak-2')
  })

  it('refuses an all-blank list or a blank title, creating nothing', async () => {
    await expect(
      features.quickChange(ctx, { projectId, title: 'Empty', tickets: ['   ', ''] }),
    ).rejects.toThrow(/needs a sentence/)
    await expect(
      features.quickChange(ctx, { projectId, title: '  ', tickets: [PROSE] }),
    ).rejects.toThrow(/needs a title/)
    expect(features.list(ctx, projectId)).toHaveLength(0)
  })
})

describe('feature.quickChange proc', () => {
  let ctx: AppCtx

  beforeEach(async () => {
    ctx = await makeTestCtx()
  })

  it('is registered on the feature router and lands a burnable card', async () => {
    const projectId = (await openProject(ctx, await gitRepo())).id
    const caller = createCallerFactory(appRouter)(ctx)

    const feature = await caller.feature.quickChange({
      projectId,
      title: 'Darker empty state',
      tickets: [PROSE],
    })

    expect(feature.phase).toBe('implementation')
    const full = await caller.feature.get({ id: feature.id })
    // The typed sentence, plus the review ticket the batch always closes with —
    // what the ledger lists and what the next-step bar counts ("Burn 2 tickets").
    expect(full.tickets).toHaveLength(2)
    expect(full.tickets.map((t) => t.kind)).toEqual(['implementation', 'review'])
    expect(full.tickets.every((t) => t.status === 'pending')).toBe(true)
  })

  // The overlay's list door (decisions.md #4): several sentences, one card.
  it('lands every sentence of a multi-ticket quick change on one burnable card', async () => {
    const projectId = (await openProject(ctx, await gitRepo())).id
    const caller = createCallerFactory(appRouter)(ctx)

    const feature = await caller.feature.quickChange({
      projectId,
      title: 'Three small things',
      tickets: ['Darken the empty state.', 'Fix the run chip.', 'Drop the lap chip.'],
    })

    const full = await caller.feature.get({ id: feature.id })
    expect(full.feature.phase).toBe('implementation')
    expect(full.tickets.filter((t) => t.kind === 'implementation').map((t) => t.goal)).toEqual([
      'Darken the empty state.',
      'Fix the run chip.',
      'Drop the lap chip.',
    ])
    // Three sentences in, four cards out — the ledger's last is the review.
    expect(full.tickets).toHaveLength(4)
    expect(full.tickets[3].kind).toBe('review')
    expect(full.tickets.every((t) => t.status === 'pending')).toBe(true)
  })

  it('rejects an empty list, and a list with nothing but blanks in it', async () => {
    const projectId = (await openProject(ctx, await gitRepo())).id
    const caller = createCallerFactory(appRouter)(ctx)
    await expect(
      caller.feature.quickChange({ projectId, title: 'x', tickets: [] }),
    ).rejects.toThrow()
    await expect(
      caller.feature.quickChange({ projectId, title: 'x', tickets: ['  '] }),
    ).rejects.toThrow(/needs a sentence/)
  })
})

describe('scaffoldDocs brief override', () => {
  let ctx: AppCtx

  beforeEach(async () => {
    ctx = await makeTestCtx()
  })

  it('writes the given body verbatim instead of the generated stub', () => {
    const project = seedProject(ctx)
    const feature = seedFeature(ctx, project.id, { slug: 'briefed' })
    const body = '# Intake\n\nThree features fell out of the conversation; this is the first.'

    scaffoldDocs(ctx, feature, { brief: body })

    const brief = readFileSync(
      join(project.repoPath, 'docs', 'features', 'briefed', 'brief.md'),
      'utf8',
    )
    expect(brief).toBe(`${body}\n`)
    expect(brief).not.toContain('- Slug:')
  })

  it('falls back to the generated stub with no override (or a blank one)', () => {
    const project = seedProject(ctx)
    const feature = seedFeature(ctx, project.id, { slug: 'plain', title: 'Plain' })
    scaffoldDocs(ctx, feature)

    const brief = readFileSync(
      join(project.repoPath, 'docs', 'features', 'plain', 'brief.md'),
      'utf8',
    )
    expect(brief).toContain('# Plain')
    expect(brief).toContain('- Slug: plain')

    const blank = seedFeature(ctx, project.id, { slug: 'blank', title: 'Blank' })
    scaffoldDocs(ctx, blank, { brief: '   \n  ' })
    expect(
      readFileSync(join(project.repoPath, 'docs', 'features', 'blank', 'brief.md'), 'utf8'),
    ).toContain('- Slug: blank')
  })
})
