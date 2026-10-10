// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('../src/trpc', () => ({
  trpc: { docs: { read: { useQuery: () => ({ data: { content: '<!doctype html><p>the show</p>' }, isLoading: false, error: null }) } } },
}))
vi.mock('../src/lib/live', () => ({ useLivePoll: () => false }))

const { PreviewPanel } = await import('../src/components/PreviewPanel')

/** plan-preview decision 6: one control opens the preview full window. Tier 2 — the dialog portals and Escape reads focus. */
describe('PreviewPanel full window', () => {
  afterEach(cleanup)

  it('opens a dialog holding the same locked-down frame, and Escape closes it', () => {
    render(<PreviewPanel featureId="f1" preview={{ relPath: 'preview.html', updatedAt: Date.now() }} />)
    expect(screen.queryByRole('dialog')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Open full window' }))
    const dialog = screen.getByRole('dialog', { name: 'Preview' })
    const frame = dialog.querySelector('iframe')
    expect(frame?.getAttribute('sandbox')).toBe('allow-scripts')
    expect(frame?.getAttribute('srcdoc')).toBe(document.querySelector('iframe')?.getAttribute('srcdoc'))

    fireEvent.keyDown(dialog, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('closes on Escape pressed inside the frame, heard only from that frame', () => {
    render(<PreviewPanel featureId="f1" preview={{ relPath: 'preview.html', updatedAt: Date.now() }} />)
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
