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

/** design-mode decision 7: a designed-screen entry's Open in design posts out of the sandboxed frame. */
describe('PreviewPanel Open in design', () => {
  afterEach(cleanup)

  const post = (data: unknown, source: Window | null) =>
    act(() => {
      window.dispatchEvent(new MessageEvent('message', { data, source }))
    })

  it("opens the design view at the path its own frame posts, and ignores other sources and shapes", () => {
    const onOpenDesign = vi.fn()
    render(
      <PreviewPanel
        featureId="f1"
        preview={{ relPath: 'preview.html', updatedAt: Date.now() }}
        onOpenDesign={onOpenDesign}
      />,
    )
    const frame = document.querySelector('iframe')!

    post({ type: 'runcastle:open-design', path: '/preview/invites' }, window)
    post({ type: 'runcastle:open-design', path: '/preview/invites' }, null)
    post({ type: 'runcastle:open-design' }, frame.contentWindow)
    post({ type: 'something-else', path: '/preview/invites' }, frame.contentWindow)
    post('runcastle:open-design', frame.contentWindow)
    expect(onOpenDesign).not.toHaveBeenCalled()

    post({ type: 'runcastle:open-design', path: '/preview/invites' }, frame.contentWindow)
    expect(onOpenDesign).toHaveBeenCalledTimes(1)
    expect(onOpenDesign).toHaveBeenCalledWith('/preview/invites')
  })

  it('closes the full window as it opens the design view from there', () => {
    const onOpenDesign = vi.fn()
    render(
      <PreviewPanel
        featureId="f1"
        preview={{ relPath: 'preview.html', updatedAt: Date.now() }}
        onOpenDesign={onOpenDesign}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Open full window' }))
    const frame = screen.getByRole('dialog').querySelector('iframe')!

    post({ type: 'runcastle:open-design', path: '/preview/list' }, frame.contentWindow)
    expect(onOpenDesign).toHaveBeenCalledWith('/preview/list')
    expect(screen.queryByRole('dialog')).toBeNull()
  })
})
