import {
  chmodSync,
  closeSync,
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  readSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { checkDestination, reposDirOf } from './destination'
import { encodeClaudeFolder, looksWindowsOnly, mapSourcePath, rewritePathsInText, type PathRule } from './paths'
import { countRows } from './pack'
import { claudeJsonPath, HOST_COMMANDS } from './scan'
import { formatBytes, freeBytes, gitOrThrow, run, stamp, systemTar, walkFiles } from './shell'
import { hashFile } from './tar'
import type {
  ChangedCommand,
  CheckoutWip,
  ClaudeSetup,
  ClaudeSetupResult,
  DestinationQuestion,
  MoveEnv,
  MoveInResult,
  MoveManifest,
  MoveProject,
  MoveSql,
  OpenSql,
  WindowsCommand,
} from './types'

/**
 * Bring a pack in on the new machine. Everything is built beside its final
 * place and checked there; only then do renames put it in position, so a failure
 * before that point leaves the destination exactly as it was, and a failure
 * during the renames undoes the ones already made.
 */

/** Settings that describe the machine, not the human: the destination keeps its own. */
const MACHINE_SETTINGS = ['burnConcurrency', 'burnCpus'] as const

/** Data-dir files that belong to this machine and survive a replace. */
const KEPT_FILES = ['.env', 'install-id'] as const

/** Long enough that Claude Code's own cleanup never reaches a moved chat. */
const CHAT_KEEP_DAYS = 3650

export interface MoveInInput {
  pack: string
  env: MoveEnv
  open: OpenSql
  replace: boolean
  reposDir?: string
  log?: (line: string) => void
  /** Run the `claude` CLI on this machine. A test replaces it, so that no test installs anything. */
  runClaude?: (args: string[]) => boolean
}

function extract(pack: string, into: string): void {
  // By relative name from the pack's folder: a Windows tar reads `C:` as a host.
  const result = run(systemTar(), ['-xzf', basename(pack), '-C', into], { cwd: dirname(resolve(pack)) })
  if (!result.ok) throw new Error(`could not unpack ${pack}: ${result.stderr.trim()}`)
}

async function verifyFiles(staging: string, manifest: MoveManifest): Promise<void> {
  for (const file of manifest.files) {
    const path = join(staging, file.path)
    if (!existsSync(path)) throw new Error(`the pack is missing ${file.path}`)
    if ((await hashFile(path)) !== file.sha256) throw new Error(`${file.path} did not arrive intact`)
  }
}

function pathRules(manifest: MoveManifest, env: MoveEnv, reposDir: string): PathRule[] {
  return [
    ...manifest.projects.map((p) => ({ from: p.repoPath, to: join(reposDir, p.targetFolder) })),
    { from: manifest.source.dataDir, to: env.dataDir },
  ]
}

/** Old Claude folder name → its name for the new path. */
function claudeRenames(manifest: MoveManifest, rules: PathRule[]): Map<string, string> {
  const platform = manifest.source.platform
  const renames = new Map<string, string>()
  for (const folder of manifest.claudeFolders) {
    const mapped = mapSourcePath(folder.cwd, rules, platform)
    renames.set(folder.name, mapped ? encodeClaudeFolder(mapped) : folder.name)
  }
  return renames
}

/**
 * A transcript's path on the new machine, or `null` when it did not travel.
 * Claude transcripts follow their renamed folder. Codex keeps its own under the
 * data dir, which the ordinary rules cover.
 */
function mapTranscript(
  path: string,
  manifest: MoveManifest,
  rules: PathRule[],
  renames: Map<string, string>,
  env: MoveEnv,
): string | null {
  const platform = manifest.source.platform
  const projects = `${manifest.source.claudeDir}${platform === 'win32' ? '\\' : '/'}projects`
  const rest = mapSourcePath(path, [{ from: projects, to: '' }], platform)
  if (rest === null) return mapSourcePath(path, rules, platform)
  const [, folder, ...tail] = rest.split('/')
  const key = platform === 'win32' ? folder.toLowerCase() : folder
  for (const [oldName, newName] of renames) {
    if ((platform === 'win32' ? oldName.toLowerCase() : oldName) === key) {
      return join(env.claudeDir, 'projects', newName, ...tail)
    }
  }
  return null
}

/** What the stored commands became, for the report. */
interface RewrittenCommands {
  changed: ChangedCommand[]
  windows: WindowsCommand[]
}

/**
 * Keep every stored command, with the paths in it pointing at the new machine. The
 * home folder counts here, though not for stored paths, because a command can name
 * a tool or a dev database anywhere under it.
 */
function rewriteCommands(sql: MoveSql, rules: PathRule[], platform: string): RewrittenCommands {
  const result: RewrittenCommands = { changed: [], windows: [] }
  const projects = sql.all<Record<string, string | null> & { id: string; name: string }>('SELECT * FROM projects')
  for (const project of projects) {
    for (const { column, label } of HOST_COMMANDS) {
      const value = project[column]
      if (!value) continue
      const next = rewritePathsInText(value, rules, platform)
      if (next !== value) {
        sql.run(`UPDATE projects SET ${column} = ? WHERE id = ?`, next, project.id)
        result.changed.push({ project: project.name, field: label, from: value, to: next })
      }
      if (looksWindowsOnly(next)) result.windows.push({ project: project.name, field: label, value: next })
    }
  }
  return result
}

/** Rewrite the database copy in one transaction. Returns how many paths matched nothing. */
function rewriteDatabase(
  sql: MoveSql,
  manifest: MoveManifest,
  rules: PathRule[],
  renames: Map<string, string>,
  env: MoveEnv,
): { unmapped: number; commands: RewrittenCommands } {
  const platform = manifest.source.platform
  let unmapped = 0
  let commands: RewrittenCommands
  sql.run('BEGIN')
  try {
    for (const row of sql.all<{ id: string; repo_path: string }>('SELECT id, repo_path FROM projects')) {
      const mapped = mapSourcePath(row.repo_path, rules, platform)
      if (mapped) sql.run('UPDATE projects SET repo_path = ? WHERE id = ?', mapped, row.id)
      else unmapped++
    }
    const sessions = sql.all<{ id: string; worktree_path: string; transcript_path: string | null }>(
      'SELECT id, worktree_path, transcript_path FROM sessions',
    )
    for (const row of sessions) {
      const worktree = mapSourcePath(row.worktree_path, rules, platform)
      if (worktree) sql.run('UPDATE sessions SET worktree_path = ? WHERE id = ?', worktree, row.id)
      else unmapped++
      if (!row.transcript_path) continue
      const transcript = mapTranscript(row.transcript_path, manifest, rules, renames, env)
      if (transcript) sql.run('UPDATE sessions SET transcript_path = ? WHERE id = ?', transcript, row.id)
      else unmapped++
    }
    commands = rewriteCommands(sql, [...rules, { from: manifest.source.home, to: env.home }], platform)
    // That proof came from the other system. A drive on this one stamps them again.
    if (platform !== env.platform) sql.run('UPDATE project_findings SET verified_at = NULL, verified_sha = NULL')
    sql.run('COMMIT')
  } catch (err) {
    sql.run('ROLLBACK')
    throw err
  }
  return { unmapped, commands }
}

/** Rebuild one repo from its bundle in a folder of its own, ready to be renamed into place. */
function rebuildRepo(project: MoveProject, staging: string, path: string): void {
  mkdirSync(path, { recursive: true })
  gitOrThrow(path, ['init', '-q'])
  // A repo with no commits has no bundle, but keeps its remotes and branch name.
  if (Object.keys(project.refs).length > 0) {
    const bundle = join(staging, 'repos', `${project.id}.bundle`)
    gitOrThrow(path, ['fetch', '-q', '--no-tags', '--update-head-ok', bundle, '+refs/*:refs/*'])
  }
  for (const remote of project.remotes) gitOrThrow(path, ['remote', 'add', remote.name, remote.url])
  for (const { key, value } of project.config) gitOrThrow(path, ['config', '--local', '--add', key, value])
  if (project.headBranch) {
    gitOrThrow(path, ['symbolic-ref', 'HEAD', `refs/heads/${project.headBranch}`])
    if (project.headSha) gitOrThrow(path, ['reset', '-q', '--hard'])
  } else if (project.headSha) {
    gitOrThrow(path, ['checkout', '-q', '-f', '--detach', project.headSha])
  }
  restoreStash(project, path)
  if (project.excludeRules) {
    mkdirSync(join(path, '.git', 'info'), { recursive: true })
    writeFileSync(join(path, '.git', 'info', 'exclude'), project.excludeRules)
  }
  for (const rel of project.carried) {
    mkdirSync(dirname(join(path, rel)), { recursive: true })
    copyFileSync(join(staging, 'carried', project.id, rel), join(path, rel))
  }
}

/**
 * A bundle carries `refs/stash` but not the log that `git stash` reads, so the
 * stash would exist and `git stash list` would not show it. Storing it again
 * makes it an ordinary stash, at the same commit.
 */
function restoreStash(project: MoveProject, path: string): void {
  const sha = project.refs['refs/stash']
  if (!sha) return
  gitOrThrow(path, ['update-ref', '-d', 'refs/stash'])
  gitOrThrow(path, ['-c', 'user.name=runcastle', '-c', 'user.email=runcastle@localhost', 'stash', 'store', '-m', 'moved from the old machine', sha])
}

/** Every ref must point where it pointed on the old machine. */
function verifyRefs(project: MoveProject, path: string): void {
  const listing = gitOrThrow(path, ['for-each-ref', '--format=%(objectname) %(refname)'])
  const found = new Map(
    listing
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        const space = line.indexOf(' ')
        return [line.slice(space + 1).trim(), line.slice(0, space)] as const
      }),
  )
  for (const [ref, sha] of Object.entries(project.refs)) {
    if (found.get(ref) !== sha) throw new Error(`${project.name}: ${ref} did not arrive at ${sha}`)
  }
}

/** Every conversation a session recorded has to have come with its transcript. */
function verifyConversations(staging: string, manifest: MoveManifest): void {
  for (const { id, folder } of manifest.conversations) {
    if (!existsSync(join(staging, 'claude', folder, `${id}.jsonl`))) {
      throw new Error(`the pack is missing the transcript of conversation ${id}`)
    }
  }
}

function verifyRowCounts(sql: MoveSql, manifest: MoveManifest): void {
  const counts = countRows(sql)
  for (const [table, count] of Object.entries(manifest.rowCounts)) {
    if (counts[table] !== count) {
      throw new Error(`the database table ${table} has ${counts[table]} rows, the pack says ${count}`)
    }
  }
}

function mergeSettings(staged: string, current: string): void {
  if (!existsSync(staged)) return
  const incoming = JSON.parse(readFileSync(staged, 'utf8')) as Record<string, unknown>
  let own: Record<string, unknown> = {}
  try {
    own = JSON.parse(readFileSync(current, 'utf8')) as Record<string, unknown>
  } catch {
    // no settings of its own yet: the machine-tuned ones go back to their defaults
  }
  for (const key of MACHINE_SETTINGS) {
    if (key in own) incoming[key] = own[key]
    else delete incoming[key]
  }
  writeFileSync(staged, `${JSON.stringify(incoming, null, 2)}\n`)
}

/** Renames made so far, undone in reverse if a later one fails. */
class Swap {
  private readonly made: { from: string; to: string }[] = []

  rename(from: string, to: string): void {
    mkdirSync(dirname(to), { recursive: true })
    renameSync(from, to)
    this.made.push({ from, to })
  }

  undo(): void {
    for (const { from, to } of this.made.reverse()) {
      try {
        renameSync(to, from)
      } catch {
        // the report of the original failure matters more than this one
      }
    }
  }
}

/**
 * Move a staged Claude folder into place, merging into a folder that is already
 * there. Two old folders can map to one new name, and neither may lose a file: a
 * clash with different content is kept beside the other under a marked name.
 */
function placeClaudeFolder(from: string, to: string, swap: Swap, when: string): void {
  if (!existsSync(to)) {
    swap.rename(from, to)
    return
  }
  if (statSync(from).isDirectory() && statSync(to).isDirectory()) {
    for (const entry of readdirSync(from)) placeClaudeFolder(join(from, entry), join(to, entry), swap, when)
    return
  }
  if (readFileSync(from).equals(readFileSync(to))) return
  let aside = `${to}.moved-${when}`
  for (let n = 2; existsSync(aside); n++) aside = `${to}.moved-${when}-${n}`
  swap.rename(from, aside)
}

/** The pack stores every file private and plain, and Windows has no bits to keep, so a script's are given back here. */
function restoreScriptBits(dir: string): void {
  for (const rel of walkFiles(dir)) {
    const path = join(dir, rel)
    const start = Buffer.alloc(2)
    const fd = openSync(path, 'r')
    try {
      readSync(fd, start, 0, 2, 0)
    } finally {
      closeSync(fd)
    }
    if (start.toString() === '#!') chmodSync(path, 0o700)
  }
}

/**
 * Settle the staged Claude settings: what the new machine alone had stays, and
 * Claude Code is told to keep chats, or its 30-day cleanup would delete moved ones.
 */
function settleClaudeSettings(staged: string, current: string): boolean {
  if (!existsSync(staged)) return false
  const incoming = JSON.parse(readFileSync(staged, 'utf8')) as Record<string, unknown>
  let own: Record<string, unknown> = {}
  try {
    own = JSON.parse(readFileSync(current, 'utf8')) as Record<string, unknown>
  } catch {
    // nothing of its own yet
  }
  const keepChats = incoming.cleanupPeriodDays === undefined
  const settled = { ...own, ...incoming, ...(keepChats ? { cleanupPeriodDays: CHAT_KEEP_DAYS } : {}) }
  writeFileSync(staged, `${JSON.stringify(settled, null, 2)}\n`)
  return keepChats
}

/** Put the old machine's MCP servers beside the new one's, in Claude Code's own user file. */
function addMcpServers(env: MoveEnv, servers: Record<string, unknown>, aside: string): boolean {
  if (Object.keys(servers).length === 0) return true
  const path = claudeJsonPath(env)
  let own: Record<string, unknown> = {}
  if (existsSync(path)) {
    try {
      own = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>
    } catch {
      return false
    }
    copyFileSync(path, aside)
  }
  const mcpServers = { ...(own.mcpServers as Record<string, unknown> | undefined), ...servers }
  writeFileSync(path, `${JSON.stringify({ ...own, mcpServers }, null, 2)}\n`, { mode: 0o600 })
  return true
}

/** Plugins are built per system, so Claude Code installs them again instead of the pack carrying them. */
function installPlugins(setup: ClaudeSetup, runClaude: (args: string[]) => boolean): string[] {
  const failed: string[] = []
  for (const marketplace of setup.marketplaces) {
    if (!runClaude(['plugin', 'marketplace', 'add', marketplace])) failed.push(`plugin marketplace ${marketplace}`)
  }
  for (const plugin of setup.plugins) {
    if (!runClaude(['plugin', 'install', plugin])) failed.push(`plugin ${plugin}`)
  }
  return failed
}

/** The real `claude`. A non-interactive SSH session may not have its folder on the PATH. */
function claudeOn(env: MoveEnv): (args: string[]) => boolean {
  const PATH = [join(env.home, '.local', 'bin'), process.env.PATH].filter(Boolean).join(':')
  return (args) => run('claude', args, { env: { ...process.env, PATH } }).ok
}

/** Put a checkout's uncommitted work back, or keep it beside the repo if it will not apply. */
function applyWip(
  project: MoveProject,
  wip: CheckoutWip,
  repoPath: string,
  checkout: string,
  staging: string,
): string | null {
  const source = join(staging, 'wip', project.id, wip.key)
  const patch = join(source, 'changes.patch')
  const applied = !existsSync(patch) || run('git', ['apply', '--whitespace=nowarn', patch], { cwd: checkout }).ok
  if (!applied) {
    const kept = join(`${repoPath}.uncommitted`, wip.key)
    mkdirSync(dirname(kept), { recursive: true })
    cpSync(source, kept, { recursive: true })
    return kept
  }
  for (const rel of wip.untracked) {
    const from = join(source, 'files', rel)
    if (!existsSync(from)) continue
    mkdirSync(dirname(join(checkout, rel)), { recursive: true })
    copyFileSync(from, join(checkout, rel))
  }
  return null
}

/** The worktree a talk checkout's uncommitted work goes back into. */
function addTalkWorktree(repoPath: string, path: string, wip: CheckoutWip): void {
  mkdirSync(dirname(path), { recursive: true })
  if (wip.branch && run('git', ['worktree', 'add', '-q', path, wip.branch], { cwd: repoPath }).ok) return
  gitOrThrow(repoPath, ['worktree', 'add', '-q', '--detach', path, wip.sha ?? 'HEAD'])
}

function renderReport(manifest: MoveManifest, result: Omit<MoveInResult, 'reportPath'>): string {
  const lines = [
    '# runcastle move report',
    '',
    `Moved ${new Date(manifest.createdAt).toISOString()} from ${manifest.source.platform} (${manifest.source.home}).`,
    '',
    '## Repos',
    ...result.repos.map((r) => `- ${r.name}: ${r.path}`),
  ]
  if (result.wipStuck.length > 0) {
    lines.push('', `## Uncommitted work still in ${result.stagingKept}/wip`, '')
    for (const w of result.wipStuck) lines.push(`- ${w}`)
  }
  if (result.commandsWindows.length > 0) {
    lines.push('', '## Commands that only work on Windows', '')
    for (const c of result.commandsWindows) lines.push(`- ${c.project}, ${c.field}: \`${c.value}\``)
  }
  if (result.commandsChanged.length > 0) {
    lines.push('', '## Commands with their paths rewritten', '')
    for (const c of result.commandsChanged) lines.push(`- ${c.project}, ${c.field}: \`${c.from}\` became \`${c.to}\``)
  }
  if (result.claudeSetup && result.claudeSetup.failed.length > 0) {
    lines.push('', '## Claude setup that did not go in', '')
    for (const item of result.claudeSetup.failed) lines.push(`- ${item}`)
  }
  if (result.wipKept.length > 0) {
    lines.push('', '## Uncommitted work kept beside the repo', '')
    for (const w of result.wipKept) lines.push(`- ${w.project} (${w.key}): ${w.folder}`)
  }
  if (result.setAside.length > 0) {
    lines.push('', '## Set aside', '')
    for (const s of result.setAside) lines.push(`- ${s.from} is now ${s.to}`)
  }
  if (result.unmappedPaths > 0) {
    lines.push('', `${result.unmappedPaths} stored paths matched no known folder and were left as they were.`)
  }
  if (manifest.reportText) lines.push('', '## The report before the move', '', '```', manifest.reportText, '```')
  return `${lines.join('\n')}\n`
}

export async function moveIn(input: MoveInInput): Promise<MoveInResult> {
  const { pack, env, open, replace } = input
  const log = input.log ?? (() => {})
  const reposDir = reposDirOf(env, input.reposDir)
  const when = stamp()
  const staging = `${env.dataDir}.incoming-${when}`
  const stagedRepos: string[] = []
  let keepStaging = false

  try {
    if (!existsSync(pack)) throw new Error(`no pack at ${pack}`)
    const free = freeBytes(dirname(env.dataDir))
    const unpackBytes = statSync(pack).size * 3
    if (free !== null && free < unpackBytes) {
      throw new Error(`not enough disk to unpack: about ${formatBytes(unpackBytes)} needed, ${formatBytes(free)} free`)
    }
    mkdirSync(staging, { recursive: true })
    log('Unpacking')
    extract(pack, staging)
    const manifest = JSON.parse(readFileSync(join(staging, 'manifest.json'), 'utf8')) as MoveManifest
    if (manifest.formatVersion !== 1) throw new Error('this pack was made by a newer runcastle')

    const question: DestinationQuestion = {
      runcastleVersion: manifest.runcastleVersion,
      sourcePlatform: manifest.source.platform,
      migrations: manifest.migrations,
      targetFolders: manifest.projects.filter((p) => p.repoMoves).map((p) => p.targetFolder),
      dataBytes: 0,
      // Already unpacked, so only the checkouts are still to come.
      repoBytes: manifest.files.filter((f) => f.path.startsWith('repos/')).reduce((total, f) => total + f.size, 0),
    }
    const answer = await checkDestination(question, env, { replace, reposDir, open })
    if (answer.blockers.length > 0) throw new Error(answer.blockers.join('\n'))

    log('Checking every file')
    await verifyFiles(staging, manifest)
    verifyConversations(staging, manifest)

    const rules = pathRules(manifest, env, reposDir)
    const renames = claudeRenames(manifest, rules)

    log('Rewriting paths in the database')
    const sql = open(join(staging, 'db', 'runcastle.db'), { readonly: false })
    let rewritten: { unmapped: number; commands: RewrittenCommands }
    try {
      verifyRowCounts(sql, manifest)
      rewritten = rewriteDatabase(sql, manifest, rules, renames, env)
    } finally {
      sql.close()
    }

    const repoStages = new Map<string, string>()
    for (const project of manifest.projects) {
      if (!project.repoMoves) continue
      log(`Rebuilding ${project.name}`)
      const stage = join(reposDir, `${project.targetFolder}.incoming-${when}`)
      stagedRepos.push(stage)
      rebuildRepo(project, staging, stage)
      verifyRefs(project, stage)
      repoStages.set(project.id, stage)
    }

    // The final data dir, assembled in staging so it goes into place in one rename.
    const data = join(staging, 'data')
    mkdirSync(data, { recursive: true })
    renameSync(join(staging, 'db', 'runcastle.db'), join(data, 'runcastle.db'))
    mergeSettings(join(data, 'config.json'), join(env.dataDir, 'config.json'))
    for (const file of KEPT_FILES) {
      if (existsSync(join(env.dataDir, file))) copyFileSync(join(env.dataDir, file), join(data, file))
    }

    const stagedSetup = join(staging, 'claude-setup')
    let chatsKept = false
    if (manifest.claudeSetup && existsSync(stagedSetup)) {
      restoreScriptBits(stagedSetup)
      chatsKept = settleClaudeSettings(join(stagedSetup, 'settings.json'), join(env.claudeDir, 'settings.json'))
    }

    log('Swapping into place')
    const swap = new Swap()
    const setAside: { from: string; to: string }[] = []
    const asideOf = (path: string): string => `${path}.before-move-${when}`
    try {
      for (const project of manifest.projects) {
        const stage = repoStages.get(project.id)
        if (!stage) continue
        const target = join(reposDir, project.targetFolder)
        if (existsSync(target)) {
          swap.rename(target, asideOf(target))
          setAside.push({ from: target, to: asideOf(target) })
        }
        swap.rename(stage, target)
      }
      const claudeProjects = join(env.claudeDir, 'projects')
      mkdirSync(claudeProjects, { recursive: true })
      const asideNames = new Set<string>()
      for (const folder of manifest.claudeFolders) {
        const newName = renames.get(folder.name) ?? folder.name
        const target = join(claudeProjects, newName)
        if (existsSync(target) && !asideNames.has(newName) && replace) {
          swap.rename(target, asideOf(target))
          setAside.push({ from: target, to: asideOf(target) })
        }
        asideNames.add(newName)
        const staged = join(staging, 'claude', folder.name)
        if (existsSync(staged)) placeClaudeFolder(staged, target, swap, when)
      }
      if (manifest.claudeSetup && existsSync(stagedSetup)) {
        for (const entry of readdirSync(stagedSetup)) {
          const target = join(env.claudeDir, entry)
          if (existsSync(target)) {
            swap.rename(target, asideOf(target))
            setAside.push({ from: target, to: asideOf(target) })
          }
          swap.rename(join(stagedSetup, entry), target)
        }
      }
      if (existsSync(env.dataDir)) {
        swap.rename(env.dataDir, asideOf(env.dataDir))
        setAside.push({ from: env.dataDir, to: asideOf(env.dataDir) })
      }
      swap.rename(data, env.dataDir)
    } catch (err) {
      swap.undo()
      throw err
    }

    log('Putting uncommitted work back')
    const wipApplied: string[] = []
    const wipKept: { project: string; key: string; folder: string }[] = []
    const wipStuck: string[] = []
    for (const project of manifest.projects) {
      if (!project.repoMoves) continue
      const repoPath = join(reposDir, project.targetFolder)
      for (const wip of project.wip) {
        const checkout = wip.key === 'main' ? repoPath : join(env.dataDir, 'worktrees', project.id, wip.key)
        let kept: string | null
        try {
          if (wip.key !== 'main') addTalkWorktree(repoPath, checkout, wip)
          kept = applyWip(project, wip, repoPath, checkout, staging)
        } catch {
          try {
            kept = join(`${repoPath}.uncommitted`, wip.key)
            cpSync(join(staging, 'wip', project.id, wip.key), kept, { recursive: true })
          } catch {
            // Staging is now the only copy, so it and the pack stay.
            keepStaging = true
            wipStuck.push(`${project.name} (${wip.key})`)
            continue
          }
        }
        if (kept) wipKept.push({ project: project.name, key: wip.key, folder: kept })
        else wipApplied.push(`${project.name} (${wip.key})`)
      }
    }

    // Last, because neither can undo itself and neither is worth failing a finished move.
    let claudeSetup: ClaudeSetupResult | undefined
    if (manifest.claudeSetup) {
      const failed: string[] = []
      if (!addMcpServers(env, manifest.claudeSetup.mcpServers, asideOf(claudeJsonPath(env)))) {
        failed.push(`MCP servers: could not read ${claudeJsonPath(env)}`)
      }
      log('Installing your Claude plugins again')
      failed.push(...installPlugins(manifest.claudeSetup, input.runClaude ?? claudeOn(env)))
      claudeSetup = { failed, chatsKept }
    }

    const partial = {
      repos: manifest.projects
        .filter((p) => p.repoMoves)
        .map((p) => ({ name: p.name, path: join(reposDir, p.targetFolder) })),
      commandsChanged: rewritten.commands.changed,
      commandsWindows: rewritten.commands.windows,
      envCarried: manifest.envCarried,
      ...(claudeSetup ? { claudeSetup } : {}),
      wipApplied,
      wipKept,
      wipStuck,
      ...(keepStaging ? { stagingKept: staging } : {}),
      unmappedPaths: rewritten.unmapped,
      setAside,
    }
    const reportPath = join(env.dataDir, 'move-report.md')
    writeFileSync(reportPath, renderReport(manifest, partial))
    if (!keepStaging) rmSync(pack, { force: true })
    return { ...partial, reportPath }
  } finally {
    if (!keepStaging) rmSync(staging, { recursive: true, force: true })
    for (const stage of stagedRepos) rmSync(stage, { recursive: true, force: true })
  }
}

