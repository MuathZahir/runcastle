// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import type { ReviewPackage } from '@runcastle/core'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ReviewPackageCard } from '../src/components/review/ReviewPackageCard'
import { ReviewPackagePage } from '../src/components/review/ReviewPackagePage'
import { packageBuild, packageHolds, packageStops } from '../src/lib/feature-ui/review-package'
import { atWidth } from './phone-width'

vi.mock('../src/components/Markdown', () => ({ Markdown: ({ source }: { source: string }) => <p>{source}</p> }))

const finding = (over: Partial<ReviewPackage['findings'][number]>): ReviewPackage['findings'][number] => ({
  id: 'f1',
  kind: 'defect',
  severity: 'high',
  title: 'The table is cut off',
  location: 'The exported PDF',
  citation: 'Spec line',
  detail: 'Two columns are missing.',
  reproStep: 'Export at A5.',
  ...over,
})

const pack = (over: Partial<ReviewPackage> = {}): ReviewPackage => ({
  ticketId: 't1',
  featureId: 'f1',
  seq: 3,
  round: 2,
  passKind: 'review',
  verdict: 'Notes export to PDF.',
  account: 'The long account.',
  commitsSince: 0,
  hasWalkthrough: true,
  groups: [
    {
      id: 'g1',
      name: 'A note',
      shots: [
        { id: 's1', src: 'data:,1', caption: 'The dialog' },
        { id: 's2', src: 'data:,2', caption: 'The PDF' },
      ],
      calls: [],
    },
  ],
  findings: [finding({}), finding({ id: 'f2', kind: 'observation', severity: 'low', title: 'Spacing is loose', detail: 'Rows sit far apart.', reproStep: '' })],
  empty: null,
  ...over,
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('what a package says about itself', () => {
  it('says what it holds, and how it stands against the branch', () => {
    expect(packageHolds(pack())).toBe('2 screenshots · walkthrough · 1 defect')
    expect(packageBuild(pack())).toBe('This build')
    expect(packageBuild(pack({ commitsSince: 1 }))).toBe('1 commit behind')
    expect(packageBuild(pack({ commitsSince: null }))).toBeNull()
  })

  it('lists one findings stop, however many findings', () => {
    expect(packageStops(pack()).map((stop) => stop.kind)).toEqual(['video', 'findings', 'shot', 'shot'])
  })
})

describe('the card', () => {
  it('opens from anywhere on it', () => {
    const onOpen = vi.fn()
    render(<ReviewPackageCard pack={pack()} onOpen={onOpen} />)
    fireEvent.click(screen.getByRole('button', { name: 'Open the review package' }))
    expect(onOpen).toHaveBeenCalledOnce()
  })

  it('says why a pass that drove has no pictures', () => {
    render(<ReviewPackageCard pack={pack({ groups: [], findings: [], empty: 'The review took no screenshots.' })} onOpen={() => undefined} />)
    expect(screen.getByRole('button').textContent).toContain('walkthrough · The review took no screenshots.')
  })
})

describe('the page', () => {
  const open = (p = pack()) => render(<ReviewPackagePage pack={p} walkthrough={<div>the video</div>} onClose={() => undefined} />)
  const stage = () => within(screen.getByRole('region', { name: 'In front' }))

  it('opens on the first picture and steps through everything', () => {
    open()
    expect(stage().getByText('3 of 4')).toBeTruthy()
    expect(stage().getByRole('img', { name: 'The dialog' })).toBeTruthy()
    fireEvent.click(stage().getByRole('button', { name: 'Next' }))
    expect(stage().getByRole('img', { name: 'The PDF' })).toBeTruthy()
    fireEvent.keyDown(window, { key: 'ArrowLeft' })
    fireEvent.keyDown(window, { key: 'ArrowLeft' })
    expect(stage().getByText('2 of 4')).toBeTruthy()
  })

  it('shows every finding on one page, in full, defects first', () => {
    open()
    fireEvent.click(screen.getByRole('button', { name: /^Findings/ }))
    const headings = stage().getAllByRole('heading').map((h) => h.textContent)
    expect(headings).toEqual(['Defects', 'The table is cut off', 'Observations', 'Spacing is loose'])
    expect(stage().getByText('Two columns are missing.')).toBeTruthy()
    expect(stage().getByText('Export at A5.')).toBeTruthy()
  })

  it('on a phone, reaches the walkthrough, the findings and every picture, and closes', () => {
    atWidth(true)
    const onClose = vi.fn()
    render(<ReviewPackagePage pack={pack()} walkthrough={<div>the video</div>} onClose={onClose} />)
    fireEvent.click(screen.getByRole('button', { name: /^Walkthrough/ }))
    expect(stage().getByText('the video')).toBeTruthy()
    fireEvent.click(stage().getByRole('button', { name: 'Next' }))
    expect(stage().getByText('Two columns are missing.')).toBeTruthy()
    fireEvent.click(stage().getByRole('button', { name: 'Next' }))
    expect(stage().getByRole('img', { name: 'The dialog' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('needs no stage for a pass that left only words', () => {
    open(pack({ hasWalkthrough: false, groups: [], findings: [], empty: 'This review read the code, so it has no screenshots.' }))
    expect(screen.queryByRole('region', { name: 'In front' })).toBeNull()
    expect(screen.getAllByText('This review read the code, so it has no screenshots.')).toHaveLength(1)
  })
})
