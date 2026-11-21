// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

const doc = vi.hoisted(() => ({ content: '<!doctype html><p>the show</p>' as string | undefined }))

vi.mock('../src/trpc', () => ({
  trpc: {
    docs: {
      read: {
        useQuery: () => ({ data: doc.content === undefined ? undefined : { content: doc.content }, isLoading: doc.content === undefined, error: null }),
      },
    },
  },
}))
vi.mock('../src/lib/live', () => ({ useLivePoll: () => false }))

const { PlanPageDialog } = await import('../src/components/PreviewFrame')

const PREVIEW = { relPath: 'preview.html' as const, updatedAt: Date.now() }

function open() {
  const onClose = vi.fn()
  render(<PlanPageDialog featureId="f1" preview={PREVIEW} onClose={onClose} />)
  return onClose
}

/**
 * The plan page full window an old plan card opens (plan-preview decisions 6,
 * 7, 9; building-starts-without-a-plan-approval decision 6). Tier 2 — the
 * dialog portals and Escape reads focus.
 */
describe('PlanPageDialog', () => {
  afterEach(() => {
    cleanup()
    doc.content = '<!doctype html><p>the show</p>'
  })

  it('frames the page with scripts and nothing else, through the policy-bearing frame document', () => {
    open()
    const frame = screen.getByRole('dialog', { name: 'Plan page' }).querySelector('iframe')
    expect(frame?.getAttribute('sandbox')).toBe('allow-scripts')
    expect(frame?.getAttribute('srcdoc')).toContain('Content-Security-Policy')
    expect(frame?.getAttribute('srcdoc')).toContain('the show')
  })

  it('shows a loading skeleton and no frame before the file is read', () => {
    doc.content = undefined
    open()
    const dialog = screen.getByRole('dialog', { name: 'Plan page' })
    expect(dialog.querySelector('iframe')).toBeNull()
    expect(dialog.textContent).toContain('Loading the plan page')
  })

  it('closes on Escape, and on Close', () => {
    const onClose = open()
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(onClose).toHaveBeenCalledTimes(2)
  })

  it('closes on Escape pressed inside the frame, heard only from that frame', () => {
    const onClose = open()
    const frame = screen.getByRole('dialog').querySelector('iframe')!
    expect(frame.contentWindow).not.toBeNull()

    // The frame's relay posts this; another window posting the same is ignored.
    const relay = (source: Window | null) =>
      act(() => {
        window.dispatchEvent(new MessageEvent('message', { data: 'runcastle:preview-escape', source }))
      })
    relay(window)
    expect(onClose).not.toHaveBeenCalled()

    relay(frame.contentWindow)
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
