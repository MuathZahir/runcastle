import type { ReviewFinding } from '@runcastle/core'
import { Button, FindingSeverityChip, SectionTitle } from '../ui'
import {
  findingCountsLine,
  findingOpenReason,
  headline,
  type FindingCounts,
} from '../lib/feature-ui'

/**
 * What the review agent found, rendered the way decisions #3 and #7 ask for it:
 * one computed line, the observations compactly beneath the digest, and ONLY the
 * still-open defects as a list.
 *
 * The wall of ~200-word paragraphs this replaces is the whole reason the feature
 * exists — every note had to be read in full just to learn whether it needed
 * action. A finding now leads with its title and severity; the detail the review
 * wrote is one disclosure away, for the rows where the human wants it.
 *
 * Deliberately hook-free. Both blocks take their rows and their callbacks as
 * props so the page's single findings query is read once by {@link ReviewBody}
 * and the two can never disagree about the counts — and so the rendering is
 * testable without a tRPC provider.
 */

/** A finding's title + severity, with the review's own detail behind a disclosure. */
function FindingDetail({ finding }: { finding: ReviewFinding }) {
  const { head, rest } = headline(finding.detail)
  const location = finding.location.trim()
  return (
    <details className="finding-detail">
      <summary>{head}</summary>
      <div className="finding-body">
        {rest && <p>{rest}</p>}
        {location && <div className="finding-where">{location}</div>}
        <div className="finding-cite">{finding.citation}</div>
        {finding.reproStep && <div className="finding-repro">{finding.reproStep}</div>}
      </div>
    </details>
  )
}

/**
 * The counts line and the observations, under the digest prose in the review
 * card's lead block. Observations are everything the review saw that no fix
 * ticket could act on (decisions #2) — the summary, deferred scope, what it
 * could not verify — so they are information here and never rows in a list the
 * human has to clear.
 */
export function FindingsSummaryBlock({
  summary,
  findings,
}: {
  summary?: FindingCounts
  findings: readonly ReviewFinding[]
}) {
  const line = findingCountsLine(summary)
  if (!line) return null
  const observations = findings.filter((f) => f.kind === 'observation')

  return (
    <div className="findings-summary">
      <div className="findings-counts">{line}</div>
      {observations.length > 0 && (
        <ul className="findings-observations">
          {observations.map((finding) => (
            <li key={finding.id}>
              <span className="finding-title">{finding.title}</span>
              <FindingDetail finding={finding} />
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

/**
 * The defects the run could not close — over the auto-fix cap, or left behind by
 * a fix ticket that failed. Each row says why it is open in one line, so the
 * human never has to ask what stopped; the bar above offers the one click that
 * fixes all of them, and Dismiss is here for the ones they judge shippable, so
 * the count can reach zero without a burn (decisions #7).
 *
 * Renders nothing when nothing is open: an empty "Open defects" card is a
 * question the human did not need asked.
 */
export function OpenDefectsCard({
  open,
  busy,
  readonly,
  onDismiss,
}: {
  /** The server's own open set, so this list cannot disagree with the counts. */
  open: readonly ReviewFinding[]
  /** A dismissal is in flight; the list is about to be refetched. */
  busy: boolean
  /** Looking back at review on a shipped feature — the record, no editing. */
  readonly: boolean
  onDismiss: (findingId: string) => void
}) {
  if (open.length === 0) return null

  return (
    <div className="review-card findings-card">
      <SectionTitle>Open defects</SectionTitle>
      <div className="findings-list">
        {open.map((finding) => {
          const why = findingOpenReason(finding)
          return (
            <div key={finding.id} className="finding-row">
              <div className="finding-head">
                <FindingSeverityChip severity={finding.severity} />
                <span className="finding-title">{finding.title}</span>
                {why && <span className="finding-why">{why}</span>}
                {!readonly && (
                  <span className="finding-actions">
                    <Button
                      variant="ghost"
                      className="btn-xs"
                      disabled={busy}
                      onClick={() => onDismiss(finding.id)}
                    >
                      Dismiss
                    </Button>
                  </span>
                )}
              </div>
              <FindingDetail finding={finding} />
            </div>
          )
        })}
      </div>
    </div>
  )
}
