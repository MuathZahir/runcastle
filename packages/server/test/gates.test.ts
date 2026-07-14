import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Feature, Project } from '@runcastle/core'
import { beforeEach, describe, expect, it } from 'vitest'
import type { AppCtx } from '../src/db/types'
import { checkGate } from '../src/services/gates'
import { featureDocsDir } from '../src/services/feature-docs'
import { storeTickets } from '../src/services/tickets'
import { updateTicket } from '../src/services/tickets'
import { makeTestCtx } from './helpers/db'
import { seedFeature, seedProject, tmpRepo } from './helpers/fixtures'

function writeDoc(project: Project, feature: Feature, name: string): void {
  const dir = featureDocsDir(project, feature)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, name), '# doc\n', 'utf8')
}

describe('gates service', () => {
  let ctx: AppCtx
  let project: Project

  beforeEach(async () => {
    ctx = await makeTestCtx()
    project = seedProject(ctx, tmpRepo())
  })

  it('decisions-file-exists reflects decisions.md presence', () => {
    const feature = seedFeature(ctx, project.id, { slug: 'g1' })
    expect(checkGate(ctx, 'decisions-file-exists', feature).satisfied).toBe(false)
    writeDoc(project, feature, 'decisions.md')
    expect(checkGate(ctx, 'decisions-file-exists', feature).satisfied).toBe(true)
  })

  it('spec-file-exists reflects spec.md for full features, auto-true for collapsed', () => {
    const full = seedFeature(ctx, project.id, { slug: 'g2-full', size: 'full' })
    expect(checkGate(ctx, 'spec-file-exists', full).satisfied).toBe(false)
    writeDoc(project, full, 'spec.md')
    expect(checkGate(ctx, 'spec-file-exists', full).satisfied).toBe(true)

    const collapsed = seedFeature(ctx, project.id, { slug: 'g2-col', size: 'collapsed' })
    expect(checkGate(ctx, 'spec-file-exists', collapsed).satisfied).toBe(true)
  })

  it('tickets-approved requires at least one ticket', () => {
    const feature = seedFeature(ctx, project.id, { slug: 'g3', phase: 'tickets' })
    expect(checkGate(ctx, 'tickets-approved', feature).satisfied).toBe(false)
    storeTickets(ctx, feature.id, [
      { title: 't', goal: 'g', context: 'c', acceptanceCriteria: ['a'], seams: [], blockedBy: [] },
    ])
    expect(checkGate(ctx, 'tickets-approved', feature).satisfied).toBe(true)
  })

  it('all-tickets-terminal is satisfied only when every ticket is done/failed', () => {
    const feature = seedFeature(ctx, project.id, { slug: 'g4', phase: 'implementation' })
    const [a, b] = storeTickets(ctx, feature.id, [
      { title: 'a', goal: 'g', context: 'c', acceptanceCriteria: ['x'], seams: [], blockedBy: [] },
      { title: 'b', goal: 'g', context: 'c', acceptanceCriteria: ['x'], seams: [], blockedBy: [] },
    ])
    expect(checkGate(ctx, 'all-tickets-terminal', feature).satisfied).toBe(false)
    updateTicket(ctx, a.id, { status: 'done' })
    expect(checkGate(ctx, 'all-tickets-terminal', feature).satisfied).toBe(false)
    updateTicket(ctx, b.id, { status: 'failed' })
    expect(checkGate(ctx, 'all-tickets-terminal', feature).satisfied).toBe(true)
  })

  it('human-merge is always false (Merge click bypasses)', () => {
    const feature = seedFeature(ctx, project.id, { slug: 'g5', phase: 'review' })
    expect(checkGate(ctx, 'human-merge', feature).satisfied).toBe(false)
  })
})
