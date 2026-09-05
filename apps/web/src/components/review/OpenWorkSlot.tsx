import type { ReviewFinding, TestNote } from '@runcastle/core'
import { trpc } from '../../trpc'
import type { FeatureFull } from '../../lib/api'
import type { FindingCounts } from '../../lib/feature-ui'
import { useToast } from '../../lib/toast'
import { FindingsSummaryBlock, OpenDefectsCard } from '../ReviewFindings'
import { NotesPanel } from './NotesLegacy'

/**
 * The "what still needs attention" band (decision 18c), in its interim shape.
 *
 * Decision 18c merges the review agent's open defects and the human's drive /
 * annotation notes into ONE section with one row anatomy; ticket 8 builds that
 * (`OpenWork` + `NoteRow`). Until then this slot holds the two lists the page
 * already had, in the band's position, so the layout rebuild above it can land
 * without the inbox in the same diff.
 */
export function OpenWorkSlot({
  featureId,
  lap,
  tickets,
  notes,
  findings,
  summary,
  openDefects,
  readonly,
  onJump,
}: {
  featureId: string
  lap: number
  tickets: FeatureFull['tickets']
  notes: TestNote[]
  /** Everything the review reported — the observations among them lead here. */
  findings: readonly ReviewFinding[]
  summary?: FindingCounts
  openDefects: readonly ReviewFinding[]
  readonly: boolean
  /** Send the recording on the stage to a moment, when its own recording is up. */
  onJump?: (seconds: number) => void
}) {
  const utils = trpc.useUtils()
  const toast = useToast()
  // Dismissing is how the open count reaches zero without a burn — a defect the
  // human judged shippable is a decision, not a fix (decisions #7).
  const dismiss = trpc.findings.dismiss.useMutation({
    onSuccess: () => void utils.findings.listByFeature.invalidate({ featureId }),
    onError: (e) => toast.push(e.message),
  })

  return (
    <div id="open-work" className="flex flex-col gap-6">
      {/* What the review made of the branch in one computed line, with the
          observations under it — everything it saw that no fix ticket could act
          on. It led the deleted Summary card; the verdict belongs with the work
          it is a verdict about. */}
      <FindingsSummaryBlock summary={summary} findings={findings} />
      <OpenDefectsCard
        open={openDefects}
        busy={dismiss.isPending}
        readonly={readonly}
        onDismiss={(findingId) => dismiss.mutate({ findingId })}
      />
      <NotesPanel
        featureId={featureId}
        lap={lap}
        tickets={tickets}
        rows={notes}
        readonly={readonly}
        onJump={onJump}
      />
    </div>
  )
}
