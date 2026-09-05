import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Feature, Project, ReviewFinding, TestNote, Ticket } from '@runcastle/core'
import { featureDocsRel } from '@runcastle/core/paths'
import type { AppCtx } from '../db/types'
import { emit } from './events'
import * as git from './git'
import { listByFeature as listFindings } from './review-findings'
import { listByFeature as listNotes } from './test-notes'
import { listByFeature as listTickets } from './tickets'

export interface OutcomeArtifact {
  ticketId: string
  lap: number
  passKind: 'review' | 'verification'
  reviewedCommit: string | null
  completedAt: number | null
  landedSince: number
}

export interface OutcomeInput {
  feature: Feature
  tickets: Ticket[]
  findings: ReviewFinding[]
  notes: TestNote[]
  artifacts: OutcomeArtifact[]
  shippedAt: number
  delta: { commits: number; files: number }
}

const EMPTY_VALUE = /^(?:[-*]\s*)?(?:none|nothing|n\/?a)[.!]?$/i

export function digestHasSubstance(text: string): boolean {
  return text.split('\n').some((line) => {
    const trimmed = line.trim()
    return /^[-*]\s+/.test(trimmed) && !EMPTY_VALUE.test(trimmed)
  })
}

function findingResolution(finding: ReviewFinding): string {
  return finding.status === 'fixed' ? 'fixed' : finding.status === 'dismissed' ? 'dismissed' : 'open'
}

function noteResolution(note: TestNote): string {
  if (note.status === 'promoted') return `quick-fixed → ticket ${note.ticketId ?? 'unknown'}`
  if (note.status === 'carried') return `carried → lap ${note.carriedLap ?? '?'}`
  if (note.status === 'done') return 'dismissed/done'
  return 'open'
}

/** Pure synthesis of the permanent shipped record. */
export function composeOutcomeDoc(input: OutcomeInput): string {
  const { feature, tickets, findings, notes, artifacts, shippedAt, delta } = input
  const laps = Math.max(feature.lap, ...tickets.map((ticket) => ticket.lap), 1)
  const blocks = [
    `# Outcome — ${feature.title}`,
    feature.oneLiner,
    `- Shipped: ${new Date(shippedAt).toISOString().slice(0, 10)}\n- Laps run: ${laps}`,
    `## What shipped\n\n${delta.commits} commits · ${delta.files} files`,
  ]
  for (let lap = 1; lap <= laps; lap += 1) {
    const implementation = tickets.filter((ticket) => ticket.kind === 'implementation' && ticket.lap === lap)
    const line = (status: Ticket['status'], label: string): string => {
      const matches = implementation.filter((ticket) => ticket.status === status)
      return `- ${matches.length} ${label}${matches.length ? `: ${matches.map((t) => `#${t.seq} ${t.title}`).join('; ')}` : ''}`
    }
    blocks.push(`### Lap ${lap}\n${line('done', 'tickets landed')}\n${line('cancelled', 'waived')}\n${line('failed', 'failed')}`)
  }

  blocks.push('## Review record')
  const completed = artifacts.filter((artifact) => artifact.completedAt !== null)
  const latest = [...completed].sort((a, b) => a.completedAt! - b.completedAt!).at(-1)
  for (const artifact of completed) {
    const ticket = tickets.find((candidate) => candidate.id === artifact.ticketId)
    blocks.push(`### Lap ${artifact.lap} · ${artifact.passKind}\n\n- Reviewed commit: ${artifact.reviewedCommit ?? 'unknown'}\n- Landed since: ${artifact.landedSince}\n- Outcome: ${ticket?.status ?? 'unknown'}`)
    if (artifact.ticketId === latest?.ticketId) {
      const passFindings = findings.filter((finding) => finding.reviewTicketId === artifact.ticketId)
      blocks.push(passFindings.length
        ? passFindings.map((finding) => `- **${finding.title}** — ${findingResolution(finding)}`).join('\n')
        : '- No findings')
    }
  }
  if (!completed.length) blocks.push('- No completed review pass')

  blocks.push('## Notes record', notes.length
    ? notes.map((note) => `- ${note.text} — ${noteResolution(note)}`).join('\n')
    : '- No human notes')

  const substantive = tickets.filter((ticket) => ticket.digest && digestHasSubstance(ticket.digest))
  if (substantive.length) {
    blocks.push('## Per-ticket digests')
    for (let lap = 1; lap <= laps; lap += 1) {
      const inLap = substantive.filter((ticket) => ticket.lap === lap)
      if (inLap.length) blocks.push(`### Lap ${lap}`, ...inLap.map((ticket) => `#### ${ticket.seq}. ${ticket.title}\n\n${ticket.digest!.trim()}`))
    }
  }
  return `${blocks.join('\n\n')}\n`
}

/** Write and commit the record in the main checkout after the merge commit. */
export async function promoteOutcomeDoc(
  ctx: AppCtx, project: Project, feature: Feature, target: string,
  delta: { commits?: number; files?: number },
): Promise<void> {
  try {
    const tickets = listTickets(ctx, feature.id)
    const artifacts: OutcomeArtifact[] = tickets.filter((ticket) => ticket.kind === 'review').map((ticket) => ({
      ticketId: ticket.id, lap: ticket.lap, passKind: ticket.passKind,
      reviewedCommit: ticket.reviewedCommit, completedAt: ticket.completedAt,
      landedSince: ticket.completedAt === null ? 0 : tickets.filter((candidate) =>
        candidate.kind === 'implementation' && candidate.status === 'done' &&
        candidate.completedAt !== null && candidate.completedAt > ticket.completedAt!,
      ).length,
    }))
    const doc = composeOutcomeDoc({
      feature, tickets, findings: listFindings(ctx, feature.id), notes: listNotes(ctx, feature.id), artifacts,
      shippedAt: Date.now(), delta: { commits: delta.commits ?? 0, files: delta.files ?? 0 },
    })
    const docsDir = join(project.repoPath, ...featureDocsRel(feature.slug).split('/'))
    mkdirSync(docsDir, { recursive: true })
    writeFileSync(join(docsDir, 'outcome.md'), doc, 'utf8')
    await git.commitDocsOnBranch(project.repoPath, target, `runcastle: outcome for ${feature.slug}`)
  } catch (error) {
    emit(ctx, feature.id, {
      type: 'docs.outcome_failed',
      message: `outcome.md not promoted on ${target}: ${error instanceof Error ? error.message : String(error)}`,
    })
  }
}
