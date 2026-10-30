import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Pending attachments, per thread, across a reload (decision 5). Each import
 * after `vi.resetModules()` is a fresh page over the same browser database.
 */

async function page() {
  vi.resetModules()
  return import('../src/lib/pending-attachments')
}

const image = (name: string): File => new File(['png'], name, { type: 'image/png' })
const named = (list: { name: string }[]): string[] => list.map((a) => a.name)

/** Let IndexedDB finish what a call left running. */
const flushed = (): Promise<void> => new Promise((r) => setTimeout(r, 20))

describe('pending attachments', () => {
  let n = 0
  let key = ''
  beforeEach(() => {
    key = `th_${++n}`
  })

  it('come back after a reload, as their own file, under a new id and URL', async () => {
    const before = await page()
    before.updateAttachments(key, () => [before.pendingAttachment(image('a.png'), 'a.png')])
    const [saved] = before.attachmentsAt(key)
    await flushed()

    const after = await page()
    expect(after.attachmentsAt(key)).toEqual([])
    await after.loadAttachments(key)
    const [back] = after.attachmentsAt(key)
    expect(back).toMatchObject({ name: 'a.png' })
    expect(back.id).not.toBe(saved.id)
    expect(back.src).not.toBe(saved.src)
    expect(await back.file.text()).toBe('png')
    expect(back.file.type).toBe('image/png')
  })

  it('stay with their key: another thread never sees them', async () => {
    const store = await page()
    store.updateAttachments(key, () => [store.pendingAttachment(image('a.png'), 'a.png')])
    await flushed()
    const other = `${key}_other`
    await store.loadAttachments(other)
    expect(store.attachmentsAt(other)).toEqual([])

    const after = await page()
    await after.loadAttachments(other)
    expect(after.attachmentsAt(other)).toEqual([])
  })

  it('removing the last one forgets the key across a reload', async () => {
    const before = await page()
    before.updateAttachments(key, () => [before.pendingAttachment(image('a.png'), 'a.png')])
    await flushed()
    before.updateAttachments(key, () => [])
    await flushed()

    const after = await page()
    await after.loadAttachments(key)
    expect(after.attachmentsAt(key)).toEqual([])
  })

  it('a load keeps what was attached while it read', async () => {
    const before = await page()
    before.updateAttachments(key, () => [before.pendingAttachment(image('old.png'), 'old.png')])
    await flushed()

    const after = await page()
    const loading = after.loadAttachments(key)
    after.updateAttachments(key, (as) => [...as, after.pendingAttachment(image('new.png'), 'new.png')])
    await loading
    expect(named(after.attachmentsAt(key))).toEqual(['old.png', 'new.png'])
  })

  it('move to the thread an unstarted chat gets, across a reload too', async () => {
    const from = `feature:${key}:main`
    const store = await page()
    store.updateAttachments(from, () => [store.pendingAttachment(image('a.png'), 'a.png')])
    await store.moveAttachments(from, key)
    expect(store.attachmentsAt(from)).toEqual([])
    expect(named(store.attachmentsAt(key))).toEqual(['a.png'])
    await flushed()

    const after = await page()
    await Promise.all([after.loadAttachments(from), after.loadAttachments(key)])
    expect(after.attachmentsAt(from)).toEqual([])
    expect(named(after.attachmentsAt(key))).toEqual(['a.png'])
  })

  it('tell whoever listens, and keep working in memory when IndexedDB is refused', async () => {
    vi.stubGlobal('indexedDB', undefined)
    try {
      const store = await page()
      const heard = vi.fn()
      const stop = store.subscribeAttachments(heard)
      store.updateAttachments(key, () => [store.pendingAttachment(image('a.png'), 'a.png')])
      await store.loadAttachments(key)
      expect(heard).toHaveBeenCalledOnce()
      expect(named(store.attachmentsAt(key))).toEqual(['a.png'])
      stop()
    } finally {
      vi.unstubAllGlobals()
    }
  })
})
