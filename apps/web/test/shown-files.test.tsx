// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { ShownFiles } from '../src/components/chat/thread/ShownFiles'
import type { ShownFile } from '../src/lib/chat-thread'

const file = (id: string, as: ShownFile['as'], extra: Partial<ShownFile> = {}): ShownFile => ({
  id,
  src: `/api/threads/t/files/${id}.bin`,
  name: `${id}.bin`,
  path: `reports/${id}.bin`,
  size: 2_000,
  as,
  ...extra,
})

afterEach(cleanup)

describe('ShownFiles', () => {
  it('shows a picture inline with its caption, and an oversized one as a card', () => {
    render(<ShownFiles files={[file('a', 'image', { caption: 'The dialog' }), file('b', 'image', { size: 14_000_000 })]} />)
    expect(screen.getAllByRole('img')).toHaveLength(1)
    expect(screen.getByText('The dialog')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Open b.bin' }).querySelector('img')).toBeNull()
  })

  it('shows four files, then the rest in place behind Show N more', () => {
    render(<ShownFiles files={['a', 'b', 'c', 'd', 'e', 'f'].map((id) => file(id, 'image'))} />)
    expect(screen.getAllByRole('img')).toHaveLength(4)
    fireEvent.click(screen.getByRole('button', { name: 'Show 2 more' }))
    expect(screen.getAllByRole('img')).toHaveLength(6)
  })

  it('opens a picture in the viewer, with Download under its name, and closes it', () => {
    render(<ShownFiles files={[file('a', 'image')]} />)
    fireEvent.click(screen.getByRole('button', { name: 'Open a.bin' }))
    const dialog = screen.getByRole('dialog')
    expect(dialog.textContent).toContain('reports/a.bin')
    expect(dialog.querySelector('a')?.getAttribute('href')).toBe('/api/threads/t/files/a.bin?download=a.bin')
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('reads a long text file only as far as its first megabyte, and says so', async () => {
    const fetcher = vi.fn(async () => new Response('the start'))
    vi.stubGlobal('fetch', fetcher)
    render(<ShownFiles files={[file('a', 'text', { size: 5_000_000 })]} />)
    fireEvent.click(screen.getByRole('button', { name: 'Open a.bin' }))
    expect(await screen.findByText('the start')).toBeTruthy()
    expect(fetcher).toHaveBeenCalledWith('/api/threads/t/files/a.bin', { headers: { Range: 'bytes=0-999999' } })
    expect(screen.getByRole('dialog').textContent).toContain('Showing the first 1.0 MB of 5.0 MB')
    vi.unstubAllGlobals()
  })

  it('hands a PDF to a new tab', () => {
    const open = vi.spyOn(window, 'open').mockImplementation(() => null)
    render(<ShownFiles files={[file('a', 'browser')]} />)
    fireEvent.click(screen.getByRole('button', { name: 'Open in a new tab: a.bin' }))
    expect(open).toHaveBeenCalledWith('/api/threads/t/files/a.bin', '_blank', 'noopener')
    expect(screen.queryByRole('dialog')).toBeNull()
    open.mockRestore()
  })
})
