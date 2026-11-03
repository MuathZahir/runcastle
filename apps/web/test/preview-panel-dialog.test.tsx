// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { FeatureFull } from '../src/lib/api'
import { atWidth } from './phone-width'

vi.mock('../src/trpc', () => ({
  trpc: { docs: { read: { useQuery: () => ({ data: { content: '<!doctype html><p>the show</p>' }, isLoading: false, error: null }) } } },
}))
vi.mock('../src/lib/live', () => ({ useLivePoll: () => false }))

const { PlanBody } = await import('../src/components/bodies/PlanBody')

const PREVIEW = { relPath: 'preview.html', updatedAt: Date.now() }
/** The Plan view on a feature with a preview: its bar holds the open-full-window button. */
const plan = () =>
  render(
    <PlanBody
      full={{ feature: { id: 'f1' }, docs: [{ relPath: 'decisions.md', title: 'Decisions' }], preview: PREVIEW } as unknown as FeatureFull}
    />,
  )

/**
 * plan-preview decision 6: one control on the Plan view's bar opens the
 * preview full window. Tier 2 — the dialog portals and Escape reads focus.
 */
describe('PreviewPanel full window', () => {
  afterEach(cleanup)

  it('opens a dialog holding the same locked-down frame, and Escape closes it', () => {
    plan()
    expect(screen.queryByRole('dialog')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Open full window' }))
    const dialog = screen.getByRole('dialog', { name: 'Plan' })
    const frame = dialog.querySelector('iframe')
    expect(frame?.getAttribute('sandbox')).toBe('allow-scripts')
    expect(frame?.getAttribute('srcdoc')).toBe(document.querySelector('iframe')?.getAttribute('srcdoc'))

    fireEvent.keyDown(dialog, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('closes on Escape pressed inside the frame, heard only from that frame', () => {
    plan()
    fireEvent.click(screen.getByRole('button', { name: 'Open full window' }))
    const frame = screen.getByRole('dialog').querySelector('iframe')!
    expect(frame.contentWindow).not.toBeNull()

    // The frame's relay posts this; another window posting the same is ignored.
    const relay = (source: Window | null) =>
      act(() => {
        window.dispatchEvent(new MessageEvent('message', { data: 'runcastle:preview-escape', source }))
      })
    relay(window)
    expect(screen.queryByRole('dialog')).not.toBeNull()

    relay(frame.contentWindow)
    expect(screen.queryByRole('dialog')).toBeNull()
  })
})

/** runcastle-on-your-phone decision 3: the plan reads on a phone, already the whole screen. */
describe('PlanBody on a phone', () => {
  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })

  it('keeps its three parts and the preview, with no full-window control', () => {
    atWidth(true)
    plan()
    for (const name of [/Overview/, /Decisions/, /Spec/]) expect(screen.getByRole('tab', { name })).toBeTruthy()
    expect(document.querySelector('iframe')).not.toBeNull()
    expect(screen.queryByRole('button', { name: 'Open full window' })).toBeNull()
  })
})
