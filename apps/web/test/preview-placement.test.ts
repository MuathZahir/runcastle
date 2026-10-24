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
const { GrillBody } = await import('../src/components/bodies/grill/GrillBody')

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

/**
 * tickets-and-review-are-tools-not-phases decision 8: the Plan view leads with
 * the plan preview, the decisions and the spec one click away inside it; with
 * no preview yet, it is the decisions or the spec themselves.
 */
describe('the Plan view', () => {
  it('leads with the preview once one exists, the plan docs one click away above it', () => {
    const html = plan(fullWith({ preview: PREVIEW, docs: ['brief.md', 'decisions.md', 'spec.md'] }))
    expect(html).toContain('<iframe')
    expect(html).toContain('decisions.md</span></button>')
    expect(html).toContain('spec.md</span></button>')
    expect(html).not.toContain('brief.md</span></button>')
    expect(html.indexOf('spec.md</span></button>')).toBeLessThan(html.indexOf('<iframe'))
  })

  it('is the decisions or spec pane, exactly, before a preview exists', () => {
    const grill = fullWith()
    expect(plan(grill)).toBe(markup(createElement(GrillBody, { full: grill })))
    expect(plan(grill)).not.toContain('<iframe')
  })
})

