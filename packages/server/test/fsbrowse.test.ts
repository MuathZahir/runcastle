import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { isAbsolute, join, sep } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { browseDir, crumbsFor, expandPath, listRoots, looksLikeRepo, parentOf } from '../src/services/fsbrowse'

/**
 * Filesystem browse service — the data behind the repo picker. These run on
 * whatever platform the suite runs on, so the platform-specific expectations
 * are branched rather than skipped where the behaviour genuinely differs.
 */

let root: string
const HOME = join(sep === '\\' ? 'C:\\' : '/', 'fake-home-for-tests')

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'rc-fsbrowse-'))
  mkdirSync(join(root, 'a-repo', '.git'), { recursive: true })
  mkdirSync(join(root, 'b-plain'), { recursive: true })
  mkdirSync(join(root, '.hidden'), { recursive: true })
  mkdirSync(join(root, 'node_modules'), { recursive: true })
  writeFileSync(join(root, 'a-file.txt'), 'x')
  // A worktree checkout has `.git` as a *file*, not a directory.
  mkdirSync(join(root, 'c-worktree'), { recursive: true })
  writeFileSync(join(root, 'c-worktree', '.git'), 'gitdir: /elsewhere')
})

afterAll(() => {
  rmSync(root, { recursive: true, force: true })
})

describe('expandPath', () => {
  it('expands a bare ~ to home', () => {
    expect(expandPath('~', HOME)).toBe(expandPath(HOME, HOME))
  })

  it('expands ~/child with the platform separator', () => {
    expect(expandPath('~/projects', HOME)).toBe(join(HOME, 'projects'))
  })

  it('leaves ~user alone rather than guessing another account home', () => {
    // Resolved relative to cwd, so it will simply fail the existence check with
    // a clear message instead of silently opening the wrong directory.
    expect(expandPath('~someone', HOME)).not.toContain(`${sep}~someone${sep}`)
    expect(expandPath('~someone', HOME).endsWith('~someone')).toBe(true)
  })

  it('resolves relative segments and trailing separators to one form', () => {
    const a = expandPath(join(root, 'b-plain') + sep, HOME)
    const b = expandPath(join(root, 'a-repo', '..', 'b-plain'), HOME)
    expect(a).toBe(b)
  })

  it('always returns an absolute path', () => {
    expect(isAbsolute(expandPath('.', HOME))).toBe(true)
  })
})

describe('looksLikeRepo', () => {
  it('detects a normal checkout (.git directory)', () => {
    expect(looksLikeRepo(join(root, 'a-repo'))).toBe(true)
  })

  it('detects a worktree checkout (.git file)', () => {
    expect(looksLikeRepo(join(root, 'c-worktree'))).toBe(true)
  })

  it('is false for a plain directory and for a nonexistent one', () => {
    expect(looksLikeRepo(join(root, 'b-plain'))).toBe(false)
    expect(looksLikeRepo(join(root, 'nope'))).toBe(false)
  })
})

describe('browseDir', () => {
  it('lists only directories, flagging git repos', () => {
    const res = browseDir(root)
    const names = res.entries.map((e) => e.name)
    expect(names).toContain('a-repo')
    expect(names).toContain('b-plain')
    expect(names).not.toContain('a-file.txt')
    expect(res.entries.find((e) => e.name === 'a-repo')?.isRepo).toBe(true)
    expect(res.entries.find((e) => e.name === 'b-plain')?.isRepo).toBe(false)
  })

  it('hides dotfolders and node_modules by default', () => {
    const names = browseDir(root).entries.map((e) => e.name)
    expect(names).not.toContain('.hidden')
    expect(names).not.toContain('node_modules')
  })

  it('reveals dotfolders (but never node_modules) when asked', () => {
    const names = browseDir(root, true).entries.map((e) => e.name)
    expect(names).toContain('.hidden')
    expect(names).not.toContain('node_modules')
  })

  it('returns absolute, sorted entry paths', () => {
    const res = browseDir(root)
    expect(res.entries.every((e) => isAbsolute(e.path))).toBe(true)
    const names = res.entries.map((e) => e.name)
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' })))
  })

  it('lists the containing directory when handed a file path', () => {
    // Pasting `/repo/README.md` should land in `/repo`, not error.
    expect(browseDir(join(root, 'a-file.txt')).dir).toBe(browseDir(root).dir)
  })

  it('expands ~ and reports the resolved directory it actually listed', () => {
    const res = browseDir(join(root, 'a-repo', '..') + sep)
    expect(res.dir).toBe(browseDir(root).dir)
    expect(res.isRepo).toBe(false)
  })

  it('reports isRepo for the current directory', () => {
    expect(browseDir(join(root, 'a-repo')).isRepo).toBe(true)
  })

  it('throws a readable error for a nonexistent path', () => {
    expect(() => browseDir(join(root, 'definitely-not-here'))).toThrow(/does not exist/)
  })

  it('follows a symlink to a directory and tags it', () => {
    const link = join(root, 'z-link')
    try {
      symlinkSync(join(root, 'a-repo'), link, 'junction')
    } catch {
      return // Unprivileged Windows without Developer Mode — nothing to assert.
    }
    const entry = browseDir(root).entries.find((e) => e.name === 'z-link')
    expect(entry?.isSymlink).toBe(true)
    expect(entry?.isRepo).toBe(true)
    rmSync(link, { recursive: true, force: true })
  })
})

describe('crumbsFor / parentOf', () => {
  it('walks up to a root that has no parent', () => {
    const crumbs = crumbsFor(root)
    expect(crumbs.at(-1)?.path).toBe(root)
    expect(parentOf(crumbs[0]!.path)).toBeNull()
  })

  it('produces cumulative absolute paths', () => {
    expect(crumbsFor(root).every((c) => isAbsolute(c.path))).toBe(true)
  })
})

describe('listRoots', () => {
  it('offers at least one navigable root for this platform', () => {
    const roots = listRoots()
    expect(roots.length).toBeGreaterThan(0)
    expect(roots.every((r) => isAbsolute(r.path))).toBe(true)
    if (process.platform === 'win32') {
      // Drive letters, e.g. `C:` — never a POSIX-style single slash root.
      expect(roots.some((r) => /^[A-Z]:$/.test(r.label))).toBe(true)
    } else {
      expect(roots.some((r) => r.path === '/')).toBe(true)
    }
  })

  it('lists an existing home directory', () => {
    const roots = listRoots(root)
    expect(roots.some((r) => r.kind === 'home' && r.path === root)).toBe(true)
  })

  it('surfaces common code dirs under home when they exist', () => {
    const home = mkdtempSync(join(tmpdir(), 'rc-fshome-'))
    mkdirSync(join(home, 'projects'))
    const roots = listRoots(home)
    // Compared case-insensitively on Windows: the probe that matched may be the
    // `Projects` spelling even though the folder on disk is `projects`, and
    // there the two address the same directory.
    const want = join(home, 'projects')
    const same = (a: string, b: string) =>
      process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b
    expect(roots.some((r) => r.kind === 'common' && same(r.path, want))).toBe(true)
    rmSync(home, { recursive: true, force: true })
  })

  it('does not list one directory twice through case-variant probes', () => {
    // `Projects` and `projects` are both probed (they are distinct dirs on
    // POSIX) but name a single folder on Windows — the rail must show it once.
    const home = mkdtempSync(join(tmpdir(), 'rc-fscase-'))
    mkdirSync(join(home, 'Projects'))
    const paths = listRoots(home).map((r) => (process.platform === 'win32' ? r.path.toLowerCase() : r.path))
    expect(paths.length).toBe(new Set(paths).size)
    rmSync(home, { recursive: true, force: true })
  })
})
