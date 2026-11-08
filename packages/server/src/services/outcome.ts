import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Feature, Project, ReviewFinding, TestNote, Ticket, WorkerRow } from '@runcastle/core'
import { featureDocsRel } from '@runcastle/core/paths'
import type { AppCtx } from '../db/types'
import { emit } from './events'
import * as git from './git'
import { listByFeature as listFindings } from './review-findings'
import { listByFeature as listNotes } from './test-notes'
import { listByFeature as listTickets } from './tickets'
import { keepFeatureConversations, listWorkers } from '../workers/service'

export interface OutcomeArtifact {
  ticketId: string
  seq: number
  passKind: 'review' | 'verification'
  reviewedCommit: string | null
  completedAt: number | null
  landedSince: number
}

export interface OutcomeInput {
  feature: Feature
  tickets: Ticket[]
  /** The feature's workers, each with the tokens read from its kept conversation. */
  workers?: WorkerRow[]
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
  return note.sentAt === undefined ? 'not sent' : 'sent to the agent'
}

/** One finding as the record keeps it: what it was, where it ended, and why when the lead said. */
function findingRecordLine(finding: ReviewFinding): string {
  const why = finding.resolutionNote?.trim()
  return `- **${finding.title}** (${finding.kind}, ${finding.severity}) — ${findingResolution(finding)}${why ? `: ${why}` : ''}`
}

/** A Review worker's part of the review record: its mode, what it verified, and its findings. */
function reviewWorkerRecord(review: WorkerRow, findings: ReviewFinding[]): string[] {
  const mode = `${review.reviewMode ?? 'unknown'} review${review.reviewVerify ? ', verify' : ''}`
  const facts = [`- Outcome: ${review.outcome ?? review.status}`]
  if (review.reviewVerify?.commits.length) facts.push(`- Verified fix commits: ${review.reviewVerify.commits.join(', ')}`)
  const own = findings.filter((finding) => finding.reviewWorkerId === review.id)
  return [
    `### ${review.label} · ${mode}\n\n${facts.join('\n')}`,
    own.length ? own.map(findingRecordLine).join('\n') : '- No findings',
  ]
}

/** Pure synthesis of the permanent shipped record. */
export function composeOutcomeDoc(input: OutcomeInput): string {
  const { feature, tickets, workers = [], findings, notes, artifacts, shippedAt, delta } = input
  const blocks = [
    `# Outcome — ${feature.title}`,
    feature.oneLiner,
    `- Shipped: ${new Date(shippedAt).toISOString().slice(0, 10)}`,
    `## What shipped\n\n${delta.commits} commits · ${delta.files} files`,
  ]
  const implementation = tickets.filter((ticket) => ticket.kind === 'implementation')
  const line = (status: Ticket['status'], label: string): string => {
    const matches = implementation.filter((ticket) => ticket.status === status)
    return `- ${matches.length} ${label}${matches.length ? `: ${matches.map((t) => `#${t.seq} ${t.title}`).join('; ')}` : ''}`
  }
  // A feature built by workers has no tickets: its Workers section below is the record.
  if (implementation.length) {
    blocks.push(`${line('done', 'tickets landed')}\n${line('cancelled', 'waived')}\n${line('failed', 'failed')}`)
  }

  blocks.push('## Review record')
  const completed = artifacts.filter((artifact) => artifact.completedAt !== null)
  const latest = [...completed].sort((a, b) => a.completedAt! - b.completedAt!).at(-1)
  for (const artifact of completed) {
    const ticket = tickets.find((candidate) => candidate.id === artifact.ticketId)
    blocks.push(`### Ticket ${artifact.seq} · ${artifact.passKind}\n\n- Reviewed commit: ${artifact.reviewedCommit ?? 'unknown'}\n- Landed since: ${artifact.landedSince}\n- Outcome: ${ticket?.status ?? 'unknown'}`)
    if (artifact.ticketId === latest?.ticketId) {
      const passFindings = findings.filter((finding) => finding.reviewTicketId === artifact.ticketId)
      blocks.push(passFindings.length
        ? passFindings.map((finding) => `- **${finding.title}** — ${findingResolution(finding)}`).join('\n')
        : '- No findings')
    }
  }
  // A feature reviewed since reviews became workers (burns-become-workers decision 4):
  // each Review worker with every finding it reported, keyed to it.
  const reviews = workers.filter((w) => w.kind === 'review')
  for (const review of reviews) blocks.push(...reviewWorkerRecord(review, findings))
  if (!completed.length && !reviews.length) blocks.push('- No completed review pass')

  blocks.push('## Notes record', notes.length
    ? notes.map((note) => `- ${note.text} — ${noteResolution(note)}`).join('\n')
    : '- No human notes')

  if (workers.length) {
    blocks.push(
      '## Workers',
      workers
        .map((w) => `- ${w.label} (${w.kind}) — ${w.outcome ?? w.status} · ${w.tokens === null ? 'tokens not counted' : `${w.tokens} tokens`}`)
        .join('\n'),
    )
  }

  const substantive = tickets.filter((ticket) => ticket.digest && digestHasSubstance(ticket.digest))
  if (substantive.length) {
    blocks.push(
      '## Per-ticket digests',
      ...substantive.map((ticket) => `### ${ticket.seq}. ${ticket.title}\n\n${ticket.digest!.trim()}`),
    )
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
      ticketId: ticket.id, seq: ticket.seq, passKind: ticket.passKind,
      reviewedCommit: ticket.reviewedCommit, completedAt: ticket.completedAt,
      landedSince: ticket.completedAt === null ? 0 : tickets.filter((candidate) =>
        candidate.kind === 'implementation' && candidate.status === 'done' &&
        candidate.completedAt !== null && candidate.completedAt > ticket.completedAt!,
      ).length,
    }))
    await keepFeatureConversations(ctx, feature.id)
    const doc = composeOutcomeDoc({
      feature, tickets, workers: listWorkers(ctx, feature.id), findings: listFindings(ctx, feature.id), notes: listNotes(ctx, feature.id), artifacts,
      shippedAt: Date.now(), delta: { commits: delta.commits ?? 0, files: delta.files ?? 0 },
    })
    await git.onBranch(project.repoPath, target, async () => {
      const docsDir = join(project.repoPath, ...featureDocsRel(feature.slug).split('/'))
      mkdirSync(docsDir, { recursive: true })
      writeFileSync(join(docsDir, 'outcome.md'), doc, 'utf8')
      // Only the outcome itself: a merge goes ahead past the human's unrelated
      // uncommitted files (docs included), and they must stay uncommitted.
      await git.commitDocs(
        project.repoPath,
        git.docsCommitMessage(`outcome for ${feature.slug}`, project.docsCommitPrefix),
        `${featureDocsRel(feature.slug)}/outcome.md`,
      )
    })
  } catch (error) {
    emit(ctx, feature.id, {
      type: 'docs.outcome_failed',
      message: `outcome.md not promoted on ${target}: ${error instanceof Error ? error.message : String(error)}`,
    })
  }
}
