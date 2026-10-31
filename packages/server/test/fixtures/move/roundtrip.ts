/**
 * A whole move between two scratch homes, run under real Bun because a move
 * needs `bun:sqlite` and the suite runs under node. It prints one JSON object of
 * observed facts for `move-roundtrip.test.ts` to assert on.
 *
 * Usage: bun roundtrip.ts <empty scratch dir>
 */
import { createHash } from 'node:crypto'
import { cpSync, existsSync, mkdirSync, readFileSync, utimesSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Feature, Project } from '@runcastle/core'
import { createDb, openRawSqlite } from '../../../src/db/client'
import { runMigrations } from '../../../src/db/migrate'
import type { AppCtx } from '../../../src/db/types'
import { reconcileStaleSessions } from '../../../src/launcher/reconcile'
import { serverRunning } from '../../../src/move/destination'
import { encodeClaudeFolder } from '../../../src/move/paths'
import { packMove } from '../../../src/move/pack'
import { scanMove } from '../../../src/move/scan'
import { systemTar, walkFiles } from '../../../src/move/shell'
import type { MoveEnv, MoveManifest, MoveSql } from '../../../src/move/types'
import { moveIn } from '../../../src/move/unpack'
import { ensureTalkWorktree } from '../../../src/services/git'
import { reconcileStaleRuns } from '../../../src/workflows/reconcile-runs'

const root = process.argv[2]
if (!root) throw new Error('usage: roundtrip.ts <scratch dir>')

const gitEnv = {
  ...process.env,
  GIT_AUTHOR_NAME: 't',
  GIT_AUTHOR_EMAIL: 't@t',
  GIT_COMMITTER_NAME: 't',
  GIT_COMMITTER_EMAIL: 't@t',
}

function sh(cwd: string, ...args: string[]): string {
  const result = Bun.spawnSync(['git', ...args], { cwd, env: gitEnv })
  if (result.exitCode !== 0) throw new Error(`git ${args.join(' ')}: ${result.stderr.toString()}`)
  return result.stdout.toString().trim()
}

function hashTree(dir: string): Record<string, string> {
  const hashes: Record<string, string> = {}
  for (const rel of walkFiles(dir)) {
    if (rel.endsWith('-shm') || rel.endsWith('-wal')) continue
    hashes[rel] = createHash('sha256').update(readFileSync(join(dir, rel))).digest('hex')
  }
  return hashes
}

function makeHome(name: string, platform: string): MoveEnv {
  const home = join(root, name)
  mkdirSync(join(home, '.runcastle'), { recursive: true })
  mkdirSync(join(home, '.claude', 'projects'), { recursive: true })
  return { platform, home, dataDir: join(home, '.runcastle'), claudeDir: join(home, '.claude') }
}

/**
 * A migrated database. In a child process, because drizzle keeps statements open
 * and Windows will not rename a folder while this process holds the file.
 */
function freshDb(env: MoveEnv): void {
  const code = `
    import { createDb } from ${JSON.stringify(join(import.meta.dirname, '..', '..', '..', 'src', 'db', 'client.ts'))}
    import { runMigrations } from ${JSON.stringify(join(import.meta.dirname, '..', '..', '..', 'src', 'db', 'migrate.ts'))}
    runMigrations(createDb(process.argv[2]))
  `
  const script = join(root, 'migrate.ts')
  writeFileSync(script, code)
  const result = Bun.spawnSync([process.execPath, script, join(env.dataDir, 'runcastle.db')])
  if (result.exitCode !== 0) throw new Error(result.stderr.toString())
}

function db(env: MoveEnv): MoveSql {
  return openRawSqlite(join(env.dataDir, 'runcastle.db'), { readonly: false })
}

/** The two sides differ in system, whichever one this test runs on. */
const source = makeHome('old', process.platform === 'win32' ? 'win32' : 'darwin')
const dest = makeHome('new', 'linux')

// --- the old machine ---------------------------------------------------------

const repo = join(source.home, 'work', 'app')
mkdirSync(repo, { recursive: true })
sh(repo, 'init', '-q', '-b', 'main')
writeFileSync(join(repo, '.gitignore'), '.env\nuploads/\nnode_modules/\n')
writeFileSync(join(repo, 'app.txt'), 'one\n')
writeFileSync(join(repo, 'gone.txt'), 'delete me\n')
writeFileSync(join(repo, 'touched.txt'), 'same content\n')
sh(repo, 'add', '.')
sh(repo, 'commit', '-q', '-m', 'first')
sh(repo, 'config', 'branch.main.remote', 'origin')
sh(repo, 'config', 'branch.main.merge', 'refs/heads/main')
writeFileSync(join(repo, 'app.txt'), 'stashed work\n')
sh(repo, 'stash', 'push', '-q', '-m', 'keep me')
sh(repo, 'branch', 'feature/login')
sh(repo, 'branch', 'feature/idle')
sh(repo, 'tag', 'v1')
sh(repo, 'remote', 'add', 'origin', 'https://example.invalid/app.git')

const worktree = join(source.dataDir, 'worktrees', 'proj_a', 'login')
sh(repo, 'worktree', 'add', '-q', worktree, 'feature/login')
writeFileSync(join(worktree, 'app.txt'), 'changed in the talk worktree\n')
writeFileSync(join(worktree, 'draft.md'), 'untracked in the talk worktree\n')

writeFileSync(join(repo, 'app.txt'), 'two\n')
writeFileSync(join(repo, 'notes.md'), 'untracked\n')
writeFileSync(join(repo, '.env'), 'SECRET=1\n')
writeFileSync(join(repo, '.env.local'), 'SECRET=not ignored\n')
writeFileSync(join(repo, '.env.example'), 'SECRET=\n')
mkdirSync(join(repo, 'uploads'))
writeFileSync(join(repo, 'uploads', 'photo.bin'), 'x')
sh(repo, 'rm', '-q', '--cached', 'gone.txt')
Bun.spawnSync(['git', 'commit', '-q', '-m', 'second'], { cwd: repo, env: gitEnv })
sh(repo, 'reset', '-q', '--hard', 'HEAD~1')
writeFileSync(join(repo, 'app.txt'), 'two\n')
writeFileSync(join(repo, 'notes.md'), 'untracked\n')
Bun.spawnSync([process.platform === 'win32' ? 'cmd' : 'rm', ...(process.platform === 'win32' ? ['/c', 'del', 'gone.txt'] : ['gone.txt'])], { cwd: repo })
// A stat-only change, which `git diff` would "fix" by rewriting the index.
utimesSync(join(repo, 'touched.txt'), new Date(2030, 0, 1), new Date(2030, 0, 1))
const nestedRepo = join(repo, 'vendor', 'mylib')
mkdirSync(nestedRepo, { recursive: true })
sh(nestedRepo, 'init', '-q', '-b', 'main')
writeFileSync(join(nestedRepo, '.gitignore'), 'node_modules/\n')
writeFileSync(join(nestedRepo, 'lib.txt'), 'only copy of this file\n')
mkdirSync(join(nestedRepo, 'node_modules'))
writeFileSync(join(nestedRepo, 'node_modules', 'dep.js'), 'ignored by the nested repo')

// A repo with no commits yet: staged work, a remote and a chosen branch name.
const unborn = join(source.home, 'work', 'unborn')
mkdirSync(unborn, { recursive: true })
sh(unborn, 'init', '-q', '-b', 'trunk')
sh(unborn, 'remote', 'add', 'origin', 'https://example.invalid/unborn.git')
writeFileSync(join(unborn, 'staged.txt'), 'staged, never committed\n')
sh(unborn, 'add', 'staged.txt')

freshDb(source)
const sourceDb = db(source)
const transcript = join(source.claudeDir, 'projects', encodeClaudeFolder(worktree), 'conv-1.jsonl')
sourceDb.run(
  'INSERT INTO projects (id, name, repo_path, dev_command, verify_commands, drive_setup_command, drive_stop_command, db_reset_command) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
  'proj_a', 'app', repo, 'bun run dev', 'bun test', 'bun run db:up', 'bun run db:down', 'cmd /c reset.bat',
)
sourceDb.run(
  'INSERT INTO projects (id, name, repo_path) VALUES (?, ?, ?)',
  'proj_gone', 'vanished', join(source.home, 'work', 'vanished'),
)
sourceDb.run('INSERT INTO projects (id, name, repo_path) VALUES (?, ?, ?)', 'proj_unborn', 'unborn', unborn)
sourceDb.run(
  'INSERT INTO project_findings (project_id, key, source, established_at, verified_at, verified_sha) VALUES (?, ?, ?, ?, ?, ?)',
  'proj_a', 'dbResetCommand', 'human', 1, 2, 'abc',
)
sourceDb.run(
  'INSERT INTO project_findings (project_id, key, source, established_at, verified_at, verified_sha) VALUES (?, ?, ?, ?, ?, ?)',
  'proj_a', 'verifyCommands', 'prep', 1, 2, 'abc',
)
for (const [id, slug, status] of [['f1', 'login', 'active'], ['f2', 'idle', 'active']] as const) {
  sourceDb.run(
    'INSERT INTO features (id, project_id, slug, title, one_liner, branch, base_branch, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    id, 'proj_a', slug, slug, slug, `feature/${slug}`, 'main', status, 1,
  )
}
sourceDb.run(
  'INSERT INTO sessions (id, feature_id, kind, cc_session_id, transcript_path, status, worktree_path) VALUES (?, ?, ?, ?, ?, ?, ?)',
  's1', 'f1', 'chat', 'conv-1', transcript, 'live', worktree,
)
const codexTranscript = join(source.dataDir, 'sessions', 's2', 'codex-home', 'sessions', 'rollout.jsonl')
sourceDb.run(
  'INSERT INTO sessions (id, feature_id, kind, cc_session_id, transcript_path, status, worktree_path, runtime) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
  's2', 'f1', 'chat', 'codex-1', codexTranscript, 'ended', worktree, 'codex',
)
// A chat kept in a folder of its own, which maps onto the same new folder as s1.
sourceDb.run(
  'INSERT INTO sessions (id, feature_id, kind, cc_session_id, status, worktree_path) VALUES (?, ?, ?, ?, ?, ?)',
  's3', 'f1', 'chat', 'conv-3', 'ended', worktree,
)
sourceDb.run(
  'INSERT INTO sessions (id, feature_id, kind, cc_session_id, status, worktree_path) VALUES (?, ?, ?, ?, ?, ?)',
  's4', 'f1', 'chat', 'conv-gone', 'ended', worktree,
)
sourceDb.run(
  'INSERT INTO events (project_id, ts, type, message, data) VALUES (?, ?, ?, ?, ?)',
  'proj_a', 1, 'note', `history mentions ${repo}`, null,
)
sourceDb.close()

for (const [rel, body] of [
  ['config.json', JSON.stringify({ model: 'kept-model', burnConcurrency: 2, burnCpus: 3 })],
  ['.env', 'OLD_MACHINE_SECRET=1\n'],
  ['install-id', 'old-install\n'],
  ['sessions/s1/thread.jsonl', '{"i":0}\n'],
  ['sessions/s1/images/a.png', 'png'],
  ['sessions/s1/codex-home/auth.json', '{"token":"must not travel"}'],
  ['sessions/s1/codex-home/sessions/rollout.jsonl', '{}\n'],
  ['sessions/s1/codex-home/config.toml', 'launch file'],
  ['sessions/s1/system-prompt.md', 'DRIVE_SECRET=from a drive env'],
  ['sessions/s1/mcp.json', '{}'],
  ['sessions/s2/thread.jsonl', '{"i":0}\n'],
  ['sessions/s2/codex-home/sessions/rollout.jsonl', '{"codex":true}\n'],
  ['reviews/t1/DIGEST.md', 'digest'],
  ['annotations/n1.png', 'png'],
  ['project-notes/n2.png', 'png'],
  ['cache/bun/huge.bin', 'cache'],
  ['logs/server.log', 'log'],
] as const) {
  const path = join(source.dataDir, rel)
  mkdirSync(join(path, '..'), { recursive: true })
  writeFileSync(path, body)
}
const claudeRel = [
  [encodeClaudeFolder(worktree), 'conv-1.jsonl', '{"cwd":"old"}\n'],
  [encodeClaudeFolder(repo), 'by-hand.jsonl', '{"hand":true}\n'],
  [encodeClaudeFolder(repo), 'memory/MEMORY.md', '- a memory\n'],
  [encodeClaudeFolder(worktree), 'memory/MEMORY.md', '- newer memory\n'],
  ['an-older-folder', 'conv-3.jsonl', '{"older":true}\n'],
  ['an-older-folder', 'memory/MEMORY.md', '- older memory\n'],
  ['some-other-project', 'private.jsonl', '{"other":true}\n'],
] as const
for (const [folder, rel, body] of claudeRel) {
  const path = join(source.claudeDir, 'projects', folder, rel)
  mkdirSync(join(path, '..'), { recursive: true })
  writeFileSync(path, body)
}

// --- the new machine, already holding a trial ----------------------------------

freshDb(dest)
const destDb = db(dest)
destDb.run('INSERT INTO projects (id, name, repo_path) VALUES (?, ?, ?)', 'proj_trial', 'runcastle-trial', '/tmp/trial')
destDb.close()
writeFileSync(join(dest.dataDir, '.env'), 'NEW_MACHINE_SECRET=1\n')
writeFileSync(join(dest.dataDir, 'install-id'), 'new-install\n')
writeFileSync(join(dest.dataDir, 'config.json'), JSON.stringify({ burnConcurrency: 5 }))
const reposDir = join(dest.home, 'projects')

// --- pack, proving the source does not change --------------------------------

const before = hashTree(source.home)
const scanSql = openRawSqlite(join(source.dataDir, 'runcastle.db'), { readonly: true })
const scan = scanMove(source, scanSql, { noRepo: [] })
scanSql.close()
const packPath = join(root, 'move.tar.gz')
const manifest = await packMove({ env: source, scan, open: openRawSqlite, out: packPath })
const after = hashTree(source.home)
const changedOnSource = Object.keys({ ...before, ...after }).filter((rel) => before[rel] !== after[rel])

const pack2 = join(root, 'move-2.tar.gz')
const pack3 = join(root, 'move-3.tar.gz')
cpSync(packPath, pack2)
cpSync(packPath, pack3)

// --- refused and failed moves leave the destination alone --------------------

const destBefore = hashTree(dest.home)
const failures: Record<string, string> = {}
async function failing(name: string, pack: string, replace: boolean): Promise<void> {
  try {
    await moveIn({ pack, env: dest, open: openRawSqlite, replace, reposDir })
    failures[name] = 'did not fail'
  } catch (err) {
    failures[name] = err instanceof Error ? err.message : String(err)
  }
}
await failing('noReplace', pack2, false)
const corrupt = join(root, 'corrupt.tar.gz')
const bytes = readFileSync(pack2)
bytes.fill(0, Math.floor(bytes.length / 2), Math.floor(bytes.length / 2) + 64)
writeFileSync(corrupt, bytes)
await failing('corrupt', corrupt, true)
const destUnchanged = JSON.stringify(destBefore) === JSON.stringify(hashTree(dest.home))
const stagingLeft = walkFiles(root).filter((rel) => rel.includes('.incoming-'))

// --- the move ----------------------------------------------------------------

const result = await moveIn({ pack: packPath, env: dest, open: openRawSqlite, replace: true, reposDir })
const newRepo = join(reposDir, 'app')
const newWorktree = join(dest.dataDir, 'worktrees', 'proj_a', 'login')
const newTranscript = join(dest.claudeDir, 'projects', encodeClaudeFolder(newWorktree), 'conv-1.jsonl')
const moved = db(dest)
const projectRow = moved.all<Record<string, string | null>>("SELECT * FROM projects WHERE id = 'proj_a'")[0]
const sessionRow = moved.all<Record<string, string | null>>("SELECT * FROM sessions WHERE id = 's1'")[0]
const codexRow = moved.all<Record<string, string | null>>("SELECT * FROM sessions WHERE id = 's2'")[0]
const findings = moved.all<Record<string, string | number | null>>('SELECT * FROM project_findings')
const eventText = moved.all<{ message: string }>('SELECT message FROM events')[0].message
const gonePath = moved.all<{ repo_path: string }>("SELECT repo_path FROM projects WHERE id = 'proj_gone'")[0].repo_path
moved.close()

const read = (path: string): string | null => (existsSync(path) ? readFileSync(path, 'utf8') : null)

// --- the destination's first boot --------------------------------------------

process.env.RUNCASTLE_DATA_DIR = dest.dataDir
const bootDb = createDb(join(dest.dataDir, 'runcastle.db'))
runMigrations(bootDb)
const ctx = { db: bootDb, config: {} } as unknown as AppCtx
const reconciled = reconcileStaleSessions(ctx).length
await reconcileStaleRuns(ctx)
const rebuilt = await ensureTalkWorktree(
  { id: 'proj_a', repoPath: newRepo } as Project,
  { slug: 'idle', baseBranch: 'main', branch: 'feature/idle' } as Feature,
)
const statusAfterBoot = (bootDb as unknown as { $client: { query(s: string): { all(): { status: string }[] } } }).$client
  .query("SELECT status FROM sessions WHERE id = 's1'")
  .all()[0].status
;(bootDb as unknown as { $client: { close(): void } }).$client.close()

const facts = {
  changedOnSource,
  failures,
  destUnchanged,
  stagingLeft,
  blockers: scan.report.blockers,
  attention: scan.report.attention,
  packDeleted: !existsSync(packPath),
  manifestHasAuth: manifest.files.some((f) => f.path.includes('auth.json')),
  manifestHasCache: manifest.files.some((f) => f.path.includes('cache/') || f.path.includes('logs/')),
  sourceRefs: sh(repo, 'for-each-ref', '--format=%(objectname) %(refname)'),
  destRefs: sh(newRepo, 'for-each-ref', '--format=%(objectname) %(refname)'),
  destRemote: sh(newRepo, 'remote', 'get-url', 'origin'),
  destBranch: sh(newRepo, 'rev-parse', '--abbrev-ref', 'HEAD'),
  mainFile: read(join(newRepo, 'app.txt')),
  mainUntracked: read(join(newRepo, 'notes.md')),
  mainDeletedFile: existsSync(join(newRepo, 'gone.txt')),
  mainEnv: existsSync(join(newRepo, '.env')),
  worktreeFile: read(join(newWorktree, 'app.txt')),
  worktreeUntracked: read(join(newWorktree, 'draft.md')),
  worktreeBranch: sh(newWorktree, 'rev-parse', '--abbrev-ref', 'HEAD'),
  rebuiltWorktree: rebuilt,
  rebuiltBranch: sh(rebuilt, 'rev-parse', '--abbrev-ref', 'HEAD'),
  expected: { newRepo, newWorktree, newTranscript, reposDir, oldRepo: repo },
  repoPath: projectRow.repo_path,
  worktreePath: sessionRow.worktree_path,
  transcriptPath: sessionRow.transcript_path,
  codexTranscriptPath: codexRow.transcript_path,
  expectedCodex: join(dest.dataDir, 'sessions', 's2', 'codex-home', 'sessions', 'rollout.jsonl'),
  codexFile: read(join(dest.dataDir, 'sessions', 's2', 'codex-home', 'sessions', 'rollout.jsonl')),
  olderChat: read(join(dest.claudeDir, 'projects', encodeClaudeFolder(newWorktree), 'conv-3.jsonl')),
  claudeFiles: walkFiles(join(dest.claudeDir, 'projects', encodeClaudeFolder(newWorktree))).sort(),
  claudeMemories: walkFiles(join(dest.claudeDir, 'projects', encodeClaudeFolder(newWorktree)))
    .filter((rel) => rel.startsWith('memory/'))
    .map((rel) => read(join(dest.claudeDir, 'projects', encodeClaudeFolder(newWorktree), rel)))
    .sort(),
  nestedFile: read(join(newRepo, 'vendor', 'mylib', 'lib.txt')),
  nestedIgnored: existsSync(join(newRepo, 'vendor', 'mylib', 'node_modules')),
  unignoredEnv: existsSync(join(newRepo, '.env.local')),
  envExample: existsSync(join(newRepo, '.env.example')),
  launchFiles: ['system-prompt.md', 'mcp.json', 'codex-home/config.toml'].filter((rel) =>
    existsSync(join(dest.dataDir, 'sessions', 's1', rel)),
  ),
  stashList: sh(newRepo, 'stash', 'list'),
  stashFile: Bun.spawnSync(['git', 'show', 'stash@{0}:app.txt'], { cwd: newRepo }).stdout.toString(),
  upstream: sh(newRepo, 'config', 'branch.main.merge'),
  unbornBranch: sh(join(reposDir, 'unborn'), 'symbolic-ref', '--short', 'HEAD'),
  unbornRemote: sh(join(reposDir, 'unborn'), 'remote', 'get-url', 'origin'),
  unbornFile: read(join(reposDir, 'unborn', 'staged.txt')),
  gonePath,
  eventText,
  dev: projectRow.dev_command,
  verify: projectRow.verify_commands,
  driveSetup: projectRow.drive_setup_command,
  driveStop: projectRow.drive_stop_command,
  dbReset: projectRow.db_reset_command,
  findings,
  transcript: read(newTranscript),
  handChat: read(join(dest.claudeDir, 'projects', encodeClaudeFolder(newRepo), 'by-hand.jsonl')),
  memory: read(join(dest.claudeDir, 'projects', encodeClaudeFolder(newRepo), 'memory', 'MEMORY.md')),
  otherChat: existsSync(join(dest.claudeDir, 'projects', 'some-other-project')),
  threadLog: read(join(dest.dataDir, 'sessions', 's1', 'thread.jsonl')),
  chatImage: read(join(dest.dataDir, 'sessions', 's1', 'images', 'a.png')),
  codexRollout: read(join(dest.dataDir, 'sessions', 's1', 'codex-home', 'sessions', 'rollout.jsonl')),
  auth: existsSync(join(dest.dataDir, 'sessions', 's1', 'codex-home', 'auth.json')),
  env: read(join(dest.dataDir, '.env')),
  installId: read(join(dest.dataDir, 'install-id')),
  config: JSON.parse(read(join(dest.dataDir, 'config.json')) ?? '{}'),
  reportFile: read(result.reportPath),
  result,
  reconciled,
  statusAfterBoot,
}

// --- a server is told apart by the data dir it serves --------------------------

const port = 45871
writeFileSync(join(dest.dataDir, 'config.json'), JSON.stringify({ serverPort: port, burnConcurrency: 5 }))
let healthBody = JSON.stringify({ ok: true, dataDir: dest.dataDir })
const health = Bun.serve({ port, hostname: '127.0.0.1', fetch: () => new Response(healthBody) })
const ownServer = await serverRunning(dest)
healthBody = JSON.stringify({ ok: true, dataDir: join(root, 'somewhere-else') })
const otherServer = await serverRunning(dest)
healthBody = 'not json'
const unreadableServer = await serverRunning(dest)
health.stop(true)
const noServer = await serverRunning(dest)
const slow = Bun.serve({
  port,
  hostname: '127.0.0.1',
  fetch: async () => {
    await Bun.sleep(4000)
    return new Response(JSON.stringify({ dataDir: dest.dataDir }))
  },
})
const busyServer = await serverRunning(dest)
slow.stop(true)

// --- a pack altered after it was made ------------------------------------------

/** Unpack a good pack, change it, and pack it again as a new file. */
function alteredPack(name: string, change: (dir: string, manifest: MoveManifest) => void): string {
  const dir = join(root, `alter-${name}`)
  mkdirSync(dir)
  const out = `alter-${name}.tar.gz`
  const tar = (args: string[], cwd: string): void => {
    const result = Bun.spawnSync([systemTar(), ...args], { cwd })
    if (result.exitCode !== 0) throw new Error(result.stderr.toString())
  }
  tar(['-xzf', 'move-3-copy.tar.gz', '-C', `alter-${name}`], root)
  const manifestPath = join(dir, 'manifest.json')
  const altered = JSON.parse(readFileSync(manifestPath, 'utf8')) as MoveManifest
  change(dir, altered)
  writeFileSync(manifestPath, JSON.stringify(altered))
  tar(['-czf', join('..', out), '.'], dir)
  return join(root, out)
}
const hashOf = (path: string): string => createHash('sha256').update(readFileSync(path)).digest('hex')
cpSync(pack3, join(root, 'move-3-copy.tar.gz'))

const clean = makeHome('clean', 'linux')
const cleanRepos = join(clean.home, 'projects')
async function failsOnClean(pack: string): Promise<string> {
  try {
    await moveIn({ pack, env: clean, open: openRawSqlite, replace: false, reposDir: cleanRepos })
    return 'did not fail'
  } catch (err) {
    return err instanceof Error ? err.message : String(err)
  }
}
const alteredFile = await failsOnClean(
  alteredPack('file', (dir) => writeFileSync(join(dir, 'data', 'reviews', 't1', 'DIGEST.md'), 'tampered')),
)
const alteredRows = await failsOnClean(
  alteredPack('rows', (_dir, manifest) => {
    manifest.rowCounts.sessions = 99
  }),
)
const alteredRef = await failsOnClean(
  alteredPack('ref', (_dir, manifest) => {
    manifest.projects[0].refs['refs/tags/v1'] = '0'.repeat(40)
  }),
)
const newerPack = await failsOnClean(
  alteredPack('newer', (_dir, manifest) => {
    manifest.migrations.push('9999_from_the_future.sql')
  }),
)
const relativeRepos = await (async () => {
  try {
    await moveIn({ pack: join(root, 'move-3-copy.tar.gz'), env: clean, open: openRawSqlite, replace: false, reposDir: 'relative/projects' })
    return 'did not fail'
  } catch (err) {
    return err instanceof Error ? err.message : String(err)
  }
})()
const cleanLeft = walkFiles(clean.home)

// --- uncommitted work that will not apply ---------------------------------------

const patchPack = alteredPack('patch', (dir, manifest) => {
  const patch = join(dir, 'wip', 'proj_a', 'main', 'changes.patch')
  writeFileSync(patch, 'this is not a patch\n')
  const entry = manifest.files.find((f) => f.path === 'wip/proj_a/main/changes.patch')
  if (entry) entry.sha256 = hashOf(patch)
})
const patched = await moveIn({ pack: patchPack, env: clean, open: openRawSqlite, replace: false, reposDir: cleanRepos })
const keptFolder = patched.wipKept[0]?.folder ?? ''

// --- each thing that blocks a real move --------------------------------------

sh(repo, 'branch', 'feature/stuck')
const stuck = join(source.dataDir, 'worktrees', 'proj_a', 'stuck')
sh(repo, 'worktree', 'add', '-q', stuck, 'feature/stuck')
writeFileSync(join(stuck, 'app.txt'), 'theirs\n')
sh(stuck, 'commit', '-q', '-am', 'stuck side')
writeFileSync(join(worktree, 'app.txt'), 'ours\n')
sh(worktree, 'commit', '-q', '-am', 'ours side')
Bun.spawnSync(['git', 'merge', 'feature/stuck'], { cwd: worktree, env: gitEnv })

const twin = join(source.home, 'elsewhere', 'app')
mkdirSync(twin, { recursive: true })
sh(twin, 'init', '-q', '-b', 'main')
const blockedDb = db(source)
blockedDb.run("INSERT INTO projects (id, name, repo_path) VALUES ('proj_twin', 'app-twin', ?)", twin)
blockedDb.run("INSERT INTO runs (id, feature_id, workflow, status, started_at) VALUES ('r1', 'f1', 'ticket-burner', 'running', 1)")
blockedDb.close()
Bun.spawnSync(['git', 'stash', '-u'], { cwd: repo, env: gitEnv })
sh(repo, 'checkout', '-q', 'feature/idle')
const shallow = join(source.home, 'work', 'shallow')
sh(root, 'clone', '-q', '--depth', '1', `file://${(repo).replace(/\\/g, '/')}`, shallow)
const shallowDb = db(source)
shallowDb.run("INSERT INTO projects (id, name, repo_path) VALUES ('proj_shallow', 'shallow', ?)", shallow)
shallowDb.close()

const blockedSql = openRawSqlite(join(source.dataDir, 'runcastle.db'), { readonly: true })
const blocked = scanMove(source, blockedSql, { noRepo: [] }).report.blockers
const unblocked = scanMove(source, blockedSql, { noRepo: ['app-twin'] })
blockedSql.close()

// --- a second move sets the first aside --------------------------------------

const second = await moveIn({ pack: pack3, env: dest, open: openRawSqlite, replace: true, reposDir })
console.log(
  JSON.stringify({
    ...facts,
    secondSetAside: second.setAside.map((s) => s.from),
    secondRepoFile: read(join(newRepo, 'app.txt')),
    servers: { ownServer, otherServer, unreadableServer, noServer, busyServer },
    shallowBlocked: blocked.filter((line) => line.includes('shallow')),
    relativeRepos,
    altered: { alteredFile, alteredRows, alteredRef, newerPack, cleanLeft },
    patch: {
      wipKept: patched.wipKept,
      appliedOthers: patched.wipApplied,
      keptPatch: read(join(keptFolder, 'changes.patch')),
      keptCopy: read(join(keptFolder, 'files', 'app.txt')),
      keptUntracked: read(join(keptFolder, 'files', 'notes.md')),
      checkoutUntouched: read(join(cleanRepos, 'app', 'app.txt')),
    },
    blocked,
    clashAfterNoRepo: unblocked.report.blockers.filter((line) => line.includes('want the folder')),
    twinTarget: unblocked.projects.find((p) => p.id === 'proj_twin')?.targetFolder,
  }),
)
