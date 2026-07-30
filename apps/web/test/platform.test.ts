import { describe, expect, it } from 'vitest'
import {
  isMacLike,
  isWindowsLike,
  modKeyLabel,
  repoPathPlaceholder,
} from '../src/lib/platform'

/**
 * Findings F17.4 — the app told every user to press ⌘K and to paste
 * `/path/to/your/repo`. Both are wrong on Windows. Tested over the raw browser
 * strings so the wording is checkable from any platform the suite runs on.
 */
const MAC = { platform: 'MacIntel', ua: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)' }
const WIN = { platform: 'Win32', ua: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' }
const LINUX = { platform: 'Linux x86_64', ua: 'Mozilla/5.0 (X11; Linux x86_64)' }
const IPAD = { platform: 'iPad', ua: 'Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X)' }

describe('platform detection', () => {
  it('recognises macs, including iOS devices with ⌘ keyboards', () => {
    expect(isMacLike(MAC.platform, MAC.ua)).toBe(true)
    expect(isMacLike(IPAD.platform, IPAD.ua)).toBe(true)
    expect(isMacLike(WIN.platform, WIN.ua)).toBe(false)
    expect(isMacLike(LINUX.platform, LINUX.ua)).toBe(false)
  })

  it('recognises windows', () => {
    expect(isWindowsLike(WIN.platform, WIN.ua)).toBe(true)
    expect(isWindowsLike(MAC.platform, MAC.ua)).toBe(false)
    expect(isWindowsLike(LINUX.platform, LINUX.ua)).toBe(false)
  })

  it('falls back to the user agent when platform is blank', () => {
    expect(isMacLike('', MAC.ua)).toBe(true)
    expect(isWindowsLike('', WIN.ua)).toBe(true)
  })

  it('assumes nothing when the browser tells us nothing', () => {
    expect(isMacLike('', '')).toBe(false)
    expect(isWindowsLike('', '')).toBe(false)
  })
})

describe('modKeyLabel', () => {
  it('is ⌘K on a mac and Ctrl+K everywhere else', () => {
    expect(modKeyLabel(MAC.platform, MAC.ua)).toBe('⌘K')
    expect(modKeyLabel(WIN.platform, WIN.ua)).toBe('Ctrl+K')
    expect(modKeyLabel(LINUX.platform, LINUX.ua)).toBe('Ctrl+K')
  })
})

describe('repoPathPlaceholder', () => {
  it('looks like a windows path on windows', () => {
    expect(repoPathPlaceholder(WIN.platform, WIN.ua)).toMatch(/^[A-Z]:\\/)
  })

  it('looks like a posix path everywhere else', () => {
    expect(repoPathPlaceholder(MAC.platform, MAC.ua)).toBe('/path/to/your/repo')
    expect(repoPathPlaceholder(LINUX.platform, LINUX.ua)).toBe('/path/to/your/repo')
  })
})
