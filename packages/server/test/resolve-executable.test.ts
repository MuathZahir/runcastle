import { describe, expect, it } from 'vitest'
import {
  explainSpawnFailure,
  resolveExecutable,
  resolveTool,
} from '../src/util/resolve-executable'

describe('resolveExecutable', () => {
  it('resolves a bare name against PATH on POSIX', () => {
    const resolved = resolveExecutable('git', {
      platform: 'linux',
      pathEnv: '/usr/bin:/bin',
      exists: (p) => p === '/usr/bin/git',
    })
    expect(resolved).toBe('/usr/bin/git')
  })

  it('applies PATHEXT on Windows so a .cmd shim resolves (no ENOENT)', () => {
    const resolved = resolveExecutable('claude', {
      platform: 'win32',
      pathEnv: 'C:\\bin;C:\\shims',
      exists: (p) => p === 'C:\\shims\\claude.cmd',
    })
    expect(resolved).toBe('C:\\shims\\claude.cmd')
  })

  it('prefers a native .exe over a .cmd shim in the same dir', () => {
    const resolved = resolveExecutable('docker', {
      platform: 'win32',
      pathEnv: 'C:\\bin',
      exists: (p) => p === 'C:\\bin\\docker.exe' || p === 'C:\\bin\\docker.cmd',
    })
    expect(resolved).toBe('C:\\bin\\docker.exe')
  })

  it('falls back to the bare name when nothing is found on PATH', () => {
    const resolved = resolveExecutable('nope', {
      platform: 'linux',
      pathEnv: '/usr/bin',
      exists: () => false,
    })
    expect(resolved).toBe('nope')
  })

  it('honors an existing override path without scanning PATH', () => {
    const resolved = resolveExecutable('claude', {
      platform: 'linux',
      override: '/opt/claude/bin/claude',
      exists: (p) => p === '/opt/claude/bin/claude',
    })
    expect(resolved).toBe('/opt/claude/bin/claude')
  })

  it('ignores an override that does not exist and scans PATH instead', () => {
    const resolved = resolveExecutable('claude', {
      platform: 'linux',
      override: '/gone/claude',
      pathEnv: '/usr/bin',
      exists: (p) => p === '/usr/bin/claude',
    })
    expect(resolved).toBe('/usr/bin/claude')
  })
})

/**
 * The override table is the whole point of `resolveTool`: `RUNCASTLE_CLAUDE_BIN`
 * used to be read only by the session launcher, so pinning it fixed sessions
 * while the doctor probe and the AFK token verify still said "claude not found".
 */
describe('resolveTool', () => {
  it('honors RUNCASTLE_CLAUDE_BIN for claude', () => {
    const resolved = resolveTool('claude', {
      env: { RUNCASTLE_CLAUDE_BIN: '/opt/claude/bin/claude' },
      platform: 'linux',
      pathEnv: '/usr/bin',
      exists: (p) => p === '/opt/claude/bin/claude',
    })
    expect(resolved).toBe('/opt/claude/bin/claude')
  })

  it('honors RUNCASTLE_NODE_BIN for node', () => {
    const resolved = resolveTool('node', {
      env: { RUNCASTLE_NODE_BIN: '/opt/node/bin/node' },
      platform: 'linux',
      pathEnv: '/usr/bin',
      exists: (p) => p === '/opt/node/bin/node',
    })
    expect(resolved).toBe('/opt/node/bin/node')
  })

  it('scans PATH normally for a tool with no override env var', () => {
    const resolved = resolveTool('docker', {
      env: { RUNCASTLE_CLAUDE_BIN: '/opt/claude/bin/claude' },
      platform: 'linux',
      pathEnv: '/usr/bin',
      exists: (p) => p === '/usr/bin/docker',
    })
    expect(resolved).toBe('/usr/bin/docker')
  })

  it('falls back to PATH when the override points at a missing file', () => {
    const resolved = resolveTool('claude', {
      env: { RUNCASTLE_CLAUDE_BIN: '/gone/claude' },
      platform: 'linux',
      pathEnv: '/usr/bin',
      exists: (p) => p === '/usr/bin/claude',
    })
    expect(resolved).toBe('/usr/bin/claude')
  })
})

/**
 * node-pty's PATH-search failure is `File not found: ` + the *resolved* path,
 * which is empty exactly when the search failed — a terminal that dies showing
 * nothing but a colon. Every spawn site routes its failure through here instead.
 */
describe('explainSpawnFailure', () => {
  it('names the binary node-pty could not report', () => {
    const msg = explainSpawnFailure('claude', 'File not found: ')
    expect(msg).toContain('claude')
    expect(msg).toContain('PATH')
  })

  it('pre-empts "but it works in my terminal"', () => {
    const msg = explainSpawnFailure('claude', 'File not found: ')
    expect(msg).toContain('does not prove')
    expect(msg).toContain('captured when it started')
  })

  it('offers the restart first and the override as the fallback', () => {
    const msg = explainSpawnFailure('claude', 'File not found: ')
    expect(msg).toContain('start it again from a terminal')
    expect(msg).toContain('RUNCASTLE_CLAUDE_BIN')
    expect(msg.indexOf('start it again')).toBeLessThan(msg.indexOf('RUNCASTLE_CLAUDE_BIN'))
  })

  it('keeps the underlying error for diagnosis', () => {
    expect(explainSpawnFailure('claude', 'File not found: ')).toContain('File not found:')
  })

  it('omits the override hint for a tool that has none', () => {
    const msg = explainSpawnFailure('sandcastle', 'File not found: ')
    expect(msg).toContain('sandcastle')
    expect(msg).not.toContain('RUNCASTLE_')
  })

  it('does not blame PATH when an absolute path was given', () => {
    const msg = explainSpawnFailure('C:\\bin\\claude.exe', 'Access denied')
    expect(msg).toContain('C:\\bin\\claude.exe')
    expect(msg).toContain('Access denied')
    expect(msg).not.toContain('PATH')
  })
})
