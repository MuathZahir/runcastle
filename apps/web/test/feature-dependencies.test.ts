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

  it('stays Draft when every dependency merged, or there are none', () => {
    expect(rowChip(draft('d', [MERGED])).text).toBe('Draft')
    expect(rowChip(draft('d')).text).toBe('Draft')
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
        projectId: 'proj_1',
        blocks: [
          { featureId: 'a', slug: 'alpha', title: 'Alpha' },
          { featureId: 'b', slug: 'beta', title: 'Beta' },
        ],
      }),
    )
    expect(html).toContain('Blocks:')
    expect(html).toMatch(/<a [^>]*href="[^"]*alpha"[^>]*>alpha<\/a>,/)
    expect(html).toMatch(/<a [^>]*href="[^"]*beta"[^>]*>beta<\/a>/)
  })

  it('renders no Blocks line when nothing waits on the feature', () => {
    expect(renderToStaticMarkup(createElement(BlocksLine, { projectId: 'proj_1', blocks: [] }))).toBe('')
  })
})
