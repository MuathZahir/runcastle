import { describe, expect, it } from 'vitest'
import {
  isAbsoluteRepoPath,
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

/**
 * The path rules key on the SERVER's platform (Node's `process.platform`), never
 * the browser's: the server opens the path, and a Windows browser on a Linux
 * server types Linux paths (the-orchestrator-prepares-the-project, a bug the
 * human hit on the onboarding drive).
 */
describe('repoPathPlaceholder', () => {
  it('looks like a windows path when the server runs on windows', () => {
    expect(repoPathPlaceholder('win32')).toMatch(/^[A-Z]:\\/)
  })

  it('looks like a posix path for any other server, and before the server answers', () => {
    expect(repoPathPlaceholder('darwin')).toBe('/path/to/your/repo')
    expect(repoPathPlaceholder('linux')).toBe('/path/to/your/repo')
    expect(repoPathPlaceholder(undefined)).toBe('/path/to/your/repo')
  })
})

describe('isAbsoluteRepoPath', () => {
  const onWindows = (p: string) => isAbsoluteRepoPath(p, 'win32')
  const onPosix = (p: string) => isAbsoluteRepoPath(p, 'linux')

  it('accepts a drive letter and a UNC share on windows', () => {
    expect(onWindows('C:\\Users\\you\\code\\repo')).toBe(true)
    expect(onWindows('c:/Users/you/code/repo')).toBe(true)
    expect(onWindows('\\\\build\\share\\repo')).toBe(true)
  })

  it('rejects a relative path on windows, drive-relative included', () => {
    expect(onWindows('code\\repo')).toBe(false)
    expect(onWindows('..\\repo')).toBe(false)
    expect(onWindows('C:repo')).toBe(false) // relative to the drive's own cwd
    expect(onWindows('')).toBe(false)
  })

  // A leading slash is not a windows path: the drive it means is the server's
  // guess, which is exactly the leak this check exists to close.
  it('rejects a bare posix path on windows', () => {
    expect(onWindows('/home/you/repo')).toBe(false)
  })

  it('accepts a leading slash and rejects relatives everywhere else', () => {
    expect(onPosix('/home/you/repo')).toBe(true)
    expect(onPosix('not-a-path')).toBe(false)
    expect(onPosix('./repo')).toBe(false)
    expect(onPosix('~/code/repo')).toBe(false) // the shell expands ~, we do not
    expect(onPosix('')).toBe(false)
  })

  // The bug: the browser on Windows, the server on Linux. The browser's own
  // machine is not an input any more, so only the server's platform decides.
  it('accepts a linux path for a linux server, the browser left out of it', () => {
    expect(isAbsoluteRepoPath('/home/muath/projects/app', 'linux')).toBe(true)
  })

  it('lets either form through while the server has not said what it runs on', () => {
    expect(isAbsoluteRepoPath('/home/you/repo', undefined)).toBe(true)
    expect(isAbsoluteRepoPath('C:\\Users\\you\\repo', undefined)).toBe(true)
    expect(isAbsoluteRepoPath('repo', undefined)).toBe(false)
  })

  it('judges the path the user typed, not the whitespace around it', () => {
    expect(onPosix('  /home/you/repo  ')).toBe(true)
    expect(onWindows('  C:\\repo ')).toBe(true)
  })
})
