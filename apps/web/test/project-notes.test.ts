import { projectNoteScreenshotUploadUrl } from '@runcastle/core'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  isNoteHotkey,
  uploadProjectNoteScreenshot,
  type NoteHotkeyEvent,
} from '../src/lib/project-notes'

/**
 * The browser half of project-note capture (project-notes ticket 4).
 *
 * `isNoteHotkey` is the one thing the shell's window listener and the embedded
 * terminal's key handler both read, so it is the seam that says whether a chord
 * pressed over a terminal opens the box or goes to the PTY. `fetch` is the true
 * system boundary and is the only thing stubbed.
 */

function ev(over: Partial<NoteHotkeyEvent> = {}): NoteHotkeyEvent {
  return { key: 'j', ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...over }
}

afterEach(() => vi.unstubAllGlobals())

describe('isNoteHotkey', () => {
  it('answers to either modifier, so ⌘J and Ctrl+J both jot', () => {
    expect(isNoteHotkey(ev({ metaKey: true }))).toBe(true)
    expect(isNoteHotkey(ev({ ctrlKey: true }))).toBe(true)
    expect(isNoteHotkey(ev({ key: 'J', ctrlKey: true }))).toBe(true)
  })

  it('needs a modifier — typing a "j" is typing a "j"', () => {
    expect(isNoteHotkey(ev())).toBe(false)
  })

  it('leaves longer chords to whoever owns them', () => {
    expect(isNoteHotkey(ev({ ctrlKey: true, shiftKey: true }))).toBe(false)
    expect(isNoteHotkey(ev({ ctrlKey: true, altKey: true }))).toBe(false)
  })

  it('is not the palette', () => {
    expect(isNoteHotkey(ev({ key: 'k', metaKey: true }))).toBe(false)
  })
})

describe('uploadProjectNoteScreenshot', () => {
  it('posts the PNG bytes to the note it was captured with', async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 204 }))
    vi.stubGlobal('fetch', fetchMock)
    const png = new Blob([new Uint8Array([1])], { type: 'image/png' })

    await uploadProjectNoteScreenshot('pnote_1', png)

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    // The URL is built in core, where the route that serves it is spelled.
    expect(url).toBe(projectNoteScreenshotUploadUrl('pnote_1'))
    expect(init.method).toBe('POST')
    expect(init.headers).toEqual({ 'content-type': 'image/png' })
    expect(init.body).toBe(png)
  })

  it('reports a refused upload rather than swallowing it', async () => {
    vi.stubGlobal('fetch', async () => new Response(null, { status: 413 }))

    await expect(
      uploadProjectNoteScreenshot('pnote_1', new Blob([], { type: 'image/png' })),
    ).rejects.toThrow('413')
  })
})
