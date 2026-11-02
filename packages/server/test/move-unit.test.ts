import { describe, expect, it } from 'vitest'
import { parseCommand } from '../src/bin/runcastle'
import { parseMoveArgs, parseMoveInArgs } from '../src/move/cli'
import { bytesNeeded } from '../src/move/destination'
import { assignTargetFolders, encodeClaudeFolder, mapSourcePath, samePath, sourceBasename } from '../src/move/paths'
import { failureMessage, manualSteps, remoteMoveInCommand, REMOTE_PATH } from '../src/move/remote'
import { formatReport, isBlocked } from '../src/move/report'
import type { MoveReport } from '../src/move/types'

const rules = [
  { from: 'C:\\Users\\user\\Projects\\app', to: '/home/muath/projects/app' },
  { from: 'C:\\Users\\user\\.runcastle', to: '/home/muath/.runcastle' },
]

describe('mapSourcePath', () => {
  it.each([
    ['C:\\Users\\user\\Projects\\app', '/home/muath/projects/app'],
    ['C:\\Users\\user\\Projects\\app\\.sandcastle\\wt', '/home/muath/projects/app/.sandcastle/wt'],
    ['c:\\users\\USER\\projects\\APP\\src', '/home/muath/projects/app/src'],
    ['C:/Users/user/Projects/app/src', '/home/muath/projects/app/src'],
    ['C:\\Users\\user\\.runcastle\\worktrees\\p\\slug', '/home/muath/.runcastle/worktrees/p/slug'],
  ])('maps %s', (input, expected) => {
    expect(mapSourcePath(input, rules, 'win32')).toBe(expected)
  })

  it('matches whole path segments only', () => {
    expect(mapSourcePath('C:\\Users\\user\\Projects\\app-old', rules, 'win32')).toBeNull()
  })

  it('leaves a path with no rule unmapped', () => {
    expect(mapSourcePath('D:\\elsewhere', rules, 'win32')).toBeNull()
  })

  it('prefers the longest rule', () => {
    const nested = [
      { from: '/a', to: '/x' },
      { from: '/a/b', to: '/y' },
    ]
    expect(mapSourcePath('/a/b/c', nested, 'linux')).toBe('/y/c')
  })

  it('keeps case and backslashes as they are on a POSIX source', () => {
    expect(mapSourcePath('/A/b\\c', [{ from: '/A', to: '/x' }], 'linux')).toBe('/x/b\\c')
    expect(mapSourcePath('/a/b', [{ from: '/A', to: '/x' }], 'linux')).toBeNull()
  })
})

describe('source path helpers', () => {
  it('takes the last segment of either kind of path', () => {
    expect(sourceBasename('C:\\Users\\user\\Projects\\_Active\\runcastle\\', 'win32')).toBe('runcastle')
    expect(sourceBasename('/home/a/app', 'linux')).toBe('app')
  })

  it('folds Windows paths when comparing', () => {
    expect(samePath('C:\\A\\b', 'c:/a/B/', 'win32')).toBe(true)
    expect(samePath('/A', '/a', 'linux')).toBe(false)
  })
})

describe('encodeClaudeFolder', () => {
  it("matches Claude Code's real folder names", () => {
    expect(encodeClaudeFolder('C:\\Users\\user\\Projects\\_Active\\runcastle')).toBe(
      'C--Users-user-Projects--Active-runcastle',
    )
    expect(encodeClaudeFolder('/home/muath/.runcastle/worktrees/proj_x/slug')).toBe(
      '-home-muath--runcastle-worktrees-proj-x-slug',
    )
  })

  it('cuts a name past 200 characters and adds a hash, as Claude Code does', () => {
    const long = `/${'a'.repeat(250)}`
    const encoded = encodeClaudeFolder(long)
    expect(encoded.startsWith(`-${'a'.repeat(199)}-`)).toBe(true)
    expect(encoded.length).toBeGreaterThan(200)
    expect(encodeClaudeFolder(`/${'a'.repeat(249)}b`)).not.toBe(encoded)
  })
})

describe('assignTargetFolders', () => {
  it('blocks two moving repos that want one folder', () => {
    const { clashes } = assignTargetFolders([
      { id: 'a', folder: 'app', repoMoves: true },
      { id: 'b', folder: 'app', repoMoves: true },
    ])
    expect(clashes).toEqual(['app'])
  })

  it('lets a project that leaves its repo behind step aside', () => {
    const { clashes, targets } = assignTargetFolders([
      { id: 'a', folder: 'app', repoMoves: true },
      { id: 'b', folder: 'app', repoMoves: false },
    ])
    expect(clashes).toEqual([])
    expect(targets.get('a')).toBe('app')
    expect(targets.get('b')).toBe('app-b')
  })
})

describe('assignTargetFolders, when no project takes the folder', () => {
  it('still gives two projects without repos different paths', () => {
    const { targets } = assignTargetFolders([
      { id: 'a', folder: 'app', repoMoves: false },
      { id: 'b', folder: 'app', repoMoves: false },
    ])
    expect(new Set(targets.values()).size).toBe(2)
  })

  it('leaves a lone project at its plain folder name', () => {
    const { targets } = assignTargetFolders([{ id: 'a', folder: 'app', repoMoves: false }])
    expect(targets.get('a')).toBe('app')
  })
})

describe('the command line', () => {
  it('routes move and move-in', () => {
    expect(parseCommand(['move', 'me@host']).command).toBe('move')
    expect(parseCommand(['move-in', 'p.tar.gz']).command).toBe('move-in')
  })

  it('reads move flags', () => {
    expect(
      parseMoveArgs(['me@host', '--dry-run', '--replace', '--no-repo', 'a', '--no-repo', 'b', '--repos-dir', '/r']),
    ).toEqual({ host: 'me@host', dryRun: true, yes: false, replace: true, noRepo: ['a', 'b'], reposDir: '/r' })
  })

  it('refuses a flag it does not know, rather than ignoring a typo', () => {
    expect(() => parseMoveArgs(['--dryrun'])).toThrow('unknown flag')
    expect(() => parseMoveArgs(['--no-repo'])).toThrow('needs a value')
  })

  it('reads move-in flags', () => {
    expect(parseMoveInArgs(['p.tar.gz', '--replace'])).toEqual({ pack: 'p.tar.gz', check: false, replace: true })
  })
})

describe('the SSH wrapper', () => {
  const pack = '/tmp/runcastle-move-1.tar.gz'
  const flags = { replace: true }

  it("never relies on runcastle being on the PATH of a non-interactive session", () => {
    expect(REMOTE_PATH).toBe('PATH="$HOME/.bun/bin:$PATH"')
    expect(remoteMoveInCommand('p.tar.gz', flags)).toBe(
      'PATH="$HOME/.bun/bin:$PATH" runcastle move-in "$HOME/p.tar.gz" --replace',
    )
  })

  it('prints the exact manual commands when a step fails, and says the pack is kept', () => {
    const message = failureMessage('The copy', 'scp to me@host did not finish', pack, 'me@host', flags)
    expect(message).toContain(`The pack is kept at ${pack}`)
    expect(message).toContain('cd "/tmp"')
    expect(message).toContain('scp "runcastle-move-1.tar.gz" me@host:')
    expect(message).toContain(
      `ssh me@host 'PATH="$HOME/.bun/bin:$PATH" runcastle move-in "$HOME/runcastle-move-1.tar.gz" --replace'`,
    )
  })

  it('leaves a placeholder host in the printed steps when none was given', () => {
    expect(manualSteps('/tmp/p.tar.gz', undefined, { replace: false })[1]).toBe('scp "p.tar.gz" <user@host>:')
  })
})

describe('the report', () => {
  const report: MoveReport = {
    blockers: [],
    projects: [
      { name: 'app', branches: 3, uncommitted: 1, features: 2, chats: 4, repoBytes: 10, repoMoves: true, repoPath: '/r', targetFolder: 'app' },
    ],
    attention: ['app: no remote'],
    staysBehind: ['logins'],
    dataBytes: 1024,
    repoBytes: 1024,
    openChats: 0,
  }

  it('is blocked by the destination, or by a destination that could not answer', () => {
    expect(isBlocked(report, undefined)).toBe(false)
    expect(isBlocked(report, { answer: null })).toBe(true)
    expect(
      isBlocked(report, { answer: { platform: 'linux', blockers: ['x'], notes: [], freeBytes: 1, reposDir: '/r' } }),
    ).toBe(true)
  })

  it('says when the destination was not checked', () => {
    expect(formatReport(report, undefined, [])).toContain('The destination was not checked')
  })

  it('names a destination that could not be reached as a block', () => {
    expect(formatReport(report, { answer: null, detail: 'no route' }, [])).toContain(
      'the destination could not be checked: no route',
    )
  })

  it('asks for room for the pack, its unpacked copy and the checkouts', () => {
    expect(bytesNeeded({ dataBytes: 10, repoBytes: 1 })).toBe(24)
  })
})
