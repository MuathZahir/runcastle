import type { DependencyRef } from '@runcastle/core'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { BlocksLine, DependenciesRow } from '../src/components/workspace/FeatureDependencies'
import {
  dependencyCandidates,
  needsMe,
  nextStep,
  rowChip,
  sortForSidebar,
  triage,
  triageOf,
  upNextBasesDiffer,
} from '../src/lib/feature-ui'
import { full, listItem } from './fixtures'

/**
 * Merge-order dependencies on the web (ADR-0013 decisions 4 and 6): what a
 * waiting draft says in the rail, where it sorts, and why its Start is off.
 */
function dep(slug: string, over: Partial<DependencyRef> = {}): DependencyRef {
  return {
    featureId: `feat_${slug}`,
    slug,
    title: slug,
    phase: 'building',
    status: 'active',
    satisfied: false,
    upNext: false,
    ...over,
  }
}

const MERGED = dep('merged', { phase: 'shipped', status: 'shipped', satisfied: true })
const ARCHIVED = dep('old', { phase: 'planning', status: 'archived' })

const draft = (id: string, dependsOn: DependencyRef[] = []) =>
  listItem({ id, status: 'draft', phase: 'planning', dependsOn })

describe('the rail chip of a draft', () => {
  it('names the one dependency a draft waits on', () => {
    expect(rowChip(draft('d', [dep('auth')]))).toEqual({
      kind: 'draft',
      text: 'Waits on auth',
      title: 'waits on auth (building)',
    })
  })

  it('counts several, and lists them with their state in the tooltip', () => {
    const chip = rowChip(draft('d', [dep('auth'), ARCHIVED, MERGED]))
    expect(chip.text).toBe('Waits on 2')
    expect(chip.title).toBe('waits on auth (building), old (archived)')
  })

  it('stays In the backlog when every dependency merged, or there are none', () => {
    expect(rowChip(draft('d', [MERGED])).text).toBe('In the backlog')
    expect(rowChip(draft('d')).text).toBe('In the backlog')
  })

  it('changes nothing about triage or needs-me', () => {
    const waiting = draft('d', [dep('auth')])
    expect(triageOf(waiting)).toBe('drafts')
    expect(needsMe(waiting)).toBeNull()
    expect(triageOf(draft('r', [MERGED]))).toBe('drafts')
    expect(needsMe(draft('r', [MERGED]))).toBeNull()
  })
})

describe('the drafts lane order', () => {
  const list = [
    draft('w1', [dep('auth')]),
    draft('r1'),
    draft('w2', [ARCHIVED]),
    draft('r2', [MERGED]),
  ]

  it('puts ready drafts above waiting ones, otherwise keeping the incoming order', () => {
    const lane = triage(list).find((g) => g.key === 'drafts')
    expect(lane?.features.map((f) => f.id)).toEqual(['r1', 'r2', 'w1', 'w2'])
  })

  it('sorts the same way in the flat sidebar order, still between active and shipped', () => {
    const sorted = sortForSidebar([
      listItem({ id: 'shipped', status: 'shipped', phase: 'shipped' }),
      ...list,
      listItem({ id: 'active', phase: 'building' }),
    ])
    expect(sorted.map((f) => f.id)).toEqual(['active', 'r1', 'r2', 'w1', 'w2', 'shipped'])
  })
})

describe('Start on a waiting draft', () => {
  const draftFull = (dependsOn: DependencyRef[]) => ({
    ...full({ status: 'draft', phase: 'planning' }),
    dependsOn,
  })

  it('is disabled with each blocker and its state, archived ones told to remove it', () => {
    const ns = nextStep(draftFull([dep('auth'), dep('idea', { status: 'draft', phase: 'planning' }), ARCHIVED]), {
      driving: false,
    })
    expect(ns.primary?.kind).toBe('startDraft')
    expect(ns.primary?.disabled).toBe(
      'Waits on auth (building), idea (draft), old (archived — remove it to start)',
    )
  })

  it('outranks a missing base branch', () => {
    const ns = nextStep(draftFull([dep('auth')]), { driving: false, draftBaseMissing: 'unpicked' })
    expect(ns.primary?.disabled).toBe('Waits on auth (building)')
  })

  it('behaves exactly as before once every dependency merged', () => {
    expect(nextStep(draftFull([MERGED]), { driving: false }).primary).toEqual({
      label: 'Start',
      kind: 'startDraft',
    })
    expect(nextStep(draftFull([MERGED]), { driving: false, draftBaseMissing: 'loading' }).primary?.disabled).toBe(
      'Loading the branch list…',
    )
  })
})

describe('the Waits-on picker’s candidates', () => {
  it('offers only same-project, unmerged features not already chosen and not itself', () => {
    const self = { id: 'me', projectId: 'proj_1' }
    const features = [
      listItem({ id: 'me', status: 'draft' }),
      listItem({ id: 'feat_auth', slug: 'auth' }),
      listItem({ id: 'other', slug: 'other', phase: 'planning' }),
      listItem({ id: 'parked', slug: 'parked', status: 'draft', phase: 'planning' }),
      listItem({ id: 'gone', slug: 'gone', status: 'archived', phase: 'building' }),
      listItem({ id: 'done', slug: 'done', status: 'shipped', phase: 'shipped' }),
      listItem({ id: 'old-done', slug: 'old-done', status: 'archived', phase: 'shipped' }),
      { ...listItem({ id: 'elsewhere' }), projectId: 'proj_2' },
    ]
    expect(dependencyCandidates(features, self, [dep('auth')]).map((f) => f.id)).toEqual([
      'other',
      'parked',
      'gone',
    ])
  })
})

describe('the read-only dependency lines', () => {
  const waitedOn = (dependsOn: DependencyRef[]) =>
    renderToStaticMarkup(
      createElement(DependenciesRow, {
        isDraft: false,
        dependsOn,
        candidates: [],
        onChange: async () => undefined,
      }),
    )

  it('states what a started feature waited on, with nothing to edit', () => {
    const html = waitedOn([MERGED, dep('auth', { title: 'Auth rework' })])
    expect(html).toContain('Waited on:')
    expect(html).toContain('Auth rework')
    expect(html).not.toContain('Stop waiting on')
    expect(html).not.toContain('Add')
  })

  it('renders nothing for a started feature that never waited', () => {
    expect(waitedOn([])).toBe('')
  })

  it('lists the drafts a feature blocks, each a link to its workspace', () => {
    const html = renderToStaticMarkup(
      createElement(BlocksLine, {
        featureId: 'feat_me',
        projectId: 'proj_1',
        blocks: [
          { featureId: 'a', slug: 'alpha', title: 'Alpha', upNext: false },
          { featureId: 'b', slug: 'beta', title: 'Beta', upNext: false },
        ],
      }),
    )
    expect(html).toContain('Blocks:')
    expect(html).toMatch(/<a [^>]*href="[^"]*alpha"[^>]*>alpha<\/a>,/)
    expect(html).toMatch(/<a [^>]*href="[^"]*beta"[^>]*>beta<\/a>/)
  })

  it('renders no Blocks line when nothing waits on the feature', () => {
    expect(renderToStaticMarkup(createElement(BlocksLine, { projectId: 'proj_1', featureId: 'feat_me', blocks: [] }))).toBe('')
  })

  it('splits the up-next dependents this merge starts from the backlog ones it blocks', () => {
    const html = renderToStaticMarkup(
      createElement(BlocksLine, {
        projectId: 'proj_1',
        featureId: 'feat_me',
        blocks: [
          { featureId: 'feat_y', slug: 'y', title: 'Y', upNext: true },
          { featureId: 'feat_w', slug: 'w', title: 'W', upNext: true },
          { featureId: 'feat_p', slug: 'parked', title: 'Parked', upNext: false },
        ],
        features: [
          listItem({ id: 'feat_y', slug: 'y', status: 'draft', dependsOn: [dep('me'), dep('z'), MERGED] }),
          listItem({ id: 'feat_w', slug: 'w', status: 'draft', dependsOn: [dep('me')] }),
        ],
      }),
    )
    const [starts, blocks] = html.split('Blocks:')
    expect(starts).toContain('Starts when this ships:')
    expect(starts).toMatch(/>y<\/a> \(also waits on z\),/)
    expect(starts).toMatch(/>w<\/a><\/span>/)
    expect(starts).not.toContain('parked')
    expect(blocks).toMatch(/>parked<\/a>/)
    expect(blocks).not.toMatch(/>y<\/a>/)
  })

  it('shows only the Starts line when every dependent is up next', () => {
    const html = renderToStaticMarkup(
      createElement(BlocksLine, {
        projectId: 'proj_1',
        featureId: 'feat_me',
        blocks: [{ featureId: 'feat_y', slug: 'y', title: 'Y', upNext: true }],
      }),
    )
    expect(html).toContain('Starts when this ships:')
    expect(html).not.toContain('Blocks:')
  })
})

describe('the up-next mark on an unstarted feature’s bar', () => {
  const unstarted = (dependsOn: DependencyRef[], upNext = false, upNextProblem: string | null = null) => ({
    ...full({ status: 'draft', phase: 'planning', upNext }),
    dependsOn,
    upNextProblem,
  })

  it('offers Start when ready beside the disabled Start of a blocked backlog feature', () => {
    const ns = nextStep(unstarted([dep('auth')]), { driving: false })
    expect(ns.primary).toEqual({ label: 'Start', kind: 'startDraft', disabled: 'Waits on auth (building)' })
    const markUpNext = ns.secondary.find((a) => a.kind === 'markUpNext')
    expect(markUpNext?.label).toBe('Start when ready')
    expect(markUpNext?.disabled).toBeUndefined()
    expect(ns.note).toBe("Start when ready: starts by itself when auth ships; it can't be undone.")
  })

  it('says an up-next feature starts by itself, and offers Move to backlog', () => {
    const ns = nextStep(unstarted([dep('auth'), dep('ui'), MERGED], true), { driving: false })
    expect(ns.kick).toBe('UP NEXT')
    expect(ns.title).toBe('Starts by itself when auth and ui ship')
    expect(ns.desc).toContain('no tokens are spent')
    expect(ns.primary).toBeUndefined()
    expect(ns.secondary).toEqual([{ label: 'Move to backlog', kind: 'moveToBacklog' }])
  })

  it('says an up-next feature waiting on a backlog feature will not start until that one is started', () => {
    const idea = dep('idea', { status: 'draft', phase: 'planning' })
    const ns = nextStep(unstarted([dep('auth'), idea], true), { driving: false })
    expect(ns.title).toBe("Won't start until you start idea")
    expect(ns.secondary.map((a) => a.kind)).toEqual(['moveToBacklog'])
  })

  it('gives a stuck feature its reason, an enabled Start when nothing is left, and Move to backlog', () => {
    const ns = nextStep(unstarted([MERGED], true), { driving: false })
    expect(ns.alert).toBe(true)
    expect(ns.desc).toBe('nothing left to wait on — start it or move it to the backlog')
    expect(ns.primary).toEqual({ label: 'Start', kind: 'startDraft' })
    expect(ns.secondary.map((a) => [a.kind, a.disabled])).toEqual([
      ['selfPlan', undefined],
      ['moveToBacklog', undefined],
    ])
  })

  it('prefers the server’s autostart problem as the stuck reason', () => {
    const problem = "didn't start by itself: its dependencies merged into different branches (a → main, b → dev) — pick a base and Start"
    const ns = nextStep(unstarted([MERGED], true, problem), { driving: false, draftBaseMissing: 'unpicked' })
    expect(ns.desc).toBe(problem)
    expect(ns.primary?.disabled).toBe('pick a branch first')
    expect(upNextBasesDiffer(problem)).toBe(true)
    expect(upNextBasesDiffer("couldn't start by itself: git refused")).toBe(false)
    expect(upNextBasesDiffer(null)).toBe(false)
  })

  it('keeps Start disabled with the archived reason while an archived dependency remains', () => {
    const ns = nextStep(unstarted([ARCHIVED], true), { driving: false })
    expect(ns.desc).toBe('old was archived — remove it or move this to the backlog')
    expect(ns.primary?.disabled).toBe('Waits on old (archived — remove it to start)')
    expect(ns.secondary.map((a) => a.kind)).toContain('moveToBacklog')
  })

  it('leaves ready-to-start and plain backlog bars as they were', () => {
    for (const deps of [[MERGED], []]) {
      const ns = nextStep(unstarted(deps), { driving: false })
      expect(ns.title).toBe('Start this feature')
      expect(ns.primary).toEqual({ label: 'Start', kind: 'startDraft' })
      expect(ns.secondary).toEqual([{ label: 'Plan it yourself', kind: 'selfPlan' }])
      expect(ns.note).toBeUndefined()
    }
  })
})
