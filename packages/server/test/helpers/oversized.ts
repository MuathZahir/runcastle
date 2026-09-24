import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Feature, Project, TicketInput } from '@runcastle/core'
import { worktreeDir } from '@runcastle/core/paths'
import { eq } from 'drizzle-orm'
import { features } from '../../src/db/schema'
import type { AppCtx } from '../../src/db/types'
import { emit } from '../../src/services/events'
import {
  addNote as addProjectNote,
  attachScreenshot,
  triageNotes,
} from '../../src/services/project-notes'
import { reportFinding } from '../../src/services/review-findings'
import { addNote } from '../../src/services/test-notes'
import { getTicket, storeTickets, updateTicket } from '../../src/services/tickets'
import { storeWaypoints } from '../../src/services/waypoints'
import { seedFeature } from './fixtures'

/**
 * A long-lived feature for the never-hidden guard test to hold every read tool
 * against (spec of `mcp-read-tools-stay-within-a-context-budget`).
 *
 * What the summary MOVES OUT is sized past the real maxima measured on
 * 2026-09-24: every ticket's context, acceptance criteria and digest at its
 * real maximum, and canonical docs over 111K (an 83K `decisions.md`).
 *
 * What the summary keeps INLINE — ticket rows with their goals, findings, test
 * notes, waypoints — is sized to what the design can hold, NOT to every real
 * maximum at once. Docs are the only part `get_feature_context` moves out
 * (decisions.md #6), and 45+ ticket rows (~13K of row fields before any goal),
 * a real-max 5K goal, ~21K of findings plus notes and a 12-waypoint map already
 * use most of the ceiling. At the spec's 35K of findings plus notes on the same
 * feature, the payload would cross the ceiling with nothing left to move out —
 * the spec's accepted risk, reached sooner than it estimated.
 */

/** `n` chars of filler prose, labelled so a failing assertion can say whose. */
export function prose(label: string, n: number): string {
  const unit = `${label}: the quick brown fox jumps over the lazy dog. `
  return unit.repeat(Math.ceil(n / unit.length)).slice(0, n)
}

export const OVERSIZED = {
  laps: 3,
  ticketsPerLap: 15,
  largestGoalChars: 5_000,
  goalChars: 150,
  contextChars: 9_000,
  acceptanceCriteria: 10,
  acceptanceCriterionChars: 750,
  digestChars: 8_000,
  findings: 7,
  findingDetailChars: 1_400,
  testNotes: 7,
  testNoteChars: 1_100,
  waypoints: 12,
  waypointQuestionChars: 400,
  docs: {
    'brief.md': 7_500,
    'decisions.md': 83_000,
    'spec.md': 22_000,
    'map.md': 10_000,
  },
} as const

export interface OversizedFeature {
  feature: Feature
  /** The seq of a ticket carrying every field at its maximum. */
  largestTicketSeq: number
  /** Where the canonical docs were written: the talk worktree's docs dir. */
  docsDir: string
}

function oversizedTicket(lap: number, i: number, kind: TicketInput['kind']): TicketInput {
  return {
    title: `Lap ${lap} ticket ${i}: a realistically long ticket title for the row`,
    goal: prose(
      `goal ${lap}.${i}`,
      lap === 1 && i === 1 ? OVERSIZED.largestGoalChars : OVERSIZED.goalChars,
    ),
    context: prose(`context ${lap}.${i}`, OVERSIZED.contextChars),
    acceptanceCriteria: Array.from({ length: OVERSIZED.acceptanceCriteria }, (_, n) =>
      prose(`ac ${lap}.${i}.${n}`, OVERSIZED.acceptanceCriterionChars),
    ),
    seams: ['packages/server/src/mcp/server.ts read tools', 'packages/server/test guard'],
    blockedBy: i === 1 ? [] : [1],
    kind,
  }
}

/**
 * Seed one feature at lap 3 with three laps of burned tickets, real-max docs on
 * disk, this lap's review findings and test notes, and — when `mapped` — a
 * twelve-waypoint map.
 */
export function seedOversizedFeature(
  ctx: AppCtx,
  project: Project,
  options: { slug: string; mapped?: boolean },
): OversizedFeature {
  const feature = seedFeature(ctx, project.id, {
    slug: options.slug,
    title: `Oversized ${options.slug}`,
    mapped: options.mapped ?? false,
    lap: 1,
  })

  let reviewTicketId = ''
  for (let lap = 1; lap <= OVERSIZED.laps; lap++) {
    ctx.db.update(features).set({ lap }).where(eq(features.id, feature.id)).run()
    const inputs = Array.from({ length: OVERSIZED.ticketsPerLap }, (_, n) =>
      oversizedTicket(lap, n + 1, n + 1 === OVERSIZED.ticketsPerLap ? 'review' : 'implementation'),
    )
    for (const stored of storeTickets(ctx, feature.id, inputs)) {
      updateTicket(ctx, stored.id, {
        status: 'done',
        digest: prose(`digest ${stored.seq}`, OVERSIZED.digestChars),
      })
      if (stored.kind === 'review') reviewTicketId = stored.id
    }
  }

  const reviewTicket = getTicket(ctx, reviewTicketId)
  for (let i = 1; i <= OVERSIZED.findings; i++) {
    reportFinding(ctx, {
      featureId: feature.id,
      reviewTicket,
      input: {
        kind: 'defect',
        severity: 'medium',
        title: `Finding ${i}: the saved value does not survive a reload`,
        location: 'screen: editor',
        citation: 'spec.md: edits persist',
        detail: prose(`finding ${i}`, OVERSIZED.findingDetailChars),
        reproStep: 'Edit the title, save, reload.',
      },
    })
  }
  for (let i = 1; i <= OVERSIZED.testNotes; i++) {
    addNote(ctx, feature.id, prose(`note ${i}`, OVERSIZED.testNoteChars))
  }

  if (feature.mapped) {
    storeWaypoints(
      ctx,
      feature.id,
      Array.from({ length: OVERSIZED.waypoints }, (_, n) => ({
        title: `Waypoint ${n + 1}: settle one open question of the map`,
        type: 'grilling' as const,
        question: prose(`waypoint ${n + 1}`, OVERSIZED.waypointQuestionChars),
        // Batch positions are 1-based: waypoint n+1 is blocked by the one before it.
        blockedBy: n === 0 ? [] : [n],
      })),
    )
  }

  const docsDir = join(worktreeDir(project.id, feature.slug), 'docs', 'features', feature.slug)
  mkdirSync(docsDir, { recursive: true })
  for (const [name, size] of Object.entries(OVERSIZED.docs)) {
    if (name === 'map.md' && !feature.mapped) continue
    writeFileSync(join(docsDir, name), `# ${name}\n\n${prose(name, size)}`, 'utf8')
  }

  // Ticket #1 carries the 5K goal alongside every other maximum.
  return { feature: { ...feature, lap: OVERSIZED.laps }, largestTicketSeq: 1, docsDir }
}

/**
 * A project past the real portfolio (108 features, one-liners up to 2.5K) for
 * the project-scope read tools: `get_project_context`, `get_work_record` and
 * `read_feature_brief`.
 */
export const OVERSIZED_PORTFOLIO = {
  inFlight: 4,
  drafts: 2,
  archived: 3,
  shipped: 115,
  oneLinerChars: 2_500,
  /** One feature's work record: three laps of ten tickets, each with a real-max digest. */
  workRecordLaps: 3,
  workRecordTicketsPerLap: 10,
  /** Tickets across that many shipped features share one seam, each with a digest. */
  seamTickets: 40,
  errorChars: 600,
  /** An untriaged notes backlog, every other note with a screenshot, plus triaged ones it must skip. */
  openNotes: 30,
  noteChars: 1_200,
  triagedNotes: 20,
} as const

export interface OversizedPortfolio {
  /** A shipped feature whose slug-form work record must move digests out. */
  workRecordSlug: string
  /** A seam fragment matching {@link OVERSIZED_PORTFOLIO.seamTickets} tickets. */
  seam: string
  /** A shipped feature with a real-max `brief.md` in the session worktree. */
  briefSlug: string
}

function ticketInput(title: string, seams: string[]): TicketInput {
  return {
    title,
    goal: prose(`goal ${title}`, OVERSIZED.goalChars),
    context: prose(`context ${title}`, OVERSIZED.contextChars),
    acceptanceCriteria: [prose(`ac ${title}`, OVERSIZED.acceptanceCriterionChars)],
    seams,
    blockedBy: [],
  }
}

/**
 * Seed every kind of feature a long-lived project carries, 120+ in all, each
 * with a multi-thousand-char one-liner; every shipped one gets its
 * `feature.shipped` event. The shipped `briefSlug` gets a real-max `brief.md`
 * under `worktreePath`, the project session's own tree.
 */
export function seedOversizedPortfolio(
  ctx: AppCtx,
  project: Project,
  worktreePath: string,
): OversizedPortfolio {
  const P = OVERSIZED_PORTFOLIO
  const seed = (slug: string, overrides: Partial<Feature> = {}): Feature =>
    seedFeature(ctx, project.id, {
      slug,
      title: `${slug}: a realistically long feature title for its index line`,
      oneLiner: prose(`one-liner ${slug}`, P.oneLinerChars),
      ...overrides,
    })

  for (let i = 1; i <= P.inFlight; i++) seed(`in-flight-${i}`, { phase: 'building', lap: 2 })
  for (let i = 1; i <= P.drafts; i++) seed(`draft-${i}`, { status: 'draft' })
  for (let i = 1; i <= P.archived; i++) seed(`archived-${i}`, { status: 'archived' })

  const seam = 'apps/web shared shell'
  const shipped: Feature[] = []
  for (let i = 1; i <= P.shipped; i++) {
    const feature = seed(`shipped-${i}`, { status: 'shipped', phase: 'shipped' })
    emit(ctx, feature.id, { type: 'feature.shipped', message: 'merged to main' })
    shipped.push(feature)
    if (i > P.seamTickets) continue
    const [ticket] = storeTickets(ctx, feature.id, [ticketInput(`seam ticket ${i}`, [seam])])
    updateTicket(ctx, ticket.id, {
      status: 'failed',
      commits: ['0123456789abcdef0123456789abcdef01234567'],
      error: prose(`error ${i}`, P.errorChars),
      digest: prose(`digest seam ${i}`, OVERSIZED.digestChars),
    })
  }

  const record = seed('work-record', { status: 'shipped', phase: 'shipped' })
  emit(ctx, record.id, { type: 'feature.shipped', message: 'merged to main' })
  for (let lap = 1; lap <= P.workRecordLaps; lap++) {
    ctx.db.update(features).set({ lap }).where(eq(features.id, record.id)).run()
    const inputs = Array.from({ length: P.workRecordTicketsPerLap }, (_, n) =>
      ticketInput(`lap ${lap} ticket ${n + 1}`, ['packages/server/src/mcp/server.ts']),
    )
    for (const stored of storeTickets(ctx, record.id, inputs)) {
      updateTicket(ctx, stored.id, {
        status: 'done',
        commits: ['0123456789abcdef0123456789abcdef01234567'],
        digest: prose(`digest ${stored.seq}`, OVERSIZED.digestChars),
      })
    }
  }

  const briefSlug = shipped[0].slug
  const briefDir = join(worktreePath, 'docs', 'features', briefSlug)
  mkdirSync(briefDir, { recursive: true })
  writeFileSync(join(briefDir, 'brief.md'), prose('brief.md', OVERSIZED.docs['brief.md']), 'utf8')

  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47])
  for (let i = 1; i <= P.openNotes; i++) {
    const note = addProjectNote(ctx, project.id, prose(`open note ${i}`, P.noteChars))
    if (i % 2 === 0) attachScreenshot(ctx, note.id, png)
  }
  const triaged = Array.from({ length: P.triagedNotes }, (_, n) =>
    addProjectNote(ctx, project.id, prose(`triaged note ${n + 1}`, P.noteChars)),
  )
  triageNotes(ctx, triaged.map((note) => note.id), 'folded into an existing feature')

  return { workRecordSlug: record.slug, seam: 'shared shell', briefSlug }
}
