import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import type { AppCtx } from '../src/db/types'
import { listAfter } from '../src/services/events'
import { MAP_SECTIONS, listDocs, scaffoldDocs } from '../src/services/knowledge'
import { makeTestCtx } from './helpers/db'
import { seedFeature, seedProject, tmpRepo } from './helpers/fixtures'

/**
 * Mapped feature creation (ADR-0001 / SPEC §13.4). These exercise the map-doc
 * scaffold and the `mapped` flag round-trip directly against the docs dir + db,
 * without the git-branch path (covered by feature-create.test.ts) — the map
 * scaffold is pure filesystem work.
 */
describe('mapped feature scaffolding', () => {
  let ctx: AppCtx
  let repoPath: string
  let projectId: string

  beforeEach(async () => {
    ctx = await makeTestCtx()
    repoPath = tmpRepo()
    projectId = seedProject(ctx, repoPath).id
  })

  it('round-trips the mapped flag through the store', () => {
    const plain = seedFeature(ctx, projectId, { slug: 'plain' })
    const mapped = seedFeature(ctx, projectId, {
      slug: 'charted',
      mapped: true,
    })
    expect(plain.mapped).toBe(false)
    expect(mapped.mapped).toBe(true)
  })

  it('scaffolds map.md with the four sections only when mapped', () => {
    const mapped = seedFeature(ctx, projectId, { slug: 'charted', mapped: true })
    scaffoldDocs(ctx, mapped)

    const mapPath = join(repoPath, 'docs', 'features', 'charted', 'map.md')
    expect(existsSync(mapPath)).toBe(true)
    const body = readFileSync(mapPath, 'utf8')
    for (const section of MAP_SECTIONS) {
      expect(body).toContain(`## ${section}`)
    }
    // sections land in destination-first order
    expect(MAP_SECTIONS).toEqual(['Destination', 'Notes', 'Not yet specified', 'Out of scope'])

    // the map doc shows up in the knowledge listing beside the brief
    const relPaths = listDocs(ctx, mapped).map((d) => d.relPath)
    expect(relPaths).toContain('map.md')
    expect(relPaths).toContain('brief.md')
  })

  it('scaffolds no map.md for an unmapped feature', () => {
    const plain = seedFeature(ctx, projectId, { slug: 'plain' })
    scaffoldDocs(ctx, plain)
    expect(existsSync(join(repoPath, 'docs', 'features', 'plain', 'map.md'))).toBe(false)
    expect(listDocs(ctx, plain).map((d) => d.relPath)).not.toContain('map.md')
  })

  it('emits a scaffolded event mentioning the map for mapped features', () => {
    const mapped = seedFeature(ctx, projectId, { slug: 'charted', mapped: true })
    scaffoldDocs(ctx, mapped)
    const ev = listAfter(ctx, mapped.id, 0).find((e) => e.type === 'docs.scaffolded')
    expect(ev?.message).toContain('map')
  })
})

