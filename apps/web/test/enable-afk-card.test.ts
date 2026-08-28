import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { BurnCacheRow, ImageBuildAction, type Probe } from '../src/components/EnableAfkCard'

/** Shaped like the real `sandcastle-image` probe: tier 2, AFK-only, an error. */
const probe = (status: 'missing' | 'stale' | 'ok', fix?: string): Probe => ({
  id: 'sandcastle-image',
  label: 'Sandcastle image',
  tier: 2,
  status,
  severity: 'error',
  detail: `${status} image detail`,
  ...(fix ? { fix } : {}),
})

describe('EnableAfkCard image action', () => {
  const render = (status: 'missing' | 'stale' | 'ok', fix?: string) =>
    renderToStaticMarkup(
      createElement(ImageBuildAction, {
        probe: probe(status, fix),
        runtimeOk: true,
        pending: false,
        onStart: () => undefined,
      }),
    )

  /** The one solid button per view is the primary action; `bg-accent` is it. */
  it('offers a primary Build image action when the image is missing', () => {
    const html = render('missing')
    expect(html).toContain('bg-accent')
    expect(html).toContain('Build image')
  })

  it('shows the doctor fix and a primary Rebuild image action when stale', () => {
    const html = render('stale', 'Rebuild the bundled image')
    expect(html).toContain('Rebuild the bundled image')
    expect(html).toContain('bg-accent')
    expect(html).toContain('Rebuild image')
  })

  it('offers a secondary Rebuild image action when the image is ok', () => {
    const html = render('ok')
    expect(html).not.toContain('bg-accent')
    expect(html).toContain('bg-transparent')
    expect(html).toContain('Rebuild image')
  })
})

/**
 * Decision 6 — the operator can see how much disk the project's burn cache
 * volume holds and drop it in one click, and is told why when a burn is using
 * it. The row exists only where the cache does: `burnCache: 'off'` (and any
 * sandbox that has no volumes) is exactly the behaviour that predates it.
 */
describe('EnableAfkCard burn cache row', () => {
  const volumeName = 'runcastle-proj_abc123def456'
  const render = (
    status: Parameters<typeof BurnCacheRow>[0]['status'],
    over: { pending?: boolean; refusal?: string | null } = {},
  ) =>
    renderToStaticMarkup(
      createElement(BurnCacheRow, {
        status,
        pending: over.pending ?? false,
        refusal: over.refusal ?? null,
        onClear: () => undefined,
      }),
    )

  const volumeStatus = { mode: 'volume' as const, engine: 'docker' as const, volumeName }

  it('shows the volume, its size and a Clear button', () => {
    const html = render({ ...volumeStatus, sizeBytes: 2_400_000_000 })
    expect(html).toContain(volumeName)
    expect(html).toContain('2.4 GB')
    expect(html).toContain('Clear')
  })

  it('reads a volume that does not exist yet as empty', () => {
    expect(render({ ...volumeStatus, sizeBytes: null })).toContain('empty')
  })

  it('renders nothing when the cache is off', () => {
    const off = { mode: 'off' as const, engine: null, volumeName, sizeBytes: null }
    expect(render(off)).toBe('')
    expect(render(undefined)).toBe('')
  })

  // The refusal is the only feedback the click gives, and it names the slots
  // the operator has to stop — a toast that scrolls away would lose it.
  it('renders the refusal inline when a burn is holding the cache', () => {
    const refusal = 'burn cache is in use — slots 1, 2 are held'
    expect(render({ ...volumeStatus, sizeBytes: 10 }, { refusal })).toContain(refusal)
  })
})
