import { createHash } from 'node:crypto'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { basename, dirname, isAbsolute, join, relative } from 'node:path'
import { IN } from './sandbox'

/**
 * The human's Claude Code setup, as a worker's sandbox gets it at its start and
 * at a wake after it changed (interactive-workers decision 8): global CLAUDE.md, rules, skills,
 * agents and commands, the enabled plugins, the model and effort settings, the
 * permission rules, and the MCP servers with their logins. Never hooks (they
 * run host-path scripts), the status line, `env`, history, sessions or project
 * transcripts.
 *
 * Built here as a plain list of what to write where, so a test reads exactly
 * what the engine is asked to write; the engine copies it in
 * (`copyClaudeSetup`), never bind-mounting the human's own files.
 */

/** One thing to put in the sandbox's home: a host file or folder (`from`), or `content` runcastle wrote. */
export interface SetupFile {
  /** Where it goes, relative to the sandbox's home, `/`-separated. */
  to: string
  from?: string
  content?: string
}

export interface ClaudeSetup {
  files: SetupFile[]
  /** The user-level MCP servers, merged into the sandbox's own `~/.claude.json` (which holds its conversations' state). */
  mcpServers: Record<string, unknown>
}

/** A Codex worker's setup (`codexSetup`): its MCP servers ride its `config.toml`, one of the files. */
export interface CodexSetup {
  files: SetupFile[]
}

/** What of the human's setup a worker gets, for the runtime it runs on. */
export type WorkerSetup = ClaudeSetup | CodexSetup

/**
 * What of the human's copy goes in a new copy's place: cleared before each copy, so a removed skill does not linger.
 * The plugins' marketplaces are not: Claude Code clones each one inside the sandbox the first time, and the clone
 * stays across wakes and later copies rather than being fetched from GitHub again at every start.
 */
export const SETUP_MANAGED = [
  '.claude/CLAUDE.md',
  '.claude/rules',
  '.claude/skills',
  '.claude/agents',
  '.claude/commands',
  '.claude/plugins/cache',
  '.claude/plugins/installed_plugins.json',
  '.claude/plugins/known_marketplaces.json',
  '.claude/settings.json',
  '.claude/.credentials.json',
] as const

/** The folders copied whole when the human has them. */
const SETUP_DIRS = ['rules', 'skills', 'agents', 'commands'] as const

/**
 * The keys of `~/.claude/settings.json` a worker gets: its model, effort,
 * thinking, plugins, the permission rules and the repo's own MCP approvals.
 * Everything else (hooks, statusLine, env, apiKeyHelper…) stays on the host.
 */
const SETTINGS_KEPT = [
  'model',
  'effortLevel',
  'alwaysThinkingEnabled',
  'enabledPlugins',
  'permissions',
  'enableAllProjectMcpServers',
  'enabledMcpjsonServers',
  'disabledMcpjsonServers',
] as const

/** The permission mode a worker starts in (decision 11), over whatever the human's own default is. */
export const WORKER_DEFAULT_MODE = 'auto'

function readJson(file: string): Record<string, unknown> | undefined {
  try {
    const parsed: unknown = JSON.parse(readFileSync(file, 'utf8'))
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : undefined
  } catch {
    return undefined
  }
}

const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)

/** The human's setup under `home` (their `~`), as the sandbox gets it. */
export function claudeSetup(home: string): ClaudeSetup {
  const claude = join(home, '.claude')
  const files: SetupFile[] = []
  const hostFile = (name: string): void => {
    const from = join(claude, name)
    if (existsSync(from)) files.push({ to: `.claude/${name}`, from })
  }
  hostFile('CLAUDE.md')
  for (const dir of SETUP_DIRS) {
    const from = join(claude, dir)
    if (existsSync(from) && statSync(from).isDirectory()) files.push({ to: `.claude/${dir}`, from })
  }

  const settings = readJson(join(claude, 'settings.json')) ?? {}
  const kept: Record<string, unknown> = {}
  for (const key of SETTINGS_KEPT) if (settings[key] !== undefined) kept[key] = settings[key]
  kept.permissions = { ...(isObject(kept.permissions) ? kept.permissions : {}), defaultMode: WORKER_DEFAULT_MODE }
  files.push({ to: '.claude/settings.json', content: `${JSON.stringify(kept, null, 2)}\n` })

  files.push(...enabledPlugins(home, isObject(settings.enabledPlugins) ? settings.enabledPlugins : {}))

  // MCP logins only: the worker signs in to Claude with the token burns use.
  const credentials = readJson(join(claude, '.credentials.json'))
  if (isObject(credentials?.mcpOAuth)) {
    files.push({ to: '.claude/.credentials.json', content: `${JSON.stringify({ mcpOAuth: credentials.mcpOAuth })}\n` })
  }

  const userConfig = readJson(join(home, '.claude.json'))
  const mcpServers = isObject(userConfig?.mcpServers) ? userConfig.mcpServers : {}
  return { files, mcpServers }
}

/** A host path under `~/.claude`, as the same path in the sandbox's home; undefined for one outside it. */
function inSandboxHome(home: string, hostPath: string): string | undefined {
  const rel = relative(home, hostPath)
  if (!rel || rel.startsWith('..') || isAbsolute(rel)) return undefined
  const to = rel.split(/[\\/]/).join('/')
  return to.startsWith('.claude/') ? to : undefined
}

/**
 * The enabled plugins: each one's installed folder, plus the plugin registry
 * and the marketplaces they came from, cut down to those plugins and with the
 * host's home rewritten to the sandbox's, so Claude Code loads them there.
 * A plugin installed outside `~/.claude` (a local folder marketplace) is left out.
 */
function enabledPlugins(home: string, enabled: Record<string, unknown>): SetupFile[] {
  const plugins = join(home, '.claude', 'plugins')
  const registry = readJson(join(plugins, 'installed_plugins.json'))
  if (!registry || !isObject(registry.plugins)) return []
  const on = Object.keys(enabled).filter((id) => enabled[id] === true)
  const files: SetupFile[] = []
  const kept: Record<string, unknown> = {}
  for (const id of on) {
    const entry = registry.plugins[id]
    const installs = (Array.isArray(entry) ? entry : [entry]).filter(isObject)
    const copied = installs.filter((install) => {
      const path = install.installPath
      if (typeof path !== 'string' || !existsSync(path)) return false
      const to = inSandboxHome(home, path)
      if (!to) return false
      files.push({ to, from: path })
      return true
    })
    if (copied.length) kept[id] = Array.isArray(entry) ? copied : copied[0]
  }
  if (!Object.keys(kept).length) return []
  const rehome = (json: unknown): string => `${JSON.stringify(json, null, 2).split(join(home, '.claude')).join(`${IN.home}/.claude`)}\n`
  files.push({ to: '.claude/plugins/installed_plugins.json', content: rehome({ ...registry, plugins: kept }) })
  const marketplaces = readJson(join(plugins, 'known_marketplaces.json'))
  if (marketplaces) {
    const used = new Set(Object.keys(kept).map((id) => id.slice(id.lastIndexOf('@') + 1)))
    const usedOnly = Object.fromEntries(Object.entries(marketplaces).filter(([name]) => used.has(name)))
    files.push({ to: '.claude/plugins/known_marketplaces.json', content: rehome(usedOnly) })
  }
  return files
}

/**
 * A cheap fingerprint of a setup: what runcastle writes, and the path, size and
 * modified time of every host file it copies (never their contents, which run
 * to hundreds of MB). A wake whose fingerprint matches the sandbox's last copy
 * skips the copy; a change to any of it copies again (decision 8). Folders
 * count by the names in them, not their times, and Claude Code's own
 * bookkeeping ({@link isHostBookkeeping}) not at all: both change all day
 * on a machine where Claude Code runs, while the setup stays as it was.
 */
export function setupFingerprint(setup: WorkerSetup): string {
  const hash = createHash('sha256')
  for (const f of setup.files) {
    hash.update(`${f.to}\0`)
    if (f.content !== undefined) hash.update(`=${f.content}\0`)
    else if (f.from) statTree(f.from, hash)
  }
  if ('mcpServers' in setup) hash.update(`mcp=${JSON.stringify(setup.mcpServers)}`)
  return hash.digest('hex')
}

/**
 * What Claude Code writes into the setup's folders as it runs, not part of the
 * setup: a plugin's `.in_use` markers (one per running process, never copied
 * either), and the round marker and manifest of the skills it syncs, rewritten
 * at every sync round.
 */
function isHostBookkeeping(path: string): boolean {
  const name = basename(path)
  if (name === '.in_use') return true
  // Synced skills sit in `skills/synced/<account>/`, the round marker and manifest beside them.
  return basename(dirname(dirname(path))) === 'synced' && (name === '.last-complete-round' || name === 'manifest.json')
}

/** Each file under `path` with its size and modified time, links followed as the copy follows them. */
function statTree(path: string, hash: ReturnType<typeof createHash>, depth = 0): void {
  let st: ReturnType<typeof statSync>
  try {
    st = statSync(path)
  } catch {
    hash.update(`${path}:missing\0`)
    return
  }
  if (!st.isDirectory()) {
    hash.update(`${path}:${st.size}:${st.mtimeMs}\0`)
    return
  }
  hash.update(`${path}/\0`)
  if (depth > 32) return
  let names: string[]
  try {
    names = readdirSync(path).sort()
  } catch {
    return
  }
  for (const name of names) {
    const child = join(path, name)
    if (!isHostBookkeeping(child)) statTree(child, hash, depth + 1)
  }
}
