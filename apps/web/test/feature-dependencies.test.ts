import type { DependencyRef } from '@runcastle/core'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { BlocksLine, DependenciesRow } from '../src/components/workspace/FeatureDependencies'
import {
  dependencyCandidates,
  landingFeature,
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
    status: 'active',
    satisfied: false,
    upNext: false,
    ...over,
  }
}

const MERGED = dep('merged', { status: 'shipped', satisfied: true })
const ARCHIVED = dep('old', { status: 'archived' })

const draft = (id: string, dependsOn: DependencyRef[] = []) =>
  listItem({ id, status: 'draft', dependsOn })

const upNext = (id: string, dependsOn: DependencyRef[] = [], upNextProblem: string | null = null) =>
  listItem({ id, status: 'draft', dependsOn, upNext: true, upNextProblem })

describe('the rail chip of a backlog draft', () => {
  it('names the one dependency a draft is blocked by', () => {
    expect(rowChip(draft('d', [dep('auth')]))).toEqual({
      kind: 'draft',
      text: 'Blocked by auth',
      title: 'blocked by auth (in progress)',
    })
  })

  it('counts several, and lists them with their state in the tooltip', () => {
    const chip = rowChip(draft('d', [dep('auth'), ARCHIVED, MERGED]))
    expect(chip.text).toBe('Blocked by 2')
    expect(chip.title).toBe('blocked by auth (in progress), old (archived)')
  })

  it('says Ready to start once every dependency it had shipped', () => {
    expect(rowChip(draft('d', [MERGED])).text).toBe('Ready to start')
  })

  it('stays In the backlog when it never had a dependency', () => {
    expect(rowChip(draft('d')).text).toBe('In the backlog')
  })

  it('keeps every backlog draft in Backlog, never in Needs you', () => {
    for (const d of [draft('b', [dep('auth')]), draft('r', [MERGED]), draft('p'), draft('a', [ARCHIVED])]) {
      expect(triageOf(d)).toBe('drafts')
      expect(needsMe(d)).toBeNull()
    }
  })
})

describe('an Up next feature in the rail', () => {
  it('sits in its own lane and asks for nothing', () => {
    const f = upNext('u', [dep('auth')])
    expect(triageOf(f)).toBe('upNext')
    expect(needsMe(f)).toBeNull()
  })

  it('chips the one dependency it starts after, and says it starts by itself', () => {
    expect(rowChip(upNext('u', [dep('auth'), MERGED]))).toEqual({
      kind: 'draft',
      text: 'After auth',
      title: 'starts by itself when auth ships',
    })
  })

  it('counts several, listing them on hover', () => {
    const chip = rowChip(upNext('u', [dep('auth'), dep('chat')]))
    expect(chip.text).toBe('After 2')
    expect(chip.title).toBe('starts by itself when these ship: auth, chat')
  })

  it("warns that a dependency in the backlog won't move by itself", () => {
    const chip = rowChip(upNext('u', [dep('auth'), dep('idea', { status: 'draft' })]))
    expect(chip.title).toBe("starts by itself when these ship: auth, idea — won't start until you start idea")
  })

  it('does not warn about a dependency that is itself up next — it moves one step at a time', () => {
    const chip = rowChip(upNext('u', [dep('next', { status: 'draft', upNext: true })]))
    expect(chip.title).toBe('starts by itself when next ships')
  })
})

describe('a stuck Up next feature', () => {
  it('needs you when nothing is left to wait on', () => {
    const f = upNext('s', [MERGED])
    expect(triageOf(f)).toBe('needsYou')
    expect(needsMe(f)).toEqual({
      kind: 'stuck',
      label: 'nothing left to wait on — start it or move it to the backlog',
    })
    expect(rowChip(f).text).toBe('Needs you')
  })

  it('needs you when a dependency it waits on was archived', () => {
    const f = upNext('s', [dep('auth'), ARCHIVED])
    expect(triageOf(f)).toBe('needsYou')
    expect(needsMe(f)?.label).toBe('old was archived — remove it or move this to the backlog')
  })

  it("says why its automatic start didn't happen when the server recorded it", () => {
    const problem = "couldn't start by itself: its dependencies merged into different branches (main, develop)"
    expect(needsMe(upNext('s', [MERGED], problem))).toEqual({ kind: 'stuck', label: problem })
  })
})

describe('the lanes and order around Up next', () => {
  const list = [
    draft('b1', [dep('auth')]),
    draft('p1'),
    upNext('u1', [dep('auth')]),
    draft('b2', [ARCHIVED]),
    draft('r1', [MERGED]),
  ]

  it('orders Backlog ready-to-start, then parked, then blocked, otherwise keeping the incoming order', () => {
    const lane = triage(list).find((g) => g.key === 'drafts')
    expect(lane?.features.map((f) => f.id)).toEqual(['r1', 'p1', 'b1', 'b2'])
  })

  it('places Up next after the live-work lanes and before Backlog', () => {
    const groups = triage([
      ...list,
      upNext('stuck', [MERGED]),
      listItem({ id: 'working', activeRun: true }),
      listItem({ id: 'stopped' }),
      listItem({ id: 'shipped', status: 'shipped' }),
    ])
    expect(groups.map((g) => [g.key, g.label])).toEqual([
      ['needsYou', 'Needs you'],
      ['agentWorking', 'Agent working'],
      ['inProgress', 'In progress'],
      ['upNext', 'Up next'],
      ['drafts', 'Backlog'],
      ['shipped', 'Shipped'],
    ])
    expect(groups[0]!.features.map((f) => f.id)).toEqual(['stuck'])
    expect(groups[3]!.features.map((f) => f.id)).toEqual(['u1'])
  })

  it('sorts the same way in the flat sidebar order, still between active and shipped', () => {
    const sorted = sortForSidebar([
      listItem({ id: 'shipped', status: 'shipped' }),
      ...list,
      upNext('stuck', [MERGED]),
      listItem({ id: 'active' }),
    ])
    expect(sorted.map((f) => f.id)).toEqual(['stuck', 'active', 'u1', 'r1', 'p1', 'b1', 'b2', 'shipped'])
  })

  it('never lands you on an Up next feature when entering a project', () => {
    expect(landingFeature([upNext('u1', [dep('auth')]), draft('p1')])).toBeNull()
  })
})

describe('Start on a waiting draft', () => {
  const draftFull = (dependsOn: DependencyRef[]) => ({
    ...full({ status: 'draft' }),
    dependsOn,
  })

  it('is disabled with each blocker and its state, archived ones told to remove it', () => {
    const ns = nextStep(draftFull([dep('auth'), dep('idea', { status: 'draft' }), ARCHIVED]), {})
    expect(ns.primary?.kind).toBe('startDraft')
    expect(ns.primary?.disabled).toBe(
      'Waits on auth (in progress), idea (draft), old (archived — remove it to start)',
    )
  })

  it('outranks a missing base branch', () => {
    const ns = nextStep(draftFull([dep('auth')]), { draftBaseMissing: 'unpicked' })
    expect(ns.primary?.disabled).toBe('Waits on auth (in progress)')
  })

  it('behaves exactly as before once every dependency merged', () => {
    expect(nextStep(draftFull([MERGED]), {}).primary).toEqual({
      label: 'Start',
      kind: 'startDraft',
    })
    expect(nextStep(draftFull([MERGED]), { draftBaseMissing: 'loading' }).primary?.disabled).toBe(
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
      listItem({ id: 'other', slug: 'other' }),
      listItem({ id: 'parked', slug: 'parked', status: 'draft' }),
      listItem({ id: 'gone', slug: 'gone', status: 'archived' }),
      listItem({ id: 'done', slug: 'done', status: 'shipped' }),
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
    ...full({ status: 'draft', upNext }),
    dependsOn,
    upNextProblem,
  })

  it('offers Start when ready beside the disabled Start of a blocked backlog feature', () => {
    const ns = nextStep(unstarted([dep('auth')]), {})
    expect(ns.primary).toEqual({ label: 'Start', kind: 'startDraft', disabled: 'Waits on auth (in progress)' })
    const markUpNext = ns.secondary.find((a) => a.kind === 'markUpNext')
    expect(markUpNext?.label).toBe('Start when ready')
    expect(markUpNext?.disabled).toBeUndefined()
    expect(ns.note).toBe("Start when ready: starts by itself when auth ships; it can't be undone.")
  })

  it('says an up-next feature starts by itself, and offers Move to backlog', () => {
    const ns = nextStep(unstarted([dep('auth'), dep('ui'), MERGED], true), {})
    expect(ns.kick).toBe('UP NEXT')
    expect(ns.title).toBe('Starts by itself when auth and ui ship')
    expect(ns.desc).toContain('no tokens are spent')
    expect(ns.primary).toBeUndefined()
    expect(ns.secondary).toEqual([{ label: 'Move to backlog', kind: 'moveToBacklog' }])
  })

  it('says an up-next feature waiting on a backlog feature will not start until that one is started', () => {
    const idea = dep('idea', { status: 'draft' })
    const ns = nextStep(unstarted([dep('auth'), idea], true), {})
    expect(ns.title).toBe("Won't start until you start idea")
    expect(ns.secondary.map((a) => a.kind)).toEqual(['moveToBacklog'])
  })

  it('gives a stuck feature its reason, an enabled Start when nothing is left, and Move to backlog', () => {
    const ns = nextStep(unstarted([MERGED], true), {})
    expect(ns.alert).toBe(true)
    expect(ns.desc).toBe('Nothing left to wait on — start it or move it to the backlog')
    expect(ns.primary).toEqual({ label: 'Start', kind: 'startDraft' })
    expect(ns.secondary.map((a) => [a.kind, a.disabled])).toEqual([
      ['selfPlan', undefined],
      ['moveToBacklog', undefined],
    ])
  })

  it('prefers the server’s autostart problem as the stuck reason', () => {
    const problem = "didn't start by itself: its dependencies merged into different branches (a → main, b → dev) — pick a base and Start"
    const ns = nextStep(unstarted([MERGED], true, problem), { draftBaseMissing: 'unpicked' })
    expect(ns.desc).toBe('Its dependencies merged into different branches (a → main, b → dev) — pick a base and Start')
    expect(ns.primary?.disabled).toBe('pick a branch first')
    expect(upNextBasesDiffer(problem)).toBe(true)
    expect(upNextBasesDiffer("couldn't start by itself: git refused")).toBe(false)
    expect(upNextBasesDiffer(null)).toBe(false)
  })

  it('keeps Start disabled with the archived reason while an archived dependency remains', () => {
    const ns = nextStep(unstarted([ARCHIVED], true), {})
    expect(ns.desc).toBe('old was archived — remove it or move this to the backlog')
    expect(ns.primary?.disabled).toBe('Waits on old (archived — remove it to start)')
    expect(ns.secondary.map((a) => a.kind)).toContain('moveToBacklog')
  })

  it('leaves ready-to-start and plain backlog bars as they were', () => {
    for (const deps of [[MERGED], []]) {
      const ns = nextStep(unstarted(deps), {})
      expect(ns.title).toBe('Start this feature')
      expect(ns.primary).toEqual({ label: 'Start', kind: 'startDraft' })
      expect(ns.secondary).toEqual([{ label: 'Plan it yourself', kind: 'selfPlan' }])
      expect(ns.note).toBeUndefined()
    }
  })
})
