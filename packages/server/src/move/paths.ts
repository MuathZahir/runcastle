/**
 * The pure core of a move: what a path from the old machine becomes on the new
 * one. It takes the source platform as a value and never uses the host's
 * `node:path` on a source path, because a Windows path means nothing to Linux's
 * `join`, and these functions have to behave the same on either host.
 */

/** One known place on the old machine and where it is on the new one. */
export interface PathRule {
  from: string
  to: string
}

/** A source path in one spelling: forward slashes, no trailing slash. */
function canonicalSlashes(path: string, sourcePlatform: string): string {
  const slashed = sourcePlatform === 'win32' ? path.replace(/\\/g, '/') : path
  return slashed.length > 1 ? slashed.replace(/\/+$/, '') : slashed
}

/** A source path for comparing: Windows paths ignore case. */
function foldForCompare(path: string, sourcePlatform: string): string {
  const canonical = canonicalSlashes(path, sourcePlatform)
  return sourcePlatform === 'win32' ? canonical.toLowerCase() : canonical
}

/** Whether two paths from the source machine name the same place. */
export function samePath(a: string, b: string, sourcePlatform: string): boolean {
  return foldForCompare(a, sourcePlatform) === foldForCompare(b, sourcePlatform)
}

/**
 * Rewrite `path` by the longest rule whose `from` contains it, or `null` when
 * none does. A rule matches whole path segments only: `C:\work\app` must not
 * match `C:\work\app-old`.
 */
export function mapSourcePath(
  path: string,
  rules: PathRule[],
  sourcePlatform: string,
): string | null {
  const folded = foldForCompare(path, sourcePlatform)
  const canonical = canonicalSlashes(path, sourcePlatform)
  const ordered = [...rules].sort((a, b) => b.from.length - a.from.length)
  for (const rule of ordered) {
    const from = foldForCompare(rule.from, sourcePlatform)
    if (folded !== from && !folded.startsWith(`${from}/`)) continue
    const sep = rule.to.includes('\\') ? '\\' : '/'
    const rest = canonical.slice(from.length).split('/').join(sep)
    return rule.to + rest
  }
  return null
}

/** The last segment of a source path: the repo's folder name. */
export function sourceBasename(path: string, sourcePlatform: string): string {
  const canonical = canonicalSlashes(path, sourcePlatform)
  return canonical.slice(canonical.lastIndexOf('/') + 1)
}

/** Claude Code's limit on an encoded folder name, past which it appends a hash. */
const CLAUDE_FOLDER_MAX = 200

/** Claude Code's string hash, for the suffix of a shortened folder name. */
function claudeHash(text: string): string {
  let hash = 0
  for (let i = 0; i < text.length; i++) hash = ((hash << 5) - hash + text.charCodeAt(i)) | 0
  return Math.abs(hash).toString(36)
}

/**
 * The folder under `~/.claude/projects` that Claude Code keeps a directory's
 * chats in. It is Claude Code's own rule, read from its SDK: every character
 * outside `a-zA-Z0-9` becomes `-`, and a name past 200 characters is cut and
 * given a hash. Resume looks a chat up by this name, so it has to match exactly.
 */
export function encodeClaudeFolder(path: string): string {
  const encoded = path.replace(/[^a-zA-Z0-9]/g, '-')
  if (encoded.length <= CLAUDE_FOLDER_MAX) return encoded
  return `${encoded.slice(0, CLAUDE_FOLDER_MAX)}-${claudeHash(path)}`
}

/**
 * The folder each project's repo lands in. Two projects that want one folder
 * clash, and that blocks the move, unless one of them leaves its repo behind:
 * that one has nothing to put there, so it steps aside under its project id.
 */
export function assignTargetFolders<T extends { id: string; folder: string; repoMoves: boolean }>(
  projects: T[],
): { targets: Map<string, string>; clashes: string[] } {
  const movers = new Map<string, string[]>()
  for (const project of projects) {
    if (project.repoMoves) movers.set(project.folder, [...(movers.get(project.folder) ?? []), project.id])
  }
  const targets = new Map<string, string>()
  for (const project of projects) {
    const taken = movers.has(project.folder) && !project.repoMoves
    targets.set(project.id, taken ? `${project.folder}-${project.id}` : project.folder)
  }
  const clashes = [...movers].filter(([, ids]) => ids.length > 1).map(([folder]) => folder)
  return { targets, clashes }
}
