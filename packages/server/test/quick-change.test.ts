import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Feature, Ticket } from '@runcastle/core'
import { simpleGit } from 'simple-git'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { AppCtx } from '../src/db/types'
import { listAfter } from '../src/services/events'
import { featureDocsDir } from '../src/services/feature-docs'
import * as features from '../src/services/features'
import { scaffoldDocs } from '../src/services/knowledge'
import { openProject } from '../src/services/projects'
import { getFeatureRow, projectForFeature } from '../src/services/repo'
import { listByFeature } from '../src/services/tickets'
import { createCallerFactory } from '../src/trpc/context'
import { appRouter } from '../src/trpc/router'
import { useDataDir } from './helpers/data-dir'
import { makeTestCtx } from './helpers/db'
import { seedFeature, seedProject, tmpRepo } from './helpers/fixtures'

/**
 * The quick-change door (decision 21): work too small to deserve a grill enters
 * as an ORDINARY feature born at `planning` on lap 1 with its tickets already
 * written — one per sentence the human typed (decisions.md #4), each ticket's
 * goal and sole acceptance criterion being that sentence — so the only thing
 * left is the Burn click.
 *
 * Driven through the SERVICE and the tRPC proc (both are real seams here —
 * nothing in this path launches a terminal).
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

/**
 * Where a feature's docs actually live — the talk worktree, which creation cuts
 * so the scaffold can be committed onto `feature/<slug>` instead of onto
 * whatever branch the human's checkout happens to be standing on.
 */
function docsDir(ctx: AppCtx, feature: Feature): string {
  return featureDocsDir(projectForFeature(ctx, feature), feature)
}

/**
 * That worktree lives under the data dir, so every test in this file pins it at
 * a temp tree — otherwise a run writes worktrees into the developer's real
 * `~/.runcastle`.
 */
let dataHome: string
let restoreDataDir: () => void

beforeEach(() => {
  dataHome = tmpRepo()
  restoreDataDir = useDataDir(dataHome)
})

afterEach(() => {
  restoreDataDir()
  rmSync(dataHome, { recursive: true, force: true })
})

describe('quickChange service — a one-ticket feature born ready to burn', () => {
  let ctx: AppCtx
  let repoPath: string
  let projectId: string

  beforeEach(async () => {
    ctx = await makeTestCtx()
    repoPath = await gitRepo()
    projectId = (await openProject(ctx, repoPath)).id
  })

  it('creates an active lap-1 feature at planning on a real feature branch', async () => {
    const feature = await features.quickChange(ctx, {
      projectId,
      title: 'Darker empty state',
      tickets: [PROSE],
    })

    expect(feature.phase).toBe('planning')
    expect(feature.lap).toBe(1)
    expect(feature.status).toBe('active')
    expect(feature.mapped).toBe(false)
    expect(feature.slug).toBe('darker-empty-state')
    expect(feature.branch).toBe('feature/darker-empty-state')
    expect(feature.baseBranch).toBe('main')

    // The row is what was stored, not just what was returned.
    const row = getFeatureRow(ctx, feature.id)
    expect(row.phase).toBe('planning')
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
   * the contract the tickets skill states: one mode and not both, the drive when
   * there is something drivable and the gates otherwise, digest = the lap's
   * summary, led by the mode it ran in.
   */
  it('gives the review ticket the contract prose the tickets skill mandates', async () => {
    const feature = await features.quickChange(ctx, {
      projectId,
      title: 'Darker empty state',
      tickets: [PROSE, 'Fix the run chip.'],
    })

    const review = listByFeature(ctx, feature.id)[2]
    expect(review.title).toBe('Review the integrated change')
    expect(review.goal).toContain('in exactly one mode')
    expect(review.goal).toContain('a drive is available')
    expect(review.goal).toContain('otherwise run the verify gates')
    // The superseded contract: never "always the code review, and additionally
    // the drive" — that phrasing is what produced the reviews that did both.
    expect(review.goal).not.toContain('additionally')
    expect(review.context).toContain('no spec.md or decisions.md')
    expect(review.context).toContain('take the gates-and-diff mode')
    expect(review.context).toContain("Your digest is the lap's prose summary")
    expect(review.context).toContain('its first line names the mode you ran')
    // One criterion for the review itself — either mode satisfies it — then one
    // per sentence the human typed, which the review agent walks in order.
    expect(review.acceptanceCriteria).toEqual([
      "Reviewed in one mode — either walked in a browser, or put through the verify gates and code-reviewed on both axes (the repo's own standards, and the change against what was asked for).",
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
    expect(readFileSync(join(docsDir(ctx, feature), 'brief.md'), 'utf8')).toContain(
      'Repro: open a fresh project',
    )
  })

  it('writes the prose verbatim into brief.md and creates no spec.md or decisions.md', async () => {
    const feature = await features.quickChange(ctx, {
      projectId,
      title: 'Darker empty state',
      tickets: [PROSE],
    })

    const dir = docsDir(ctx, feature)
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

    const brief = readFileSync(join(docsDir(ctx, feature), 'brief.md'), 'utf8')
    // Numbered to match the seqs the sentences were stored under, so the burner
    // reading the brief can tell which paragraph is which ticket.
    expect(brief).toBe(
      '# Three small things\n\n## Ticket 1\n\nDarken the empty state.\n\n## Ticket 2\n\nDrop the lap chip.\n',
    )
  })

  it('commits the scaffolded brief onto the feature branch, leaving the checkout alone', async () => {
    const g = simpleGit(repoPath)
    const tipBefore = (await g.revparse(['HEAD'])).trim()

    const feature = await features.quickChange(ctx, {
      projectId,
      title: 'Darker empty state',
      tickets: [PROSE],
    })

    expect(
      await g.show([`feature/${feature.slug}:docs/features/${feature.slug}/brief.md`]),
    ).toContain(PROSE)
    // The human's checkout gained neither a commit nor an untracked doc.
    expect((await g.revparse(['HEAD'])).trim()).toBe(tipBefore)
    expect((await g.status()).isClean()).toBe(true)
  })

  it('emits a timeline that spells out the born-ready-to-burn path', async () => {
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
    expect(quick?.message).toContain('born at planning on lap 1')
    expect(quick?.message).toContain('one ticket (#1)')
    // Named apart from the tally: the review ticket is the machinery's doing,
    // not one of the sentences the human typed.
    expect(quick?.message).toContain('plus a review ticket (#2)')
    expect(quick?.message).toContain('no grill session, no spec.md')
    expect(quick?.data).toMatchObject({ ticketSeqs: [1, 2], phase: 'planning' })
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

  /**
   * The door the degenerate 14-ticket import came through, which had no
   * validation at all. It still has no refusal — these cases pin that the shape
   * is SAID, on the timeline, at the moment the rows are written.
   *
   * And that it is said only when there is something to say. The door builds
   * every ticket as `{ goal: prose, context: prose }`, so a per-ticket
   * goal-repeats-context line fired on every quick change ever made: a warning
   * that is on 100% of the time carries no information about the batch in front
   * of it, and the fix it named ("write a context that…") is not a field this
   * overlay has. A careful one-liner is now silent.
   */
  it('says nothing on the timeline about a well-formed one-sentence change', async () => {
    const feature = await features.quickChange(ctx, {
      projectId,
      title: 'Darker empty state',
      tickets: [PROSE],
    })

    expect(
      listAfter(ctx, feature.id, 0).filter((e) => e.type === 'tickets.shape_warning'),
    ).toEqual([])
    expect(getFeatureRow(ctx, feature.id).phase).toBe('planning')
    expect(typedTickets(ctx, feature.id)).toHaveLength(1)
  })

  it('calls a batch too big for the door what it is, and still creates the feature', async () => {
    const feature = await features.quickChange(ctx, {
      projectId,
      title: 'Fourteen small things',
      tickets: Array.from({ length: 6 }, (_, i) => `Change number ${i + 1} to something else.`),
    })

    const warning = listAfter(ctx, feature.id, 0).find((e) => e.type === 'tickets.shape_warning')
    expect(warning?.message).toContain('the burn is not blocked')
    expect(warning?.message).toContain('6 tickets (#1, #2, #3, #4, #5, #6) carry their goal as their context')
    expect(warning?.message).toContain('cut the batch to 5 tickets or fewer')
    // How many arrived at once is the whole signal — the door's construction is
    // not repeated back as a line per ticket underneath it.
    expect(warning?.data).toMatchObject({
      warnings: [{ code: 'degenerate-batch' }],
      seqs: [1, 2, 3, 4, 5, 6],
    })
    // …and the feature is created regardless: a warning is not a refusal.
    expect(typedTickets(ctx, feature.id)).toHaveLength(6)
  })

  it('names a pasted document for what it is', async () => {
    const pasted = `## Background\n\n${'the pasted wall of prose. '.repeat(70)}`
    const feature = await features.quickChange(ctx, {
      projectId,
      title: 'Pasted in',
      tickets: [pasted],
    })

    const warning = listAfter(ctx, feature.id, 0).find((e) => e.type === 'tickets.shape_warning')
    expect(warning?.data).toMatchObject({ warnings: [{ code: 'pasted-document' }] })
    expect(warning?.message).toContain('reads like a pasted document')
  })

  it('stays in planning with its tickets ready for Burn', async () => {
    const feature = await features.quickChange(ctx, {
      projectId,
      title: 'Darker empty state',
      tickets: [PROSE],
    })
    const row = getFeatureRow(ctx, feature.id)

    expect(row.phase).toBe('planning')
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

    expect(feature.phase).toBe('planning')
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
    expect(full.feature.phase).toBe('planning')
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
