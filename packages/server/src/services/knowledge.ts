import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join, relative, resolve, sep } from 'node:path'
import type { Feature, Project } from '@runcastle/core'
import type { AppCtx } from '../db/types'
import { InvalidInputError, NotFoundError } from '../errors'
import { emit } from './events'
import { featureDocsDir, featureDocPath } from './feature-docs'
import { requireProject } from './repo'

/**
 * Feature knowledge lives in the target repo at `docs/features/<slug>/`
 * (CONTEXT.md decision #5) — versioned and agent-readable. Written into the
 * talk worktree when one exists, else the main checkout (see `feature-docs`).
 */

export interface DocSummary {
  relPath: string
  title: string
}

/** Create the docs dir and seed `brief.md` (title + oneLiner + created date). */
export function scaffoldDocs(ctx: AppCtx, feature: Feature): void {
  const project = requireProject(ctx)
  const dir = featureDocsDir(project, feature)
  mkdirSync(dir, { recursive: true })

  const briefPath = featureDocPath(project, feature, 'brief.md')
  if (!existsSync(briefPath)) {
    const created = new Date().toISOString()
    const brief = [
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

/** List `.md` docs for a feature (relPath within the docs dir + a title). */
export function listDocs(ctx: AppCtx, feature: Feature): DocSummary[] {
  const project = requireProject(ctx)
  const dir = featureDocsDir(project, feature)
  if (!existsSync(dir)) return []

  return readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isFile() && e.name.endsWith('.md'))
    .map((e) => ({ relPath: e.name, title: readTitle(join(dir, e.name), e.name) }))
    .sort((a, b) => a.relPath.localeCompare(b.relPath))
}

/** Read a doc by path relative to the feature's docs dir (traversal-guarded). */
export function readDoc(ctx: AppCtx, feature: Feature, relPath: string): { content: string } {
  const project = requireProject(ctx)
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

function readTitle(path: string, fallback: string): string {
  try {
    const firstLine = readFileSync(path, 'utf8').split('\n', 1)[0] ?? ''
    const heading = firstLine.match(/^#\s+(.+)$/)
    return heading ? heading[1].trim() : fallback
  } catch {
    return fallback
  }
}
