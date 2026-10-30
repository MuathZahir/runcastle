import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Feature, Project, TicketInput } from '@runcastle/core'
import { worktreeDir } from '@runcastle/core/paths'
import type { AppCtx } from '../../src/db/types'
import { emit } from '../../src/services/events'
import {
  addNote as addProjectNote,
  attachScreenshot,
  triageNotes,
} from '../../src/services/project-notes'
import { reportFinding } from '../../src/services/review-findings'
import { getTicket, storeTickets, updateTicket } from '../../src/services/tickets'
import { seedFeature } from './fixtures'

/**
 * A long-lived feature for the never-hidden guard test to hold every read tool
 * against (spec of `mcp-read-tools-stay-within-a-context-budget`).
 *
 * Every part is sized past the real maxima measured on 2026-09-24: every
 * ticket's context, acceptance criteria and digest at its real maximum, goals
 * of 1K (three batches well past the real 4–6K per batch) with one real-max 5K
 * goal, ~20K of open findings, and canonical docs over 111K (an 83K
 * `decisions.md`). With every doc moved out, the rows and to-do alone still
 * cross the ceiling, so the fixture also exercises the ticket move-out tiers:
 * goals on both feature shapes, and on the backlogged one settled tickets' rows.
 */

/** `n` chars of filler prose, labelled so a failing assertion can say whose. */
export function prose(label: string, n: number): string {
  const unit = `${label}: the quick brown fox jumps over the lazy dog. `
  return unit.repeat(Math.ceil(n / unit.length)).slice(0, n)
}

export const OVERSIZED = {
  batches: 3,
  ticketsPerBatch: 15,
  largestGoalChars: 5_000,
  goalChars: 1_000,
  contextChars: 9_000,
  acceptanceCriteria: 10,
  acceptanceCriterionChars: 750,
  digestChars: 8_000,
  findings: 7,
  findingDetailChars: 2_800,
  /**
   * Extra open findings on the `backlogged` shape: enough to move settled rows
   * out, while some rows stay. Each finding costs about 11 rows, so this sits
   * mid-band: 8 moves no rows, and 12 moves them all once a long Windows temp
   * path is counted in `notInlined`.
   */
  backlogFindings: 10,
  docs: {
    'brief.md': 7_500,
    'decisions.md': 83_000,
    'spec.md': 22_000,
  },
} as const

export interface OversizedFeature {
  feature: Feature
  /** The seq of a ticket carrying every field at its maximum. */
  largestTicketSeq: number
  /** Where the canonical docs were written: the talk worktree's docs dir. */
  docsDir: string
}

function oversizedTicket(batch: number, i: number, kind: TicketInput['kind']): TicketInput {
  return {
    title: `Batch ${batch} ticket ${i}: a realistically long ticket title for the row`,
    goal: prose(
      `goal ${batch}.${i}`,
      batch === 1 && i === 1 ? OVERSIZED.largestGoalChars : OVERSIZED.goalChars,
    ),
    context: prose(`context ${batch}.${i}`, OVERSIZED.contextChars),
    acceptanceCriteria: Array.from({ length: OVERSIZED.acceptanceCriteria }, (_, n) =>
      prose(`ac ${batch}.${i}.${n}`, OVERSIZED.acceptanceCriterionChars),
    ),
    seams: ['packages/server/src/mcp/server.ts read tools', 'packages/server/test guard'],
    blockedBy: i === 1 ? [] : [1],
    kind,
  }
}

/**
 * Seed one feature with three batches of burned tickets, real-max docs on disk,
 * its review's open findings, and — when `backlogged` — a findings backlog
 * heavy enough to push settled tickets' rows out.
 */
export function seedOversizedFeature(
  ctx: AppCtx,
  project: Project,
  options: { slug: string; backlogged?: boolean },
): OversizedFeature {
  const feature = seedFeature(ctx, project.id, {
    slug: options.slug,
    title: `Oversized ${options.slug}`,
  })

  let reviewTicketId = ''
  for (let batch = 1; batch <= OVERSIZED.batches; batch++) {
    const inputs = Array.from({ length: OVERSIZED.ticketsPerBatch }, (_, n) =>
      oversizedTicket(batch, n + 1, n + 1 === OVERSIZED.ticketsPerBatch ? 'review' : 'implementation'),
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
  const findings = OVERSIZED.findings + (options.backlogged ? OVERSIZED.backlogFindings : 0)
  for (let i = 1; i <= findings; i++) {
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
  const docsDir = join(worktreeDir(project.id, feature.slug), 'docs', 'features', feature.slug)
  mkdirSync(docsDir, { recursive: true })
  for (const [name, size] of Object.entries(OVERSIZED.docs)) {
    writeFileSync(join(docsDir, name), `# ${name}\n\n${prose(name, size)}`, 'utf8')
  }

  // Ticket #1 carries the 5K goal alongside every other maximum.
  return { feature, largestTicketSeq: 1, docsDir }
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
  /** One feature's work record: thirty tickets, each with a real-max digest. */
  workRecordTickets: 30,
  /** Tickets across that many shipped features share one seam, each with a digest. */
  seamTickets: 40,
  errorChars: 600,
  /** An untriaged notes backlog, every other note with a screenshot, plus triaged ones it must skip. */
  openNotes: 30,
  noteChars: 1_200,
  triagedNotes: 20,
  /** `CONTEXT.md`, past the real 10K charter with headroom; always inlined whole. */
  charterChars: 15_000,
  /** Live ADRs past the real eleven, plus superseded ones the index must omit. */
  liveAdrs: 20,
  supersededAdrs: 3,
  adrChars: 11_500,
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
 * under `worktreePath`, the project session's own tree, which also gets a
 * past-real-max charter and ADR set.
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

  for (let i = 1; i <= P.inFlight; i++) seed(`in-flight-${i}`)
  for (let i = 1; i <= P.drafts; i++) seed(`draft-${i}`, { status: 'draft' })
  for (let i = 1; i <= P.archived; i++) seed(`archived-${i}`, { status: 'archived' })

  const seam = 'apps/web shared shell'
  const shipped: Feature[] = []
  for (let i = 1; i <= P.shipped; i++) {
    const feature = seed(`shipped-${i}`, { status: 'shipped' })
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

  const record = seed('work-record', { status: 'shipped' })
  emit(ctx, record.id, { type: 'feature.shipped', message: 'merged to main' })
  const inputs = Array.from({ length: P.workRecordTickets }, (_, n) =>
    ticketInput(`ticket ${n + 1}`, ['packages/server/src/mcp/server.ts']),
  )
  for (const stored of storeTickets(ctx, record.id, inputs)) {
    updateTicket(ctx, stored.id, {
      status: 'done',
      commits: ['0123456789abcdef0123456789abcdef01234567'],
      digest: prose(`digest ${stored.seq}`, OVERSIZED.digestChars),
    })
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
  writeFileSync(join(worktreePath, 'CONTEXT.md'), prose('CONTEXT.md', P.charterChars), 'utf8')
  const adrDir = join(worktreePath, 'docs', 'adr')
  mkdirSync(adrDir, { recursive: true })
  for (let n = 1; n <= P.liveAdrs + P.supersededAdrs; n++) {
    const id = String(n).padStart(4, '0')
    const status = n <= P.supersededAdrs ? `Status: superseded by ADR-${P.liveAdrs + n}\n\n` : ''
    writeFileSync(
      join(adrDir, `${id}-a-realistically-long-decision-slug-${n}.md`),
      `# ADR-${id}: a realistically long decision title for its index entry\n\n${status}${prose(`adr ${n}`, P.adrChars)}`,
      'utf8',
    )
  }

  return { workRecordSlug: record.slug, seam: 'shared shell', briefSlug }
}
