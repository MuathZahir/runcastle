// @vitest-environment happy-dom
import type { DependencyRef } from '@runcastle/core'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DependenciesRow } from '../src/components/workspace/FeatureDependencies'
import { dependencyCandidates } from '../src/lib/feature-ui'
import { listItem } from './fixtures'

/**
 * The draft's Waits-on row (ADR-0013 decision 4). Tier 2: what it is held to —
 * which ids each ✕ and pick send, what the picker offers, and that a refusal is
 * said on the page — only shows once it is clicked.
 */
function dep(slug: string, over: Partial<DependencyRef> = {}): DependencyRef {
  return {
    featureId: `feat_${slug}`,
    slug,
    title: `The ${slug} feature`,
    phase: 'building',
    status: 'active',
    satisfied: false,
    ...over,
  }
}

const AUTH = dep('auth')
const BILLING = dep('billing', { status: 'archived', phase: 'planning' })
const MERGED = dep('base', { status: 'shipped', phase: 'shipped', satisfied: true })

const PROJECT = [
  listItem({ id: 'me', slug: 'me', status: 'draft' }),
  listItem({ id: 'feat_auth', slug: 'auth' }),
  { ...listItem({ id: 'feat_search', slug: 'search', phase: 'planning' }), title: 'Search' },
  { ...listItem({ id: 'feat_done', slug: 'done', status: 'shipped', phase: 'shipped' }), title: 'Done' },
  { ...listItem({ id: 'feat_far', slug: 'far' }), projectId: 'proj_2', title: 'Far' },
]

function row(dependsOn: DependencyRef[], onChange = vi.fn(async (_ids: string[]) => undefined)) {
  render(
    <DependenciesRow
      isDraft
      dependsOn={dependsOn}
      candidates={dependencyCandidates(PROJECT, { id: 'me', projectId: 'proj_1' }, dependsOn)}
      onChange={onChange}
    />,
  )
  return onChange
}

describe('the Waits-on row', () => {
  afterEach(cleanup)

  it('shows each dependency with its state, and merged ones with no ✕', () => {
    row([AUTH, BILLING, MERGED])
    expect(screen.getByText('The auth feature')).toBeTruthy()
    expect(screen.getByText('building')).toBeTruthy()
    expect(screen.getByText('archived')).toBeTruthy()
    expect(screen.getByText('merged')).toBeTruthy()
    expect(screen.queryByLabelText('Stop waiting on base')).toBeNull()
  })

  it('removes one dependency by replacing the set without it', () => {
    const onChange = row([AUTH, BILLING, MERGED])
    fireEvent.click(screen.getByLabelText('Stop waiting on auth'))
    expect(onChange).toHaveBeenCalledWith(['feat_billing', 'feat_base'])
  })

  it('offers only same-project, unmerged, unchosen features other than itself, and adds the pick', () => {
    const onChange = row([AUTH])
    fireEvent.click(screen.getByRole('button', { name: 'Add' }))
    expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual(['Search'])
    fireEvent.click(screen.getByRole('option', { name: 'Search' }))
    expect(onChange).toHaveBeenCalledWith(['feat_auth', 'feat_search'])
  })

  it('says a refusal from the server beside the row, as plain text without its Markdown backticks', async () => {
    row([AUTH], vi.fn(async () => Promise.reject(new Error('that would form a cycle: `me` → `auth` → `me`'))))
    fireEvent.click(screen.getByLabelText('Stop waiting on auth'))
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('that would form a cycle: me → auth → me'))
  })

  it('says it waits on nothing when the set is empty, and still offers Add', () => {
    row([])
    expect(screen.getByText('nothing')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Add' })).toBeTruthy()
  })
})
