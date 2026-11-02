import { describe, expect, it } from 'vitest'
import { parseCommand } from '../src/bin/runcastle'
import { parseMoveArgs, parseMoveInArgs } from '../src/move/cli'
import { bytesNeeded } from '../src/move/destination'
import {
  assignTargetFolders,
  encodeClaudeFolder,
  looksWindowsOnly,
  mapSourcePath,
  rewritePathsInText,
  samePath,
  sourceBasename,
} from '../src/move/paths'
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

describe('rewritePathsInText', () => {
  const rules = [
    { from: 'C:\\Users\\me\\Projects\\app', to: '/home/muath/projects/app' },
    { from: 'C:\\Users\\me', to: '/home/muath' },
  ]

  it('rewrites a quoted path in a command, with either slash', () => {
    const forward = 'docker compose -f "C:/Users/me/Projects/app/docker-compose.yml" up -d'
    expect(rewritePathsInText(forward, rules, 'win32')).toBe('docker compose -f "/home/muath/projects/app/docker-compose.yml" up -d')
    const back = 'run C:\\Users\\me\\Projects\\app\\tools\\go.sh now'
    expect(rewritePathsInText(back, rules, 'win32')).toBe('run /home/muath/projects/app/tools/go.sh now')
  })

  it('ignores case on Windows and not elsewhere', () => {
    expect(rewritePathsInText('c:\\users\\ME\\Projects\\APP', rules, 'win32')).toBe('/home/muath/projects/app')
    expect(rewritePathsInText('/Home/a/app', [{ from: '/home/a/app', to: '/x' }], 'linux')).toBe('/Home/a/app')
  })

  it('takes the longest rule, and a shorter one for what only it covers', () => {
    const text = 'C:\\Users\\me\\Projects\\app and C:\\Users\\me\\.tool\\bin'
    expect(rewritePathsInText(text, rules, 'win32')).toBe('/home/muath/projects/app and /home/muath/.tool/bin')
  })

  it('matches whole segments only', () => {
    const text = 'C:\\Users\\me\\Projects\\app-old is another folder'
    expect(rewritePathsInText(text, rules.slice(0, 1), 'win32')).toBe(text)
    expect(rewritePathsInText('/mnt/home/a/app', [{ from: '/home/a/app', to: '/x' }], 'linux')).toBe('/mnt/home/a/app')
  })

  it('leaves text naming no known place alone, and takes a target literally', () => {
    expect(rewritePathsInText('bun run dev', rules, 'win32')).toBe('bun run dev')
    expect(rewritePathsInText('C:\\a', [{ from: 'C:\\a', to: '/b$&c' }], 'win32')).toBe('/b$&c')
    expect(rewritePathsInText('C:\\a', [], 'win32')).toBe('C:\\a')
  })
})

describe('looksWindowsOnly', () => {
  it.each([
    'del "C:\\Users\\me\\x"',
    'cd d:/work',
    'if exist "/home/muath/x" del /f /q "/home/muath/x"',
    'cmd /c reset.bat',
    'powershell -File go.ps1',
    'echo %USERPROFILE%',
  ])('flags %s', (text) => {
    expect(looksWindowsOnly(text)).toBe(true)
  })

  it.each([
    'curl http://localhost:4512/a',
    'bun run db:reset',
    '/home/muath/x',
    'docker compose -f "/home/muath/projects/app/compose.yml" up -d',
    'bun .runcastle/drive-setup.ts',
    'env -u GIT_ASKPASS bun run test',
  ])('leaves %s alone', (text) => {
    expect(looksWindowsOnly(text)).toBe(false)
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
    ).toEqual({
      host: 'me@host',
      dryRun: true,
      yes: false,
      replace: true,
      noRepo: ['a', 'b'],
      reposDir: '/r',
      withEnv: false,
      withClaudeSetup: false,
      also: [],
    })
  })

  it('reads what to carry beyond the defaults', () => {
    const args = parseMoveArgs(['--with-env', '--with-claude-setup', '--also', 'app:media', '--also', 'site:.data'])
    expect(args.withEnv).toBe(true)
    expect(args.withClaudeSetup).toBe(true)
    expect(args.also).toEqual(['app:media', 'site:.data'])
    expect(() => parseMoveArgs(['--also'])).toThrow('needs a value')
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
