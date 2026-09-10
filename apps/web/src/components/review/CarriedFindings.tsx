import type { ReviewFinding } from '@runcastle/core'
import { SectionTitle } from '../../ui'
import { WorkList, type WorkRow } from './WorkList'

/**
 * "Carried, still open" — the defects a lap parked rather than answered
 * (decisions #5), in their own band between the open work and the full account.
 *
 * They are deliberately NOT in the open count: the inflated "N still open" that
 * sent the human back through the Iterate door over defects a later lap had
 * already dealt with is exactly what carrying them fixes. So they are visible
 * and out of the tally — the lap's agenda rather than its debt, which is the
 * same deal carried test notes get in `test-notes.md`'s own
 * `## Carried, still open` section.
 *
 * The rows are the page's one row anatomy ({@link WorkList}), so a carried
 * defect reads exactly like every other defect on the page and each card
 * carries the two verbs that are the human's alone: Reopen and Dismiss.
 */
export function CarriedFindings({
  featureId,
  findings,
  readonly,
}: {
  featureId: string
  /**
   * The server's own carried pile (`viewByFeature().carriedFindings`) — keyed on
   * status and spanning every lap, because a defect carried into lap 2 and
   * skipped there is still carried at lap 3.
   */
  findings: readonly ReviewFinding[]
  /** Looking back at review on a shipped feature — a record, not an agenda. */
  readonly: boolean
}) {
  if (findings.length === 0) return null

  const rows: WorkRow[] = findings.map((finding) => ({
    lap: finding.lap,
    item: { kind: 'defect', finding },
    // Never the human's open work — that is what carrying it decided.
    open: false,
  }))

  return (
    <section id="carried-findings" className="flex flex-col gap-4">
      <div className="flex items-baseline gap-3">
        <SectionTitle>Carried, still open</SectionTitle>
        <span className="font-mono text-xs text-text-3">
          {findings.length} carried · not counted as open
        </span>
      </div>

      <WorkList featureId={featureId} rows={rows} readonly={readonly} onStage={null} />
    </section>
  )
}
