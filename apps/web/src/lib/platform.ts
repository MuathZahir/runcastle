/**
 * What the UI is allowed to assume about the machine it is being read on
 * (findings F17.4).
 *
 * The app told every user to press "⌘K" and to paste "/path/to/your/repo" — two
 * small lies on Windows, where the shortcut is Ctrl+K and no path looks like
 * that. Neither is worth a platform abstraction; both are worth being right.
 *
 * The detection is deliberately a pair of pure functions over the strings the
 * browser exposes, so the wording is testable on any platform. `navigator.platform`
 * is soft-deprecated but still populated everywhere and still the only synchronous
 * answer — `userAgentData.platform` needs an async call the render path cannot make,
 * so the user agent is the fallback.
 */

/** True when the strings describe a Mac (⌘ machines). */
export function isMacLike(platform: string, userAgent = ''): boolean {
  return /mac|iphone|ipad|ipod/i.test(platform) || /mac os x/i.test(userAgent)
}

/** True when the strings describe Windows. */
export function isWindowsLike(platform: string, userAgent = ''): boolean {
  return /win/i.test(platform) || /windows/i.test(userAgent)
}

/**
 * A shortcut spelled the way this machine spells it — "⌘J" on a Mac, "Ctrl+J"
 * everywhere else. The app has two of them now (the palette and note capture),
 * so the modifier is written once.
 */
export function shortcutLabel(key: string, platform: string, userAgent = ''): string {
  return isMacLike(platform, userAgent) ? `⌘${key}` : `Ctrl+${key}`
}

/** The modifier the command palette actually answers to, spelled for a human. */
export function modKeyLabel(platform: string, userAgent = ''): string {
  return shortcutLabel('K', platform, userAgent)
}

/**
 * A repository path that looks like one on the machine the server runs on.
 * `serverPlatform` is Node's `process.platform` there (`win32`, `linux`,
 * `darwin`), never the browser's: the path is opened by the server, and a
 * Windows browser on a Linux server types Linux paths. Unknown (not answered
 * yet) reads as POSIX.
 */
export function repoPathPlaceholder(serverPlatform: string | undefined): string {
  return serverPlatform === 'win32' ? 'C:\\Users\\you\\code\\your-repo' : '/path/to/your/repo'
}

/**
 * Whether a repository path is absolute on the machine the server runs on — a
 * drive letter or a UNC share on Windows, a leading slash everywhere else.
 * While the server's platform is unknown, either form passes: refusing a good
 * path is worse than letting the server judge it.
 *
 * A relative path used to be forwarded to the server, which resolved it against
 * its own working directory and then reported that directory back in the error
 * (decision 5) — an answer about a folder the user never named. The refusal
 * belongs here, in front of the request.
 */
export function isAbsoluteRepoPath(path: string, serverPlatform: string | undefined): boolean {
  const trimmed = path.trim()
  const windows = /^[A-Za-z]:[\\/]/.test(trimmed) || /^\\\\/.test(trimmed)
  const posix = trimmed.startsWith('/')
  if (serverPlatform === undefined) return windows || posix
  return serverPlatform === 'win32' ? windows : posix
}

function nav(): { platform: string; userAgent: string } {
  if (typeof navigator === 'undefined') return { platform: '', userAgent: '' }
  return { platform: navigator.platform ?? '', userAgent: navigator.userAgent ?? '' }
}

/** {@link modKeyLabel} for the browser this is running in. */
export function modKey(): string {
  const n = nav()
  return modKeyLabel(n.platform, n.userAgent)
}

/** {@link shortcutLabel} for the browser this is running in. */
export function shortcut(key: string): string {
  const n = nav()
  return shortcutLabel(key, n.platform, n.userAgent)
}

/** A shortcut with Shift too — "⌘⇧O" on a Mac, "Ctrl+Shift+O" everywhere else — for this browser. */
export function shiftShortcut(key: string): string {
  const n = nav()
  return isMacLike(n.platform, n.userAgent) ? `⌘⇧${key}` : `Ctrl+Shift+${key}`
}
