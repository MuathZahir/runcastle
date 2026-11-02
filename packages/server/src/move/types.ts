/**
 * The contracts of `runcastle move` and `runcastle move-in`. Nothing here does
 * IO. A {@link MoveEnv} is passed in rather than read from `process`, so a test
 * can run a whole move between two scratch homes.
 */

/** The machine one side of a move runs on, and where runcastle's files live there. */
export interface MoveEnv {
  /** `process.platform` of this side. */
  platform: string
  home: string
  dataDir: string
  /** Claude Code's config dir (`CLAUDE_CONFIG_DIR`, else `~/.claude`). */
  claudeDir: string
}

/**
 * The little of a sqlite driver a move needs. `bun:sqlite` may only be imported
 * by `db/client.ts`, so the CLI hands this in.
 */
export interface MoveSql {
  all<T>(sql: string, ...params: Array<string | number | null>): T[]
  run(sql: string, ...params: Array<string | number | null>): void
  close(): void
}

export type OpenSql = (path: string, opts: { readonly: boolean }) => MoveSql

/** One checkout's uncommitted work: a main checkout (`key = 'main'`) or a talk worktree (`key` is its folder name). */
export interface CheckoutWip {
  key: string
  /** Where the checkout sat on the old machine. */
  path: string
  /** The branch it is on; absent when detached. */
  branch?: string
  /** The commit it is on; absent on a repo with no commits. */
  sha?: string
  /** Changed tracked paths, repo-relative with forward slashes. Deleted ones appear in the patch only. */
  tracked: string[]
  /** Untracked paths git does not ignore, repo-relative with forward slashes. */
  untracked: string[]
  /** Untracked folders that are git repos themselves: their files travel, their history does not. */
  nested: string[]
  /** `.env`-style files git does not ignore. They travel only when the human asks with `--with-env`. */
  heldBack: string[]
  /** Untracked symlinks. The pack holds regular files only, so these stay behind and the report names them. */
  symlinks: string[]
}

export interface MoveProject {
  id: string
  name: string
  repoPath: string
  /** Folder name the repo lands in, under the destination's repos dir. */
  targetFolder: string
  /** Whether the repo itself travels. */
  repoMoves: boolean
  /** Why it does not, for the report. */
  repoLeftReason?: string
  /** Every ref and the commit it points at. */
  refs: Record<string, string>
  remotes: { name: string; url: string }[]
  /** Repo-level settings worth keeping: upstream tracking, identity, the hooks path. */
  config: { key: string; value: string }[]
  /** Checked-out branch of the main checkout; absent when detached. */
  headBranch?: string
  headSha?: string
  wip: CheckoutWip[]
  /** Local ignore rules from `.git/info/exclude`, which a bundle does not carry. */
  excludeRules?: string
  /** Repo-relative files the human asked to carry that git does not: `.env` files and `--also` paths. */
  carried: string[]
}

/** The human's Claude Code setup, carried with `--with-claude-setup`. Logins are never part of it. */
export interface ClaudeSetup {
  /** Files under the Claude dir, by forward-slashed path, with links already followed. */
  files: string[]
  /** Marketplaces to add again, as Claude's own `plugin marketplace add` takes them. */
  marketplaces: string[]
  /** Enabled plugins to install again, built for the new system. */
  plugins: string[]
  /** User-level MCP servers from `.claude.json`, by name. */
  mcpServers: Record<string, unknown>
}

/** A Claude Code project folder that travels, and the directory it belongs to. */
export interface ClaudeFolder {
  /** Its folder name on the old machine. */
  name: string
  /** The old path the chats in it ran in. */
  cwd: string
}

export interface PackedFile {
  path: string
  size: number
  sha256: string
}

export interface MoveManifest {
  formatVersion: 1
  runcastleVersion: string
  createdAt: number
  source: MoveEnv
  /** Applied migration names: a destination that lacks one is an older runcastle. */
  migrations: string[]
  projects: MoveProject[]
  claudeFolders: ClaudeFolder[]
  /** Every Claude conversation of a session, and the folder holding its transcript. */
  conversations: { id: string; folder: string }[]
  /** Whether `.env` files were carried, so the closing message can stop asking for them. */
  envCarried: boolean
  claudeSetup?: ClaudeSetup
  /** The report the human saw before packing, kept in `move-report.md`. */
  reportText: string
  /** Row count of every table in the packed database. */
  rowCounts: Record<string, number>
  files: PackedFile[]
}

/** What `move` tells the destination so it can answer before anything is packed. */
export interface DestinationQuestion {
  runcastleVersion: string
  sourcePlatform: string
  migrations: string[]
  targetFolders: string[]
  dataBytes: number
  repoBytes: number
}

export interface DestinationAnswer {
  platform: string
  blockers: string[]
  notes: string[]
  freeBytes: number | null
  reposDir: string
}

export interface ProjectLine {
  name: string
  branches: number
  uncommitted: number
  features: number
  chats: number
  repoBytes: number
  repoMoves: boolean
  repoPath: string
  targetFolder: string
}

export interface MoveReport {
  blockers: string[]
  projects: ProjectLine[]
  /** Things the human has to deal with afterwards, or should know are not carried. */
  attention: string[]
  staysBehind: string[]
  /** Everything but the repos, in bytes, before compression. */
  dataBytes: number
  repoBytes: number
  /** Open chats the destination's first boot will end. */
  openChats: number
}

/** A scan's result: what the human reads, and what `packMove` works from. */
export interface MoveScan {
  report: MoveReport
  projects: MoveProject[]
  claudeFolders: ClaudeFolder[]
  conversations: { id: string; folder: string }[]
  envCarried: boolean
  claudeSetup?: ClaudeSetup
}

export interface MoveOptions {
  /** Project names (or folder names) whose repo stays behind. */
  noRepo: string[]
  /** Carry each project's `.env` files. */
  withEnv?: boolean
  /** Carry global Claude rules, skills, agents, settings, plugins and MCP servers. */
  withClaudeSetup?: boolean
  /** Paths git does not carry, each `<project>:<path inside the repo>`. */
  also?: string[]
}

/** A stored command whose paths a move rewrote. */
export interface ChangedCommand {
  project: string
  field: string
  from: string
  to: string
}

/** A stored command that still looks Windows-only after the move. */
export interface WindowsCommand {
  project: string
  field: string
  value: string
}

/** What became of a carried Claude setup. */
export interface ClaudeSetupResult {
  /** Plugins and marketplaces Claude would not install, with the MCP servers if they could not be written. */
  failed: string[]
  /** Set when the move raised `cleanupPeriodDays` so Claude keeps the moved chats. */
  chatsKept: boolean
}

export interface MoveInResult {
  /** Repos rebuilt, by project name. */
  repos: { name: string; path: string }[]
  commandsChanged: ChangedCommand[]
  commandsWindows: WindowsCommand[]
  envCarried: boolean
  claudeSetup?: ClaudeSetupResult
  /** Uncommitted work put back in place, and work kept beside the repo instead. */
  wipApplied: string[]
  wipKept: { project: string; key: string; folder: string }[]
  /** Work that could not even be copied beside the repo: it stays in {@link stagingKept}. */
  wipStuck: string[]
  stagingKept?: string
  /** Paths matching no known prefix, left as they were. */
  unmappedPaths: number
  /** What was set aside, old path to new. */
  setAside: { from: string; to: string }[]
  reportPath: string
}
