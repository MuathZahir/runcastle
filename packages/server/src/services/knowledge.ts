import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { join, relative, resolve, sep } from 'node:path'
import type { Feature, Project } from '@runcastle/core'
import type { AppCtx } from '../db/types'
import { InvalidInputError, NotFoundError } from '../errors'
import { emit } from './events'
import { featureDocsDir, featureDocPath } from './feature-docs'
import { projectForFeature } from './repo'

/**
 * Feature knowledge lives in the target repo at `docs/features/<slug>/`
 * (CONTEXT.md decision #5) — versioned and agent-readable. Written into the
 * talk worktree when one exists, else the main checkout (see `feature-docs`).
 */

export interface DocSummary {
  relPath: string
  title: string
  /**
   * When the file was last written, as the filesystem has it. The read-only
   * banner dates a doc with it (decision 10: `Spec · written 2d ago`) when the
   * event feed never saw the file change — a feed that has been trimmed, or a
   * feature whose docs were written before the watcher ran, still knows how old
   * its spec is. Omitted when the file cannot be stat'd, which is the honest
   * answer: no date rather than a wrong one.
   */
  updatedAt?: number
}

/** Overrides for the docs a fresh feature is seeded with. */
export interface ScaffoldOptions {
  /**
   * Body written into `brief.md` verbatim, instead of the generated
   * title + oneLiner + created-date stub. Used by every creation path that
   * already HAS the brief — the quick-change door (the human's own prose) and
   * the project session's `create_feature` (the reasoning from the intake
   * conversation, which would otherwise evaporate). Blank/whitespace-only falls
   * back to the stub.
   */
  brief?: string
}

/**
 * Create the docs dir and seed `brief.md` (title + oneLiner + created date, or
 * `opts.brief` verbatim). Never overwrites an existing brief.
 */
export function scaffoldDocs(ctx: AppCtx, feature: Feature, opts: ScaffoldOptions = {}): void {
  const project = projectForFeature(ctx, feature)
  const dir = featureDocsDir(project, feature)
  mkdirSync(dir, { recursive: true })

  const briefPath = featureDocPath(project, feature, 'brief.md')
  if (!existsSync(briefPath)) {
    const override = opts.brief?.trim()
    const created = new Date().toISOString()
    const brief = override
      ? `${override}\n`
      : [
          `# ${feature.title}`,
          '',
          feature.oneLiner,
          '',
          `- Slug: ${feature.slug}`,
          `- Created: ${created}`,
          '',
        ].join('\n')
    writeFileSync(briefPath, brief, 'utf8')
  }

  // Mapped features (ADR-0001 / SPEC §13.4) get a `map.md` from t=0: the prose
  // sections sessions and humans edit while the waypoint machinery lives in the
  // db. Same four headings `escalate_to_map` seeds mid-grill, so a feature that
  // starts mapped and one that escalates share one map format.
  if (feature.mapped) {
    scaffoldMapDoc(project, feature)
  }

  emit(ctx, feature.id, {
    type: 'docs.scaffolded',
    message: feature.mapped
      ? `scaffolded docs/features/${feature.slug}/{brief,map}.md`
      : `scaffolded docs/features/${feature.slug}/brief.md`,
  })
}

/** The four `map.md` sections (ADR-0001 decision 2 / SPEC §13.4), in order. */
export const MAP_SECTIONS = [
  'Destination',
  'Notes',
  'Not yet specified',
  'Out of scope',
] as const

/** Prose to seed into `map.md` when escalating mid-grill (§13.3). */
export interface MapSeed {
  destination?: string
  notes?: string
}

/**
 * Seed `map.md` with the four prose sections (idempotent — never overwrites an
 * existing map). Destination/Notes are filled from `seed` when escalating
 * (`escalate_to_map`); Not-yet-specified and Out-of-scope always start empty.
 * A feature that starts mapped scaffolds with no seed (all four empty).
 */
export function scaffoldMapDoc(project: Project, feature: Feature, seed?: MapSeed): void {
  mkdirSync(featureDocsDir(project, feature), { recursive: true })
  const mapPath = featureDocPath(project, feature, 'map.md')
  if (existsSync(mapPath)) return
  writeFileSync(mapPath, mapDocBody(feature, seed), 'utf8')
}

function mapDocBody(feature: Feature, seed?: MapSeed): string {
  const seeded: Partial<Record<(typeof MAP_SECTIONS)[number], string>> = {
    Destination: seed?.destination?.trim(),
    Notes: seed?.notes?.trim(),
  }
  const lines = [`# ${feature.title} — map`, '']
  for (const section of MAP_SECTIONS) {
    lines.push(`## ${section}`, '')
    const body = seeded[section]
    if (body) lines.push(body, '')
  }
  return lines.join('\n')
}

// --- project-scope knowledge (charter + ADRs) -------------------------------

/** The charter's path within a repo — the project's rewritten-in-place tier. */
export const CHARTER_FILE = 'CONTEXT.md'

/** Where project-scope decisions live — append-only, one file per decision. */
export const ADR_DIR_REL = 'docs/adr'

/**
 * A shipped ADR that a later decision overturned carries this status line. It is
 * the ONLY permitted edit to a shipped ADR: it changes a pointer, not a claim.
 */
export const SUPERSEDED_RE = /superseded by ADR-\d+/i

/**
 * The charter (`CONTEXT.md`) read out of one checkout, in full.
 *
 * Absent is a normal answer, not an error: the charter is born lazily, the first
 * time the project session has something to write (decision 28). A scaffolded
 * stub would be a file that reads authoritative while saying nothing, so
 * "no file, nothing injected" is the designed degradation.
 */
export function readCharter(repoRoot: string): string | undefined {
  const path = join(repoRoot, CHARTER_FILE)
  if (!existsSync(path)) return undefined
  try {
    return readFileSync(path, 'utf8')
  } catch {
    return undefined
  }
}

export interface AdrDoc {
  /** Repo-relative path — the provenance address a reader can open. */
  relPath: string
  content: string
}

/**
 * Every LIVE ADR under `docs/adr/`, in full and in filename order.
 *
 * A superseded ADR is omitted: it stays on disk, marked, reachable by an
 * ordinary `Read` — but it leaves the always-read set, so a project that
 * reversed course three times on one question costs one ADR of context, not
 * four (decision 13). Full text, no truncation, no size ceiling (decision 16).
 */
export function listLiveAdrs(repoRoot: string): AdrDoc[] {
  const dir = join(repoRoot, ADR_DIR_REL)
  if (!existsSync(dir)) return []

  const docs: AdrDoc[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith('.md')) continue
    let content: string
    try {
      content = readFileSync(join(dir, entry.name), 'utf8')
    } catch {
      continue
    }
    if (SUPERSEDED_RE.test(content)) continue
    docs.push({ relPath: `${ADR_DIR_REL}/${entry.name}`, content })
  }
  return docs.sort((a, b) => a.relPath.localeCompare(b.relPath))
}

/** List `.md` docs for a feature (relPath within the docs dir + a title). */
export function listDocs(ctx: AppCtx, feature: Feature): DocSummary[] {
  const project = projectForFeature(ctx, feature)
  const dir = featureDocsDir(project, feature)
  if (!existsSync(dir)) return []

  return readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isFile() && e.name.endsWith('.md'))
    .map((e) => ({
      relPath: e.name,
      title: readTitle(join(dir, e.name), e.name),
      ...writtenAt(join(dir, e.name)),
    }))
    .sort((a, b) => a.relPath.localeCompare(b.relPath))
}

/** Read a doc by path relative to the feature's docs dir (traversal-guarded). */
export function readDoc(ctx: AppCtx, feature: Feature, relPath: string): { content: string } {
  const project = projectForFeature(ctx, feature)
  const dir = featureDocsDir(project, feature)
  const root = resolve(dir)
  const target = resolve(dir, relPath)

  // Path-traversal guard: the resolved target must stay within the docs dir.
  const rel = relative(root, target)
  if (rel === '' || rel.startsWith('..') || rel.split(sep).includes('..')) {
    throw new InvalidInputError(`doc path escapes the feature docs dir: ${relPath}`)
  }

  if (!existsSync(target)) throw new NotFoundError(`doc not found: ${relPath}`)
  return { content: readFileSync(target, 'utf8') }
}

function writtenAt(path: string): { updatedAt?: number } {
  try {
    return { updatedAt: Math.floor(statSync(path).mtimeMs) }
  } catch {
    return {}
  }
}

function readTitle(path: string, fallback: string): string {
  try {
    const firstLine = readFileSync(path, 'utf8').split('\n', 1)[0] ?? ''
    const heading = firstLine.match(/^#\s+(.+)$/)
    return heading ? heading[1].trim() : fallback
  } catch {
    return fallback
  }
}
