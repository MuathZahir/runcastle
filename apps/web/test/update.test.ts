import { describe, expect, it } from 'vitest'
import { bannerVisible } from '../src/lib/update'

/**
 * Issue #51 — the dismissible update banner. It shows only when npm reports a
 * strictly-newer version, and a dismissal is remembered per-version: dismissing
 * 0.2.0 hides that banner, but a later 0.3.0 shows again (dismissal is keyed to
 * the version, not a permanent "never show"). Nothing here installs anything —
 * the banner only names the command.
 */
describe('bannerVisible', () => {
  const info = { updateAvailable: true, latest: '0.2.0', command: 'bun add -g runcastle@latest' }

  it('shows when an update is available and nothing was dismissed', () => {
    expect(bannerVisible(info, null)).toBe(true)
  })

  it('hides when the exact latest version was dismissed', () => {
    expect(bannerVisible(info, '0.2.0')).toBe(false)
  })

  it('shows again when a newer version supersedes the dismissed one', () => {
    expect(bannerVisible({ ...info, latest: '0.3.0' }, '0.2.0')).toBe(true)
  })

  it('hides when no update is available', () => {
    expect(bannerVisible({ ...info, updateAvailable: false }, null)).toBe(false)
  })

  it('hides when the registry was unreachable (latest null)', () => {
    expect(bannerVisible({ ...info, updateAvailable: false, latest: null }, null)).toBe(false)
  })
})
