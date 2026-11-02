/**
 * A move that asks for everything a machine can give up: `.env` files, ignored
 * data and the human's Claude setup. Run under real Bun, like `roundtrip.ts`, and
 * prints one JSON object of observed facts for `move-carry.test.ts`.
 *
 * Usage: bun carry.ts <empty scratch dir>
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, symlinkSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { openRawSqlite } from '../../../src/db/client'
import { packMove } from '../../../src/move/pack'
import { scanMove, windowsCommandLines } from '../../../src/move/scan'
import type { MoveEnv } from '../../../src/move/types'
import { moveIn } from '../../../src/move/unpack'

const root = process.argv[2]
if (!root) throw new Error('usage: carry.ts <scratch dir>')

function put(path: string, body: string): void {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, body)
}

function sh(cwd: string, ...args: string[]): void {
  const result = Bun.spawnSync(['git', ...args], { cwd })
  if (result.exitCode !== 0) throw new Error(`git ${args.join(' ')}: ${result.stderr.toString()}`)
}

function makeHome(name: string, platform: string): MoveEnv {
  const home = join(root, name)
  mkdirSync(join(home, '.runcastle'), { recursive: true })
  mkdirSync(join(home, '.claude', 'projects'), { recursive: true })
  return { platform, home, dataDir: join(home, '.runcastle'), claudeDir: join(home, '.claude') }
}

/** In a child process, so no handle keeps Windows from renaming the data dir. */
function freshDb(env: MoveEnv): void {
  const script = join(root, 'migrate.ts')
  const src = join(import.meta.dirname, '..', '..', '..', 'src', 'db')
  writeFileSync(
    script,
    `import { createDb } from ${JSON.stringify(join(src, 'client.ts'))}
     import { runMigrations } from ${JSON.stringify(join(src, 'migrate.ts'))}
     runMigrations(createDb(process.argv[2]))`,
  )
  const result = Bun.spawnSync([process.execPath, script, join(env.dataDir, 'runcastle.db')])
  if (result.exitCode !== 0) throw new Error(result.stderr.toString())
}

const source = makeHome('old', process.platform === 'win32' ? 'win32' : 'darwin')
const dest = makeHome('new', 'linux')

// --- the old machine ---------------------------------------------------------

const repo = join(source.home, 'work', 'app')
mkdirSync(repo, { recursive: true })
sh(repo, 'init', '-q', '-b', 'main')
sh(repo, 'config', 'user.name', 't')
sh(repo, 'config', 'user.email', 't@t')
put(join(repo, '.gitignore'), '.env\n.env.local\nuploads/\n.worktrees/\ncache/\n')
put(join(repo, 'a.txt'), 'one\n')
sh(repo, 'add', '.')
sh(repo, 'commit', '-q', '-m', 'first')
put(join(repo, '.env'), 'ROOT_SECRET=1\n')
put(join(repo, 'pkg', '.env.local'), 'PKG_SECRET=1\n')
put(join(repo, '.env.staging'), 'NOT_IGNORED_SECRET=1\n')
put(join(repo, '.env.example'), 'ROOT_SECRET=\n')
put(join(repo, '.worktrees', 'old', '.env'), 'STALE_COPY=1\n')
put(join(repo, 'uploads', 'deep', 'a.png'), 'png')
put(join(repo, 'cache', 'b.bin'), 'rebuildable')
put(join(repo, '.git', 'info', 'exclude'), '# a comment\r\nscratch/\r\n')

freshDb(source)
const sourceDb = openRawSqlite(join(source.dataDir, 'runcastle.db'), { readonly: false })
sourceDb.run(
  'INSERT INTO projects (id, name, repo_path, dev_command, drive_setup_command, drive_stop_command, db_reset_command, drive_instructions) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
  'proj_a',
  'app',
  repo,
  'bun run dev',
  `docker compose -f "${repo}/compose.yml" up`,
  'bun .runcastle/drive-stop.ts',
  `if exist "${join(source.home, 'dev.db')}" del /f /q "${join(source.home, 'dev.db')}" & echo D:\\dev\\app.db`,
  `The repo at ${repo} is yours. Logs are in ${join(source.home, '.dev', 'logs')}.`,
)
sourceDb.close()

put(join(source.claudeDir, 'rules', 'plain.md'), 'be plain\n')
put(join(source.claudeDir, 'agents', 'coder.md'), 'an agent\n')
put(join(source.claudeDir, 'skills', 'real', 'SKILL.md'), 'real skill\n')
put(join(source.claudeDir, '.credentials.json'), '{"token":"must not travel"}')
put(join(source.claudeDir, 'history.jsonl'), 'must not travel\n')
put(
  join(source.claudeDir, 'settings.json'),
  JSON.stringify({ model: 'kept', enabledPlugins: { 'good@market': true, 'bad@market': true, 'off@unused': false } }),
)
put(
  join(source.claudeDir, 'plugins', 'known_marketplaces.json'),
  JSON.stringify({ market: { source: { source: 'github', repo: 'owner/market' } }, unused: { source: { repo: 'owner/unused' } } }),
)
put(join(source.claudeDir, 'plugins', 'cache', 'built', 'for-windows.bin'), 'must not travel')
put(join(source.home, '.claude.json'), JSON.stringify({ oauthAccount: 'must not travel', mcpServers: { neon: { type: 'http' } } }))

// Junctions need no privilege on Windows, and the type is ignored elsewhere.
const elsewhere = join(source.home, 'elsewhere', 'linked')
put(join(elsewhere, 'SKILL.md'), 'linked skill\n')
put(join(elsewhere, 'run.sh'), '#!/bin/sh\necho hi\n')
put(join(elsewhere, 'node_modules', 'x', 'index.js'), 'built here')
put(join(elsewhere, '.git', 'HEAD'), 'not part of a skill')
symlinkSync(elsewhere, join(source.claudeDir, 'skills', 'linked'), 'junction')
symlinkSync(join(source.home, 'no-such-folder'), join(source.claudeDir, 'skills', 'broken'), 'junction')

// --- the new machine ---------------------------------------------------------

freshDb(dest)
put(join(dest.claudeDir, '.credentials.json'), '{"token":"the new machine login"}')
put(join(dest.claudeDir, 'settings.json'), JSON.stringify({ theme: 'dark', model: 'replaced' }))
put(join(dest.claudeDir, 'rules', 'trial.md'), 'a rule from the trial\n')
put(join(dest.home, '.claude.json'), JSON.stringify({ hasCompletedOnboarding: true, mcpServers: { own: { type: 'http' } } }))

// --- the move ----------------------------------------------------------------

const options = { noRepo: [], withEnv: true, withClaudeSetup: true, also: ['app:uploads'] }
const sql = openRawSqlite(join(source.dataDir, 'runcastle.db'), { readonly: true })
const scan = scanMove(source, sql, options)
const windowsLines = windowsCommandLines(sql, scan.projects, source)
const plain = scanMove(source, sql, { noRepo: [] })
const badAlso = scanMove(source, sql, { noRepo: [], also: ['app:missing', 'app:../outside', 'nope:x', 'no-colon'] })
sql.close()

const packPath = join(root, 'move.tar.gz')
const manifest = await packMove({ env: source, scan, open: openRawSqlite, out: packPath })

const claudeCalls: string[] = []
const reposDir = join(dest.home, 'projects')
const result = await moveIn({
  pack: packPath,
  env: dest,
  open: openRawSqlite,
  replace: true,
  reposDir,
  runClaude: (args) => {
    claudeCalls.push(args.join(' '))
    return !args.includes('bad@market')
  },
})

const newRepo = join(reposDir, 'app')
const read = (path: string): string | null => (existsSync(path) ? readFileSync(path, 'utf8') : null)
const moved = openRawSqlite(join(dest.dataDir, 'runcastle.db'), { readonly: true })
const row = moved.all<Record<string, string | null>>("SELECT * FROM projects WHERE id = 'proj_a'")[0]
moved.close()

console.log(
  JSON.stringify({
    expected: { newRepo, destHome: dest.home },
    attention: scan.report.attention,
    staysBehind: scan.report.staysBehind,
    plainStaysBehind: plain.report.staysBehind,
    plainAttention: plain.report.attention,
    plainCarried: plain.projects[0].carried,
    plainHasSetup: 'claudeSetup' in plain,
    badAlso: badAlso.report.blockers,
    windowsLines,
    carried: scan.projects[0].carried,
    packedPaths: manifest.files.map((file) => file.path),
    claudeCalls,
    result,
    rootEnv: read(join(newRepo, '.env')),
    pkgEnv: read(join(newRepo, 'pkg', '.env.local')),
    stagingEnv: read(join(newRepo, '.env.staging')),
    staleEnv: existsSync(join(newRepo, '.worktrees')),
    upload: read(join(newRepo, 'uploads', 'deep', 'a.png')),
    cacheFile: existsSync(join(newRepo, 'cache')),
    exclude: read(join(newRepo, '.git', 'info', 'exclude')),
    driveSetup: row.drive_setup_command,
    driveStop: row.drive_stop_command,
    dbReset: row.db_reset_command,
    driveInstructions: row.drive_instructions,
    rule: read(join(dest.claudeDir, 'rules', 'plain.md')),
    trialRule: read(join(dest.claudeDir, 'rules', 'trial.md')),
    agent: read(join(dest.claudeDir, 'agents', 'coder.md')),
    realSkill: read(join(dest.claudeDir, 'skills', 'real', 'SKILL.md')),
    linkedSkill: read(join(dest.claudeDir, 'skills', 'linked', 'SKILL.md')),
    linkedModules: existsSync(join(dest.claudeDir, 'skills', 'linked', 'node_modules')),
    linkedGit: existsSync(join(dest.claudeDir, 'skills', 'linked', '.git')),
    scriptIsExecutable: (statSync(join(dest.claudeDir, 'skills', 'linked', 'run.sh')).mode & 0o100) !== 0,
    login: read(join(dest.claudeDir, '.credentials.json')),
    history: existsSync(join(dest.claudeDir, 'history.jsonl')),
    pluginCache: existsSync(join(dest.claudeDir, 'plugins', 'cache')),
    settings: JSON.parse(read(join(dest.claudeDir, 'settings.json')) ?? '{}'),
    claudeJson: JSON.parse(read(join(dest.home, '.claude.json')) ?? '{}'),
    aside: readdirSync(dest.claudeDir).filter((name) => name.includes('.before-move-')),
    claudeJsonAside: readdirSync(dest.home).filter((name) => name.startsWith('.claude.json.before-move-')),
    report: read(result.reportPath),
  }),
)
