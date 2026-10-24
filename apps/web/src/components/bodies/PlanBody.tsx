import { useState } from 'react'
import type { FeatureFull } from '../../lib/api'
import { PLAN_DOCS } from '../../lib/feature-ui/panel'
import { IconDoc } from '../../icons'
import { Button } from '../../ui'
import { DocPeek } from '../DocPeek'
import { PreviewPanel } from '../PreviewPanel'
import { GrillBody } from './grill/GrillBody'

/**
 * The panel's Plan view (tickets-and-review-are-tools-not-phases decision 8):
 * the plan preview, with the decisions and the spec one click away above it.
 * Before a preview exists, the decisions or the spec themselves — the
 * artifact pane, whose docs menu reaches the other.
 */
export function PlanBody({ full, onOpenDesign }: { full: FeatureFull; onOpenDesign: (path: string) => void }) {
  const [peek, setPeek] = useState<FeatureFull['docs'][number] | null>(null)
  if (!full.preview) return <GrillBody full={full} />
  const docs = PLAN_DOCS.flatMap((name) => full.docs.filter((doc) => doc.relPath.endsWith(name)))
  return (
    <div className="flex flex-col gap-3">
      {docs.length > 0 && (
        <div className="flex items-center gap-1">
          {docs.map((doc) => (
            <Button key={doc.relPath} variant="ghost" size="sm" icon={<IconDoc />} onClick={() => setPeek(doc)}>
              <span className="font-mono">{doc.relPath.split(/[\\/]/).pop()}</span>
            </Button>
          ))}
        </div>
      )}
      <PreviewPanel featureId={full.feature.id} preview={full.preview} onOpenDesign={onOpenDesign} />
      {peek && (
        <DocPeek
          featureId={full.feature.id}
          relPath={peek.relPath}
          title={peek.title || peek.relPath}
          onClose={() => setPeek(null)}
        />
      )}
    </div>
  )
}
