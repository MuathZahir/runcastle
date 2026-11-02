import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import {
  assignTargetFolders,
  encodeClaudeFolder,
  looksWindowsOnly,
  rewritePathsInText,
  sourceBasename,
} from './paths'
import {
  formatBytes,
  git,
  gitOrThrow,
  isSymlink,
  linkInPath,
  nulList,
  pathBytes,
  walkFiles,
  walkFollowing,
  walkSymlinks,
} from './shell'
import type {
  CheckoutWip,
  ClaudeFolder,
  ClaudeSetup,
  MoveEnv,
  MoveOptions,
  MoveProject,
  MoveReport,
  MoveScan,
  MoveSql,
  ProjectLine,
} from './types'

/**
 * What a move would do, read from the old machine without changing it. The
 * database is opened read-only, which is why this works with the server up:
 * the dry run's warnings have to arrive before anything is cut off.
 */

/** Everything in the data dir that travels, as folders or files under it. */
export const DATA_ENTRIES = [
  'config.json',
  'sessions',
  'reviews',
  'annotations',
  'project-notes',
  'design-crops',
  'stories',
] as const

/**
 * The project settings a move keeps, with the paths inside them rewritten. They
 * are never cleared: a command either works on the new system or names what is
 * wrong when it first runs, and that beats making the human prepare every project
 * again.
 */
export const HOST_COMMANDS = [
  { column: 'dev_command', label: 'dev command' },
  { column: 'setup_command', label: 'setup command' },
  { column: 'verify_commands', label: 'verify commands' },
  { column: 'drive_setup_command', label: 'drive setup command' },
  { column: 'drive_stop_command', label: 'drive stop command' },
  { column: 'db_reset_command', label: 'database reset command' },
  { column: 'drive_instructions', label: 'drive instructions' },
] as const

/** What makes up a human's Claude setup, under the Claude dir. Logins are not in it. */
const CLAUDE_SETUP_ENTRIES = ['CLAUDE.md', 'rules', 'skills', 'agents', 'commands', 'settings.json'] as const

function staysBehind(options: MoveOptions): string[] {
  return [
    options.withEnv ? 'logins' : '.env files and logins',
    'Codex auth copies',
    'logs and caches',
    'the install id',
    "Claude's file undo checkpoints",
    ...(options.withClaudeSetup ? [] : ['global Claude rules, skills and settings']),
    'Claude chats outside these repos',
  ]
}

type ProjectRow = { id: string; name: string; repo_path: string } & Record<
  (typeof HOST_COMMANDS)[number]['column'],
  string | null
>

interface SessionRow {
  project_id: string | null
  feature_id: string | null
  status: string
  worktree_path: string
  cc_session_id: string | null
  runtime: string | null
}

interface FeatureRow {
  id: string
  project_id: string
  slug: string
  title: string
  branch: string
  status: string
}

interface RunRow {
  feature_id: string
}

function count(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? '' : 's'}`
}

function repoFacts(repoPath: string): {
  refs: Record<string, string>
  remotes: { name: string; url: string }[]
  config: { key: string; value: string }[]
  headBranch?: string
  headSha?: string
} {
  const refs: Record<string, string> = {}
  const listing = git(repoPath, ['for-each-ref', '--format=%(objectname) %(refname)'])
  for (const line of listing.stdout.split('\n')) {
    const space = line.indexOf(' ')
    if (space > 0) refs[line.slice(space + 1).trim()] = line.slice(0, space)
  }
  const remotes: { name: string; url: string }[] = []
  for (const name of git(repoPath, ['remote']).stdout.split('\n').map((n) => n.trim()).filter(Boolean)) {
    const url = git(repoPath, ['remote', 'get-url', name])
    if (url.ok) remotes.push({ name, url: url.stdout.trim() })
  }
  const settings = git(repoPath, ['config', '--local', '-z', '--get-regexp', '^(branch\\.|user\\.|core\\.hookspath)'])
  const config = nulList(settings.stdout).map((entry) => {
    const newline = entry.indexOf('\n')
    return newline < 0 ? { key: entry, value: '' } : { key: entry.slice(0, newline), value: entry.slice(newline + 1) }
  })
  return { refs, remotes, config, ...headOf(repoPath) }
}

function headOf(path: string): { headBranch?: string; headSha?: string } {
  const branch = git(path, ['symbolic-ref', '--quiet', '--short', 'HEAD'])
  const sha = git(path, ['rev-parse', '--verify', '--quiet', 'HEAD'])
  return {
    ...(branch.ok ? { headBranch: branch.stdout.trim() } : {}),
    ...(sha.ok ? { headSha: sha.stdout.trim() } : {}),
  }
}

/** Whether a checkout is stopped in the middle of a merge, rebase, cherry-pick or revert. */
function midOperation(path: string): string | null {
  const gitDirResult = git(path, ['rev-parse', '--absolute-git-dir'])
  if (!gitDirResult.ok) return null
  const gitDir = gitDirResult.stdout.trim()
  const marks: [string, string][] = [
    ['MERGE_HEAD', 'a merge'],
    ['rebase-merge', 'a rebase'],
    ['rebase-apply', 'a rebase'],
    ['CHERRY_PICK_HEAD', 'a cherry-pick'],
    ['REVERT_HEAD', 'a revert'],
  ]
  return marks.find(([file]) => existsSync(join(gitDir, file)))?.[1] ?? null
}

/** Local ignore rules a bundle does not carry, or nothing when the file has only its comments. */
function excludeRules(repoPath: string): string | null {
  try {
    const rules = readFileSync(join(repoPath, '.git', 'info', 'exclude'), 'utf8').replace(/\r\n/g, '\n')
    return rules.split('\n').some((line) => line.trim() && !line.startsWith('#')) ? rules : null
  } catch {
    return null
  }
}

/** A `.env` file, by name: example files hold no secrets and are left to travel. */
function isEnvFile(rel: string): boolean {
  const name = rel.slice(rel.lastIndexOf('/') + 1)
  return /^\.env(\..+)?$/.test(name) && !/\.(example|sample|template)$/.test(name)
}

function checkoutWip(key: string, path: string): CheckoutWip {
  const { headBranch, headSha } = headOf(path)
  // `git status`, not `git diff --name-only`: under GIT_OPTIONAL_LOCKS it leaves the
  // index alone, where `git diff` refreshes it, and it compares content, not stat data.
  const status = gitOrThrow(path, ['status', '--porcelain=v1', '-z', '--no-renames', '--untracked-files=no'])
  const changed = nulList(status).map((entry) => entry.slice(3))
  const nested: string[] = []
  const loose: string[] = []
  for (const rel of nulList(gitOrThrow(path, ['ls-files', '-o', '--exclude-standard', '-z']))) {
    // Not every repo ignores this folder. A worktree left in it is reported as one.
    if (isBurnerPath(rel)) continue
    const bare = rel.replace(/\/$/, '')
    if (!rel.endsWith('/') || linkInPath(path, bare)) {
      loose.push(bare)
      continue
    }
    // A folder that is a repo of its own. Its own ignore rules keep its `node_modules` out.
    nested.push(bare)
    loose.push(...nulList(gitOrThrow(join(path, rel), ['ls-files', '-co', '--exclude-standard', '-z'])).map((inner) => `${rel}${inner}`))
  }
  // With no commit to diff against, staged files can only travel as whole copies.
  const candidates = headSha ? loose : [...changed, ...loose]
  const links = candidates.map((rel) => linkInPath(path, rel))
  const untracked = candidates.filter((_, i) => links[i] === null)
  return {
    key,
    path,
    ...(headBranch ? { branch: headBranch } : {}),
    ...(headSha ? { sha: headSha } : {}),
    tracked: headSha ? changed : [],
    untracked: untracked.filter((rel) => !isEnvFile(rel)),
    nested,
    heldBack: untracked.filter(isEnvFile),
    symlinks: [...new Set(links.filter((link) => link !== null))],
  }
}

/** What the human should know about a checkout's uncommitted work. */
function wipAttention(project: string, wip: CheckoutWip): string[] {
  const where = wip.key === 'main' ? '' : ` (${wip.key})`
  const lines = wip.nested.map(
    (rel) => `${project}${where}: ${rel} is a git repo of its own; its files travel, its history does not`,
  )
  if (wip.heldBack.length > 0) lines.push(`${project}${where}: ${wip.heldBack.join(', ')} stays behind, though git does not ignore it`)
  if (wip.symlinks.length > 0) lines.push(`${project}${where}: untracked symlinks stay behind: ${wip.symlinks.join(', ')}`)
  if (wip.untracked.length > 0) {
    const shown = wip.untracked.slice(0, 3).join(', ')
    const more = wip.untracked.length > 3 ? `, and ${wip.untracked.length - 3} more` : ''
    lines.push(`${project}${where}: untracked files travel as they are: ${shown}${more}`)
  }
  return lines
}

function hasWork(wip: CheckoutWip): boolean {
  return wip.tracked.length > 0 || wip.untracked.length > 0
}

/**
 * Ignored paths in a checkout with their sizes, skipping every `node_modules`.
 * The paths are as git gives them, not their top folders: `apps/web/dist` stays
 * behind, and saying `apps` would read as if the app itself did.
 */
function ignoredEntries(repoPath: string, carried: (rel: string) => boolean): string[] {
  const listing = git(repoPath, ['ls-files', '-o', '-i', '--exclude-standard', '--directory', '-z'])
  return nulList(listing.stdout)
    .map((rel) => rel.replace(/\/$/, ''))
    .filter((rel) => !rel.split('/').includes('node_modules') && !isBurnerPath(rel) && !carried(rel))
    .sort()
    .map((rel) => {
      const bytes = pathBytes(join(repoPath, rel))
      return bytes >= 1024 * 1024 ? `${rel} (${formatBytes(bytes)})` : rel
    })
}

/**
 * Ignored `.env` files in a checkout. Dot-folders stay out, because that is where
 * other worktrees and tools keep stale copies of them.
 */
function ignoredEnvFiles(repoPath: string): string[] {
  const listing = git(repoPath, ['ls-files', '-o', '-i', '--exclude-standard', '-z', '--', ':(glob)**/.env', ':(glob)**/.env.*'])
  return nulList(listing.stdout).filter((rel) => {
    const folders = rel.split('/').slice(0, -1)
    return isEnvFile(rel) && !folders.some((folder) => folder.startsWith('.') || folder === 'node_modules')
  })
}

/** One `--also` request, or `null` when it does not name a path inside a project's repo. */
function parseAlso(value: string): { project: string; path: string } | null {
  const colon = value.indexOf(':')
  if (colon < 1) return null
  const path = value.slice(colon + 1).replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+$/, '')
  if (!path || path.startsWith('/') || /^[A-Za-z]:/.test(path) || path.split('/').includes('..')) return null
  return { project: value.slice(0, colon), path }
}

/** Where burns leave their worktrees inside a repo: their own branches hold their work. */
function isBurnerPath(rel: string): boolean {
  return rel === '.sandcastle' || rel.startsWith('.sandcastle/')
}

/** Commits on local branches that no remote-tracking ref holds. */
function commitsOnNoRemote(repoPath: string): number {
  const count = git(repoPath, ['rev-list', '--count', '--branches', '--not', '--remotes'])
  return count.ok ? Number(count.stdout.trim()) : 0
}

function stashCount(repoPath: string): number {
  return git(repoPath, ['stash', 'list']).stdout.split('\n').filter(Boolean).length
}

/** Worktrees outside runcastle's own folder that hold uncommitted changes. */
function leftoverWorktrees(repoPath: string, talkRoot: string): string[] {
  const listing = git(repoPath, ['worktree', 'list', '--porcelain']).stdout
  const paths = listing
    .split('\n')
    .filter((line) => line.startsWith('worktree '))
    .map((line) => line.slice('worktree '.length).trim())
    .slice(1)
  const talk = talkRoot.replace(/\\/g, '/').toLowerCase()
  return paths.filter((path) => {
    if (path.replace(/\\/g, '/').toLowerCase().startsWith(talk)) return false
    return existsSync(path) && git(path, ['status', '--porcelain']).stdout.trim().length > 0
  })
}

/** Local git hooks, which a bundle does not carry. Sample hooks do not count. */
function localHooks(project: string, repoPath: string): string[] {
  try {
    const hooks = readdirSync(join(repoPath, '.git', 'hooks')).filter((name) => !name.endsWith('.sample'))
    return hooks.length > 0 ? [`${project}: local git hooks stay behind: ${hooks.join(', ')}`] : []
  } catch {
    return []
  }
}

function usesLfsOrSubmodules(repoPath: string): boolean {
  const holds = (file: string, text: string): boolean => {
    try {
      return readFileSync(join(repoPath, file), 'utf8').includes(text)
    } catch {
      return false
    }
  }
  return holds('.gitmodules', '[submodule') || holds('.gitattributes', 'filter=lfs')
}

function repoBytes(repoPath: string): number {
  return pathBytes(join(repoPath, '.git', 'objects'))
}

/** Whether `path` holds a git repo with its own `.git`. */
function isRepo(path: string): boolean {
  return existsSync(join(path, '.git')) && git(path, ['rev-parse', '--git-dir']).ok
}

/** Chat files in each Claude project folder, as `conversation id → folder name`. */
function conversationFolders(projectsDir: string): Map<string, string> {
  const found = new Map<string, string>()
  let folders: string[]
  try {
    folders = readdirSync(projectsDir)
  } catch {
    return found
  }
  for (const folder of folders) {
    let names: string[]
    try {
      names = readdirSync(join(projectsDir, folder))
    } catch {
      continue
    }
    for (const name of names) {
      if (name.endsWith('.jsonl')) found.set(name.slice(0, -'.jsonl'.length), folder)
    }
  }
  return found
}

/**
 * The Claude folders that travel: the folder of every project repo and every
 * path a session ran in, so chats started by hand in those repos come too. A
 * name over Claude's limit carries a hash, so a folder is also found by the
 * conversations recorded against it.
 */
function findClaudeFolders(
  env: MoveEnv,
  repoPaths: string[],
  sessions: SessionRow[],
): { folders: ClaudeFolder[]; conversations: { id: string; folder: string }[]; missing: number } {
  const projectsDir = join(env.claudeDir, 'projects')
  const owned = new Map<string, string>()
  const claim = (name: string, cwd: string): void => {
    if (!owned.has(name)) owned.set(name, cwd)
  }
  const cwds = new Set([...repoPaths, ...sessions.map((s) => s.worktree_path)])
  const onDisk = new Map<string, string>()
  try {
    for (const name of readdirSync(projectsDir)) onDisk.set(fold(env, name), name)
  } catch {
    return { folders: [], conversations: [], missing: 0 }
  }
  for (const cwd of cwds) {
    const name = onDisk.get(fold(env, encodeClaudeFolder(cwd)))
    if (name) claim(name, cwd)
  }
  const onDiskConversations = conversationFolders(projectsDir)
  const conversations = new Map<string, string>()
  const missing = new Set<string>()
  for (const session of sessions) {
    const id = session.cc_session_id
    if (!id || (session.runtime ?? 'claude-code') !== 'claude-code') continue
    const folder = onDiskConversations.get(id)
    if (!folder) {
      missing.add(id)
      continue
    }
    claim(folder, session.worktree_path)
    conversations.set(id, folder)
  }
  return {
    folders: [...owned].map(([name, cwd]) => ({ name, cwd })),
    conversations: [...conversations].map(([id, folder]) => ({ id, folder })),
    missing: missing.size,
  }
}

/** Claude Code's own user file: beside the Claude dir by default, inside it when the dir is moved. */
export function claudeJsonPath(env: MoveEnv): string {
  return env.claudeDir === join(env.home, '.claude') ? join(env.home, '.claude.json') : join(env.claudeDir, '.claude.json')
}

function readJsonObject(path: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'))
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}

/** What `--with-claude-setup` carries, and the links it could not follow. */
function findClaudeSetup(env: MoveEnv): { setup: ClaudeSetup; broken: string[] } {
  const broken: string[] = []
  const files = CLAUDE_SETUP_ENTRIES.filter((entry) => existsSync(join(env.claudeDir, entry))).flatMap((entry) =>
    walkFollowing(join(env.claudeDir, entry), entry, broken),
  )
  const settings = readJsonObject(join(env.claudeDir, 'settings.json'))
  const enabled = (settings.enabledPlugins ?? {}) as Record<string, unknown>
  const plugins = Object.keys(enabled).filter((id) => enabled[id] === true)
  const known = readJsonObject(join(env.claudeDir, 'plugins', 'known_marketplaces.json')) as Record<
    string,
    { source?: { repo?: string; url?: string } }
  >
  const needed = new Set(plugins.map((id) => id.slice(id.lastIndexOf('@') + 1)))
  const marketplaces = Object.keys(known)
    .filter((name) => needed.has(name))
    .flatMap((name) => known[name].source?.repo ?? known[name].source?.url ?? [])
  const mcpServers = (readJsonObject(claudeJsonPath(env)).mcpServers ?? {}) as Record<string, unknown>
  return { setup: { files, marketplaces, plugins, mcpServers }, broken }
}

function fold(env: MoveEnv, name: string): string {
  return env.platform === 'win32' ? name.toLowerCase() : name
}

/** Symlinks in the folders that travel, which the pack leaves out. */
function dataSymlinks(env: MoveEnv, folders: ClaudeFolder[]): string[] {
  const inData = DATA_ENTRIES.flatMap((entry) => {
    const path = join(env.dataDir, entry)
    if (isSymlink(path)) return [entry]
    try {
      if (!statSync(path).isDirectory()) return []
    } catch {
      return []
    }
    return walkSymlinks(path).map((rel) => `${entry}/${rel}`)
  })
  const inClaude = folders.flatMap((folder) =>
    walkSymlinks(join(env.claudeDir, 'projects', folder.name)).map((rel) => `claude/${folder.name}/${rel}`),
  )
  return [...inData, ...inClaude]
}

function wipBytes(projects: MoveProject[]): number {
  let total = 0
  for (const project of projects) {
    for (const wip of project.wip) {
      for (const rel of [...wip.tracked, ...wip.untracked]) total += pathBytes(join(wip.path, rel))
    }
    for (const rel of project.carried) total += pathBytes(join(project.repoPath, rel))
  }
  return total
}

function dataBytes(env: MoveEnv, folders: ClaudeFolder[]): number {
  const data = DATA_ENTRIES.reduce((total, entry) => total + pathBytes(join(env.dataDir, entry)), 0)
  const claude = folders.reduce(
    (total, folder) => total + pathBytes(join(env.claudeDir, 'projects', folder.name)),
    0,
  )
  return data + claude + pathBytes(join(env.dataDir, 'runcastle.db'))
}

/**
 * Read the talk worktrees of one project. A shipped feature's worktree holds
 * nothing the branch does not, and the boot sweep removes it anyway.
 */
function scanTalkWorktrees(
  env: MoveEnv,
  project: ProjectRow,
  features: FeatureRow[],
): { wips: CheckoutWip[]; stopped: string[] } {
  const root = join(env.dataDir, 'worktrees', project.id)
  const wips: CheckoutWip[] = []
  const stopped: string[] = []
  let names: string[]
  try {
    names = readdirSync(root)
  } catch {
    return { wips, stopped }
  }
  for (const name of names) {
    const status = features.find((f) => f.project_id === project.id && f.slug === name)?.status
    if (status === 'shipped') continue
    const path = join(root, name)
    if (!git(path, ['rev-parse', '--git-dir']).ok) continue
    const operation = midOperation(path)
    if (operation) stopped.push(`${project.name}: the talk worktree ${name} is in the middle of ${operation}. Finish or abort it`)
    const wip = checkoutWip(name, path)
    if (hasWork(wip)) wips.push(wip)
  }
  return { wips, stopped }
}

/** Read everything a move needs from the old machine, and decide what blocks it. */
export function scanMove(env: MoveEnv, sql: MoveSql, options: MoveOptions): MoveScan {
  const projectRows = sql.all<ProjectRow>('SELECT * FROM projects')
  const sessionRows = sql.all<SessionRow>(
    'SELECT project_id, feature_id, status, worktree_path, cc_session_id, runtime FROM sessions',
  )
  const featureRows = sql.all<FeatureRow>(
    'SELECT id, project_id, slug, title, branch, status FROM features',
  )
  const running = sql.all<RunRow>("SELECT feature_id FROM runs WHERE status = 'running'")

  const blockers: string[] = []
  const attention: string[] = []

  const also = (options.also ?? []).flatMap((value) => {
    const request = parseAlso(value)
    if (request) return [{ ...request, used: false }]
    blockers.push(`--also ${value}: write it as <project>:<path inside its repo>`)
    return []
  })

  for (const run of running) {
    const feature = featureRows.find((f) => f.id === run.feature_id)
    blockers.push(
      `a round of ${feature?.slug ?? run.feature_id} is marked running: let it finish or press Stop, and if the server is already stopped, start it once so it can clean up`,
    )
  }

  const placed = projectRows.map((row) => {
    const folder = sourceBasename(row.repo_path, env.platform)
    const skipped = options.noRepo.includes(row.name) || options.noRepo.includes(folder)
    const present = isRepo(row.repo_path)
    return { id: row.id, row, folder, skipped, present, repoMoves: present && !skipped }
  })
  const { targets, clashes } = assignTargetFolders(placed)
  for (const folder of clashes) {
    const names = placed.filter((p) => p.folder === folder && p.repoMoves).map((p) => p.row.repo_path)
    blockers.push(`two projects want the folder ${folder}: ${names.join(' and ')}. Leave one out with --no-repo`)
  }

  const projects: MoveProject[] = []
  const lines: ProjectLine[] = []
  let totalRepoBytes = 0

  for (const { row, folder, skipped, repoMoves } of placed) {
    const features = featureRows.filter((f) => f.project_id === row.id)
    const featureIds = new Set(features.map((f) => f.id))
    const chats = sessionRows.filter(
      (s) => s.project_id === row.id || (s.feature_id !== null && featureIds.has(s.feature_id)),
    )
    const targetFolder = targets.get(row.id) ?? folder

    const project: MoveProject = {
      id: row.id,
      name: row.name,
      repoPath: row.repo_path,
      targetFolder,
      repoMoves,
      refs: {},
      remotes: [],
      config: [],
      wip: [],
      carried: [],
    }
    let bytes = 0

    if (!repoMoves) {
      project.repoLeftReason = skipped ? '--no-repo' : 'its repo folder is gone'
      attention.push(
        `${row.name}: repo stays behind (${project.repoLeftReason}); put it in the repos folder as ${targetFolder} to use the project`,
      )
    } else {
      Object.assign(project, repoFacts(row.repo_path))
      const main = checkoutWip('main', row.repo_path)
      const talk = scanTalkWorktrees(env, row, featureRows)
      project.wip = [...(hasWork(main) ? [main] : []), ...talk.wips]
      blockers.push(...talk.stopped)

      const envFiles = options.withEnv ? [...new Set([...ignoredEnvFiles(row.repo_path), ...main.heldBack])] : []
      const requested = also.filter((request) => request.project === row.name || request.project === folder)
      const asked = requested.flatMap((request) => {
        request.used = true
        const path = join(row.repo_path, request.path)
        if (existsSync(path)) return statSync(path).isDirectory() ? walkFiles(path, request.path) : [request.path]
        blockers.push(`${row.name}: --also ${request.path} is not in the repo folder`)
        return []
      })
      project.carried = [...new Set([...envFiles, ...asked])]
      if (envFiles.length > 0) attention.push(`${row.name}: .env files travel: ${envFiles.join(', ')}`)
      if (requested.length > 0) {
        const paths = requested.map((request) => request.path).join(', ')
        attention.push(`${row.name}: travels at your request: ${paths}`)
      }

      const shownMain = options.withEnv ? { ...main, heldBack: [] } : main
      attention.push(...[shownMain, ...talk.wips].flatMap((wip) => wipAttention(row.name, wip)))
      const rules = excludeRules(row.repo_path)
      if (rules) project.excludeRules = rules
      if (git(row.repo_path, ['rev-parse', '--is-shallow-repository']).stdout.trim() === 'true') {
        blockers.push(`${row.name}: a shallow clone cannot be packed. Run git fetch --unshallow, or leave it out with --no-repo`)
      }
      if (project.remotes.some((remote) => /^https?:\/\/[^/@]+@/.test(remote.url))) {
        attention.push(`${row.name}: a remote URL holds a credential, and it travels with the repo`)
      }
      bytes = repoBytes(row.repo_path)

      const mid = midOperation(row.repo_path)
      if (mid) blockers.push(`${row.name}: the main checkout is in the middle of ${mid}. Finish or abort it`)

      const driving = features.find((f) => f.status === 'active' && f.branch === project.headBranch)
      if (driving) {
        blockers.push(
          `${row.name}: the main checkout is on ${driving.branch}, which a test drive leaves behind. Stop the drive or check out the base branch`,
        )
      }

      if (project.remotes.length === 0) {
        attention.push(`${row.name}: no remote, so the new machine and this one will be its only copies`)
      } else {
        const lonely = commitsOnNoRemote(row.repo_path)
        if (lonely > 0) attention.push(`${row.name}: ${count(lonely, 'commit')} on no remote; they travel in the pack, nothing is pushed`)
      }
      const carried = new Set(project.carried)
      const roots = requested.map((request) => request.path)
      const ignored = ignoredEntries(
        row.repo_path,
        (rel) => carried.has(rel) || roots.some((root) => rel === root || rel.startsWith(`${root}/`)),
      )
      if (ignored.length > 0) attention.push(`${row.name}: ignored files stay behind: ${ignored.join(', ')}`)
      const stashes = stashCount(row.repo_path)
      if (stashes > 1) attention.push(`${row.name}: ${stashes} stashes, only the newest travels`)
      if (Object.keys(project.refs).length > 0) {
        attention.push(...localHooks(row.name, row.repo_path))
      }
      const leftovers = leftoverWorktrees(row.repo_path, join(env.dataDir, 'worktrees'))
      if (leftovers.length > 0) attention.push(`${row.name}: uncommitted changes in other worktrees stay behind: ${leftovers.join(', ')}`)
      if (usesLfsOrSubmodules(row.repo_path)) {
        attention.push(`${row.name}: uses LFS or submodules, which the pack does not carry; fetch them on the new machine`)
      }
    }

    projects.push(project)
    totalRepoBytes += bytes
    lines.push({
      name: row.name,
      branches: Object.keys(project.refs).filter((ref) => ref.startsWith('refs/heads/')).length,
      uncommitted: project.wip.reduce((total, wip) => total + wip.tracked.length + wip.untracked.length, 0),
      features: features.length,
      chats: chats.length,
      repoBytes: bytes,
      repoMoves,
      repoPath: row.repo_path,
      targetFolder,
    })
  }

  for (const request of also.filter((item) => !item.used)) {
    blockers.push(`--also ${request.project}:${request.path}: no moving repo is called ${request.project}`)
  }

  const openChats = sessionRows.filter((s) => s.status === 'live' || s.status === 'launching').length
  if (openChats > 0) attention.push(`${count(openChats, 'open chat')} will end at the new machine's first boot, and can be resumed`)

  const claude = findClaudeFolders(env, projectRows.map((p) => p.repo_path), sessionRows)
  if (claude.missing > 0) {
    attention.push(
      `${count(claude.missing, 'chat')} already gone from this machine: Claude Code removes transcripts after cleanupPeriodDays, 30 by default`,
    )
  }

  const links = dataSymlinks(env, claude.folders)
  if (links.length > 0) attention.push(`symlinks in runcastle's folders stay behind: ${links.join(', ')}`)

  let claudeSetup: ClaudeSetup | undefined
  let setupBytes = 0
  if (options.withClaudeSetup) {
    const found = findClaudeSetup(env)
    claudeSetup = found.setup
    setupBytes = found.setup.files.reduce((total, rel) => total + pathBytes(join(env.claudeDir, rel)), 0)
    attention.push(
      `Claude setup travels: ${count(found.setup.files.length, 'file')}, ${count(found.setup.plugins.length, 'plugin')} to install again, ${count(Object.keys(found.setup.mcpServers).length, 'MCP server')}. What the new machine has is set aside, and its login stays`,
    )
    if (found.broken.length > 0) attention.push(`Claude setup links that lead nowhere stay behind: ${found.broken.join(', ')}`)
  } else if (readJsonObject(join(env.claudeDir, 'settings.json')).cleanupPeriodDays === undefined) {
    attention.push(
      'Claude Code on the new machine deletes moved chats older than 30 days unless cleanupPeriodDays is raised; --with-claude-setup does that',
    )
  }

  const report: MoveReport = {
    blockers,
    projects: lines,
    attention,
    staysBehind: staysBehind(options),
    dataBytes: dataBytes(env, claude.folders) + wipBytes(projects) + setupBytes,
    repoBytes: totalRepoBytes,
    openChats,
  }
  return {
    report,
    projects,
    claudeFolders: claude.folders,
    conversations: claude.conversations,
    envCarried: options.withEnv === true,
    ...(claudeSetup ? { claudeSetup } : {}),
  }
}

/**
 * The stored settings no path rewrite can fix, for the report, so the human can
 * change them before the old machine goes. The targets are stand-ins: all this
 * asks is whether a Windows path would be left over.
 */
export function windowsCommandLines(sql: MoveSql, projects: MoveProject[], env: MoveEnv): string[] {
  const rules = [
    ...projects.map((project) => ({ from: project.repoPath, to: `/repos/${project.targetFolder}` })),
    { from: env.dataDir, to: '/data' },
    { from: env.home, to: '/home' },
  ]
  return sql.all<ProjectRow>('SELECT * FROM projects').flatMap((row) =>
    HOST_COMMANDS.flatMap(({ column, label }) => {
      const value = row[column]
      if (!value || !looksWindowsOnly(rewritePathsInText(value, rules, env.platform))) return []
      return [`${row.name}, ${label}: only works on Windows; change it before the move or it will fail on the new machine`]
    }),
  )
}
