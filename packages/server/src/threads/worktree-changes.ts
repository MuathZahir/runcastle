import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { isAbsolute, join, relative } from 'node:path'
import { diffLines, type ToolDiff } from './acp-map'

/**
 * What a turn changed in its worktree, whoever changed it (chat-as-web-components
 * ticket 16): the agent's edit tools report their diffs, but a file written by
 * a shell command (`echo > notes.txt`, a codegen, a `git mv`) reaches the
 * changes card only through git. A turn snapshots the worktree's dirty files as
 * it starts; as it ends, every file whose content moved since is the turn's,
 * untracked ones included, with paths relative to the worktree.
 *
 * Kept cheap: one `git status` at each end, a read of each dirty file, and a
 * `git show` per file only when it was clean at the start.
 */

/** A file as a turn compares it: its text, absent (`null`), or too big or binary to diff (a fingerprint). */
type Content = { text: string } | { opaque: string } | null

export interface WorktreeSnapshot {
  /** The worktree's top, as git names it. */
  root: string
  /** The commit checked out at the start; null in a repository with none. */
  head: string | null
  /** The files dirty at the start, with what they held then. */
  dirty: Map<string, Content>
}

/** Past this a file's lines are not diffed: the card names it without them. */
const MAX_DIFF_BYTES = 512 * 1024
const GIT_MAX_BUFFER = 64 * 1024 * 1024

function git(cwd: string, args: string[]): Promise<Buffer | null> {
  return new Promise((resolve) => {
    execFile('git', args, { cwd, encoding: 'buffer', maxBuffer: GIT_MAX_BUFFER, windowsHide: true }, (err, stdout) => resolve(err ? null : stdout))
  })
}

function contentOf(bytes: Buffer): Content {
  if (bytes.length > MAX_DIFF_BYTES || bytes.includes(0)) return { opaque: createHash('sha1').update(bytes).digest('hex') }
  return { text: bytes.toString('utf8') }
}

function readContent(root: string, path: string): Content {
  try {
    return contentOf(readFileSync(join(root, path)))
  } catch {
    return null
  }
}

function sameContent(a: Content, b: Content): boolean {
  if (a === null || b === null) return a === b
  return 'text' in a ? 'text' in b && a.text === b.text : 'opaque' in b && a.opaque === b.opaque
}

/** The paths `git status --porcelain -z` names: both sides of a rename or copy. */
function statusPaths(out: Buffer): string[] {
  const parts = out.toString('utf8').split('\0')
  const paths: string[] = []
  for (let k = 0; k < parts.length; k++) {
    const entry = parts[k]
    if (entry.length < 4) continue
    paths.push(entry.slice(3))
    if (entry[0] === 'R' || entry[0] === 'C') paths.push(parts[++k])
  }
  return paths
}

const STATUS = ['status', '--porcelain=v1', '-z', '--untracked-files=all']

async function headOf(root: string): Promise<string | null> {
  return (await git(root, ['rev-parse', '--verify', '-q', 'HEAD']))?.toString('utf8').trim() || null
}

/** The worktree's state as a turn starts; null where `cwd` is no git worktree. */
export async function snapshotWorktree(cwd: string): Promise<WorktreeSnapshot | null> {
  if (!cwd || !existsSync(cwd)) return null
  const top = await git(cwd, ['rev-parse', '--show-toplevel'])
  if (!top) return null
  const root = top.toString('utf8').trim()
  const status = await git(root, STATUS)
  if (!status) return null
  const dirty = new Map<string, Content>()
  for (const path of statusPaths(status)) dirty.set(path, readContent(root, path))
  return { root, head: await headOf(root), dirty }
}

/** Every file whose content moved since `snap`, as a diff from then to now. */
export async function worktreeChanges(snap: WorktreeSnapshot): Promise<ToolDiff[]> {
  const status = await git(snap.root, STATUS)
  if (!status) return []
  const paths = new Set([...snap.dirty.keys(), ...statusPaths(status)])
  // A commit made during the turn leaves its files clean: they are still the turn's.
  const head = await headOf(snap.root)
  if (snap.head && head && head !== snap.head) {
    const committed = await git(snap.root, ['diff', '--name-only', '-z', snap.head, head])
    for (const path of committed?.toString('utf8').split('\0') ?? []) if (path) paths.add(path)
  }
  const diffs: ToolDiff[] = []
  for (const path of [...paths].sort()) {
    const before = snap.dirty.has(path) ? (snap.dirty.get(path) ?? null) : await committedContent(snap, path)
    const after = readContent(snap.root, path)
    if (sameContent(before, after)) continue
    const textual = (before === null || 'text' in before) && (after === null || 'text' in after)
    diffs.push({ path, lines: textual ? diffLines(before?.text ?? null, after?.text ?? '') : [] })
  }
  return diffs
}

/** A file as the turn's starting commit holds it; null when it holds none. */
async function committedContent(snap: WorktreeSnapshot, path: string): Promise<Content> {
  if (!snap.head) return null
  const bytes = await git(snap.root, ['show', `${snap.head}:${path}`])
  return bytes ? contentOf(bytes) : null
}

/** `path` relative to the worktree `root`, with `/` separators; a path outside it stays as it is. */
export function worktreeRelative(root: string, path: string): string {
  if (!root || !isAbsolute(path)) return path
  const rel = relative(root, path)
  if (!rel || rel.startsWith('..') || isAbsolute(rel)) return path
  return rel.split('\\').join('/')
}
