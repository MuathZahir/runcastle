import { createElement, type ReactElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import type { Feature } from '@runcastle/core'
import type { FeatureFull } from '../src/lib/api'

const store = vi.hoisted(() => ({ full: undefined as unknown }))

/** Every tRPC hook the Plan view calls: queries answer from `store`, nothing mutates. */
vi.mock('../src/trpc', () => {
  const query = (data: unknown) => ({ data, isLoading: false, error: null })
  return {
    trpc: {
      useUtils: () => ({}),
      docs: { read: { useQuery: (input: { relPath: string }) => query({ content: input.relPath === 'preview.html' ? '<!doctype html><p>the show</p>' : '# Decisions\n' }) } },
      feature: {
        get: { useQuery: () => query(store.full) },
        rounds: { useQuery: () => query([]) },
        endSession: { useMutation: () => ({ isPending: false, mutate: () => undefined }) },
      },
      settings: { get: { useQuery: () => query({ fields: [] }) } },
      ticket: {
        edit: { useMutation: () => ({ isPending: false, mutate: () => undefined }) },
        cancel: { useMutation: () => ({ isPending: false, mutate: () => undefined }) },
      },
    },
  }
})
vi.mock('../src/lib/live', () => ({ useLivePoll: () => false, useLiveStatus: () => 'live' }))
vi.mock('../src/lib/toast', () => ({ useToast: () => ({ push: () => undefined }) }))

const { PlanBody } = await import('../src/components/bodies/PlanBody')

const feature = { id: 'f1', projectId: 'p1', slug: 'x', title: 'X', status: 'active' } as Feature

function fullWith({ preview = null as FeatureFull['preview'], docs = ['decisions.md'] } = {}): FeatureFull {
  const full = {
    feature,
    tickets: [],
    sessions: [],
    runs: [],
    docs: docs.map((relPath) => ({ relPath, title: relPath })),
    preview,
    dependsOn: [],
    blocks: [],
  } as unknown as FeatureFull
  store.full = full
  return full
}

/**
 * React's generated ids follow a node's place among its siblings, so two
 * renders of the same body can differ in them without differing in a byte of
 * what is shown.
 */
const withoutIds = (html: string) => html.replace(/_R_\w+_/g, '_R_')
const markup = (element: ReactElement) => withoutIds(renderToStaticMarkup(element))
const plan = (full: FeatureFull) => markup(createElement(PlanBody, { full, onOpenDesign: () => undefined }))
const PREVIEW = { relPath: 'preview.html', updatedAt: Date.now() } as const

/** The bar's tabs, in order, the selected one marked `*`. */
function tabs(html: string): string[] {
  return [...html.matchAll(/<button[^>]*role="tab" aria-selected="(true|false)"[^>]*>(.*?)<\/button>/g)].map(
    ([, selected, inner]) => `${(inner ?? '').replace(/<[^>]+>/g, '')}${selected === 'true' ? '*' : ''}`,
  )
}

/**
 * the-feature-s-right-panel decisions 5, 6: the plan is three documents, so
 * the Plan view is one bar of tabs — Preview once one exists, then Decisions
 * and Spec — and the part on show fills the rest, never a doc in a dialog.
 */
describe('the Plan view', () => {
  it('leads with the preview once one exists, the decisions and the spec tabs beside it', () => {
    const html = plan(fullWith({ preview: PREVIEW, docs: ['brief.md', 'decisions.md', 'spec.md'] }))
    expect(tabs(html)).toEqual(['Preview*', 'Decisions', 'Spec'])
    expect(html).toContain('<iframe')
    expect(html).not.toContain('role="dialog"')
  })

  it('has no Preview tab before a preview exists, and reads the decisions as prose', () => {
    const html = plan(fullWith())
    expect(tabs(html)).toEqual(['Decisions*', 'Spec'])
    expect(html).not.toContain('<iframe')
    expect(html).toContain('>Decisions</h1>')
  })

  it('leads with the spec once it is written and no preview exists', () => {
    expect(tabs(plan(fullWith({ docs: ['decisions.md', 'spec.md'] })))).toEqual(['Decisions', 'Spec*'])
  })
})

