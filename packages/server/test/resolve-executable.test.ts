import { describe, expect, it } from 'vitest'
import {
  explainSpawnFailure,
  resolveExecutable,
  resolveTool,
  spawnTargetFor,
  wellKnownBinDirs,
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

  it('finds a .ps1 shim — npm installs one even when it installs no .cmd', () => {
    const resolved = resolveExecutable('claude', {
      platform: 'win32',
      pathEnv: 'C:\\Users\\A\\AppData\\Roaming\\npm',
      exists: (p) => p === 'C:\\Users\\A\\AppData\\Roaming\\npm\\claude.ps1',
    })
    expect(resolved).toBe('C:\\Users\\A\\AppData\\Roaming\\npm\\claude.ps1')
  })

  it('prefers a directly-executable .cmd over a .ps1 in the same dir', () => {
    const resolved = resolveExecutable('claude', {
      platform: 'win32',
      pathEnv: 'C:\\npm',
      exists: (p) => p === 'C:\\npm\\claude.cmd' || p === 'C:\\npm\\claude.ps1',
    })
    expect(resolved).toBe('C:\\npm\\claude.cmd')
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

  it('honors RUNCASTLE_CODEX_BIN for codex', () => {
    const resolved = resolveTool('codex', {
      env: { RUNCASTLE_CODEX_BIN: '/opt/codex/bin/codex' },
      platform: 'linux',
      pathEnv: '/usr/bin',
      exists: (p) => p === '/opt/codex/bin/codex',
    })
    expect(resolved).toBe('/opt/codex/bin/codex')
  })

  it('finds a codex npm shim on Windows when PATH is stale', () => {
    const resolved = resolveTool('codex', {
      env: { APPDATA: 'C:\\Users\\dev\\AppData\\Roaming' },
      platform: 'win32',
      pathEnv: 'C:\\Windows\\system32',
      exists: (p) => p === 'C:\\Users\\dev\\AppData\\Roaming\\npm\\codex.cmd',
    })
    expect(resolved).toBe('C:\\Users\\dev\\AppData\\Roaming\\npm\\codex.cmd')
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
 * Both supported Claude Code installs must work: the native installer
 * (`~/.local/bin`, added to the *user* PATH so only new processes see it) and
 * npm global (`%APPDATA%\npm`, shims only). A server launched from a stale
 * shell or a GUI shortcut inherits neither.
 */
describe('install-location recovery', () => {
  const WIN_ENV = {
    USERPROFILE: 'C:\\Users\\Admin',
    APPDATA: 'C:\\Users\\Admin\\AppData\\Roaming',
  } as NodeJS.ProcessEnv

  it('finds the native install when PATH is stale', () => {
    const resolved = resolveTool('claude', {
      env: WIN_ENV,
      platform: 'win32',
      pathEnv: 'C:\\Windows\\System32',
      exists: (p) => p === 'C:\\Users\\Admin\\.local\\bin\\claude.exe',
    })
    expect(resolved).toBe('C:\\Users\\Admin\\.local\\bin\\claude.exe')
  })

  it('finds the npm install when PATH is stale', () => {
    const resolved = resolveTool('claude', {
      env: WIN_ENV,
      platform: 'win32',
      pathEnv: 'C:\\Windows\\System32',
      exists: (p) => p === 'C:\\Users\\Admin\\AppData\\Roaming\\npm\\claude.ps1',
    })
    expect(resolved).toBe('C:\\Users\\Admin\\AppData\\Roaming\\npm\\claude.ps1')
    // …and it must be launchable, not merely findable.
    expect(spawnTargetFor(resolved, []).file).toBe('powershell.exe')
  })

  it('finds a POSIX native install under ~/.local/bin', () => {
    const resolved = resolveTool('claude', {
      env: { HOME: '/home/a' } as NodeJS.ProcessEnv,
      platform: 'linux',
      pathEnv: '/usr/bin',
      exists: (p) => p === '/home/a/.local/bin/claude',
    })
    expect(resolved).toBe('/home/a/.local/bin/claude')
  })

  it('lets PATH win over a well-known dir — a deliberate ordering is not second-guessed', () => {
    const resolved = resolveTool('claude', {
      env: WIN_ENV,
      platform: 'win32',
      pathEnv: 'C:\\chosen',
      exists: (p) =>
        p === 'C:\\chosen\\claude.exe' || p === 'C:\\Users\\Admin\\.local\\bin\\claude.exe',
    })
    expect(resolved).toBe('C:\\chosen\\claude.exe')
  })

  it('still returns the bare name when the tool is genuinely absent', () => {
    const resolved = resolveTool('claude', {
      env: WIN_ENV,
      platform: 'win32',
      pathEnv: 'C:\\Windows\\System32',
      exists: () => false,
    })
    expect(resolved).toBe('claude')
  })

  it('covers native, npm and bun locations on Windows', () => {
    const dirs = wellKnownBinDirs({ platform: 'win32', env: WIN_ENV })
    expect(dirs).toContain('C:\\Users\\Admin\\.local\\bin')
    expect(dirs).toContain('C:\\Users\\Admin\\AppData\\Roaming\\npm')
    expect(dirs).toContain('C:\\Users\\Admin\\.bun\\bin')
  })

  it('omits dirs whose env var is unset rather than emitting undefined paths', () => {
    expect(wellKnownBinDirs({ platform: 'win32', env: {} as NodeJS.ProcessEnv })).toEqual([])
    expect(wellKnownBinDirs({ platform: 'linux', env: {} as NodeJS.ProcessEnv })).not.toContain(
      undefined,
    )
  })
})

/**
 * Windows can only exec a real PE image, so every shim kind needs its
 * interpreter. Handing ConPTY a `.ps1` directly fails the same way handing it a
 * `.bat` does — a terminal that opens and instantly dies.
 */
describe('spawnTargetFor', () => {
  it('runs a .cmd shim through the command processor', () => {
    const t = spawnTargetFor('C:\\npm\\claude.cmd', ['--version'])
    expect(t.file.toLowerCase()).toContain('cmd')
    expect(t.args).toEqual(['/c', 'C:\\npm\\claude.cmd', '--version'])
  })

  it('runs a .ps1 shim through PowerShell with -File', () => {
    const t = spawnTargetFor('C:\\npm\\claude.ps1', ['--version'])
    expect(t.file).toBe('powershell.exe')
    expect(t.args).toEqual([
      '-NoProfile',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      'C:\\npm\\claude.ps1',
      '--version',
    ])
  })

  it('bypasses execution policy — Restricted is the client default and blocks npm shims', () => {
    expect(spawnTargetFor('C:\\npm\\claude.ps1', []).args).toContain('Bypass')
  })

  it('spawns a native .exe directly, with no interpreter', () => {
    const t = spawnTargetFor('C:\\bin\\claude.exe', ['--version'])
    expect(t).toEqual({ file: 'C:\\bin\\claude.exe', args: ['--version'] })
  })

  it('leaves a POSIX path untouched', () => {
    const t = spawnTargetFor('/usr/bin/claude', ['--version'])
    expect(t).toEqual({ file: '/usr/bin/claude', args: ['--version'] })
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
