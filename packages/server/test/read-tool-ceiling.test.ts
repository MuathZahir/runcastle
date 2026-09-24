import { existsSync, mkdtempSync, readFileSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Project } from '@runcastle/core'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { AppCtx } from '../src/db/types'
import { featureContext, toolGetTicket, toolListTickets } from '../src/mcp/server'
import { MCP_READ_CEILING_CHARS, serializedLength } from '../src/mcp/read-ceiling'
import { useDataDir } from './helpers/data-dir'
import { makeTestCtx } from './helpers/db'
import { rmTemp, seedProject } from './helpers/fixtures'
import { type OversizedFeature, seedOversizedFeature } from './helpers/oversized'

/**
 * The never-hidden guard (decisions.md #3 of
 * `mcp-read-tools-stay-within-a-context-budget`): past Claude Code's spill line
 * an MCP result is saved to a file the agent often never opens, so every read
 * tool's reply — serialized exactly as the handler sends it — must stay under
 * the shared ceiling on a feature sized past anything real.
 */
describe('read tools never outgrow the never-hidden ceiling', () => {
  let ctx: AppCtx
  let project: Project
  let home: string
  let restore: () => void

  beforeEach(async () => {
    home = mkdtempSync(join(tmpdir(), 'runcastle-read-ceiling-'))
    restore = useDataDir(home)
    ctx = await makeTestCtx()
    project = seedProject(ctx)
  })

  afterEach(() => {
    restore()
    rmTemp(home)
  })

  describe.each([
    ['linear', false],
    ['mapped', true],
  ])('get_feature_context on a %s feature', (_label, mapped) => {
    let seeded: OversizedFeature

    beforeEach(() => {
      seeded = seedOversizedFeature(ctx, project, { slug: `oversized-${_label}`, mapped })
    })

    it('fits under the ceiling', () => {
      const context = featureContext(ctx, { featureId: seeded.feature.id })
      expect(serializedLength(context)).toBeLessThanOrEqual(MCP_READ_CEILING_CHARS)
    })

    it('moves the docs that do not fit out whole, with a path to read them by', () => {
      const context = featureContext(ctx, { featureId: seeded.feature.id })

      const decisions = context.notInlined.find((doc) => doc.relPath === 'decisions.md')
      expect(decisions).toBeDefined()
      expect(decisions?.absPath).toBe(join(seeded.docsDir, 'decisions.md'))
      expect(existsSync(decisions?.absPath ?? '')).toBe(true)
      expect(decisions?.reason).toContain('read_feature_doc')
      expect(context.docs.map((doc) => doc.relPath)).not.toContain('decisions.md')
      expect(context.docsNote).toContain('notInlined')

      // Every canonical doc on disk is accounted for exactly once, in fill
      // order, and an inlined one is the whole file — never a head cut.
      const onDisk = mapped
        ? ['brief.md', 'decisions.md', 'spec.md', 'map.md']
        : ['brief.md', 'decisions.md', 'spec.md']
      const inlined = context.docs.map((doc) => doc.relPath)
      const movedOut = context.notInlined.map((doc) => doc.relPath)
      expect([...inlined, ...movedOut].sort()).toEqual([...onDisk].sort())
      expect(inlined).toEqual(onDisk.filter((name) => inlined.includes(name)))
      expect(movedOut).toEqual(onDisk.filter((name) => movedOut.includes(name)))
      for (const doc of context.docs) {
        expect(doc.content).toBe(readFileSync(join(seeded.docsDir, doc.relPath), 'utf8'))
      }
      for (const doc of context.notInlined) {
        expect(doc.bytes).toBe(statSync(doc.absPath).size)
      }
    })

    it('opens with the decision-critical header', () => {
      const context = featureContext(ctx, { featureId: seeded.feature.id })
      const text = JSON.stringify(context)
      expect(text.indexOf('"annotatedModels"')).toBeGreaterThan(-1)
      expect(text.indexOf('"annotatedModels"')).toBeLessThan(2_000)
      expect(text.indexOf('"burnConcurrency"')).toBeGreaterThan(-1)
      expect(text.indexOf('"burnConcurrency"')).toBeLessThan(2_000)
      // Header, then rows, then the lap's to-do, then docs (the fixture never
      // burned, so `latestRun` is absent, and nobody claimed a waypoint).
      expect(Object.keys(context)).toEqual([
        'feature',
        'phase',
        'lap',
        'annotatedModels',
        'burnConcurrency',
        ...(mapped ? ['frontierIds'] : []),
        'reviewEvidence',
        'currentLapReview',
        'tickets',
        'openDefects',
        'carriedDefects',
        'findings',
        'testNotes',
        ...(mapped ? ['waypoints'] : []),
        'docs',
        'notInlined',
        'moreDocs',
        'docsNote',
      ])
    })
  })

  it('get_ticket on the largest ticket and list_tickets fit under the ceiling', () => {
    const seeded = seedOversizedFeature(ctx, project, { slug: 'oversized-tickets' })
    const reader = { featureId: seeded.feature.id }

    const largest = toolGetTicket(ctx, reader, { seq: seeded.largestTicketSeq })
    expect(largest.digest).toBeDefined()
    expect(serializedLength(largest)).toBeLessThanOrEqual(MCP_READ_CEILING_CHARS)
    expect(serializedLength(toolListTickets(ctx, reader, {}))).toBeLessThanOrEqual(
      MCP_READ_CEILING_CHARS,
    )
  })
})
