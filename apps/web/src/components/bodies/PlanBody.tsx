import { useEffect, useRef, useState } from 'react'
import type { FeatureFull } from '../../lib/api'
import { countDecisions } from '../../lib/feature-ui'
import { relTimeAgo } from '../../lib/format'
import { useFeatureDoc } from '../../lib/use-feature-doc'
import { IconDoc, IconExpand, IconEye, IconList } from '../../icons'
import { EmptyState, IconButton, StatusLabel, Tabs } from '../../ui'
import { DocProse } from '../DocReader'
import { PreviewPanel } from '../PreviewPanel'
import { PanelViewBar } from '../workspace/PanelViewBar'

type Part = 'preview' | 'decisions' | 'spec'

/**
 * The panel's Plan view (the-feature-s-right-panel decisions 5, 6): the plan is
 * three documents, so the view is one bar with three small tabs (Preview,
 * Decisions with its count, Spec) and the part on show filling the rest. The
 * preview fills the view edge to edge with its own scrollbar; decisions and
 * spec are prose at the reading width. Before a preview exists the bar has
 * Decisions and Spec only, and the spec leads once it is written.
 */
export function PlanBody({ full, onOpenDesign }: { full: FeatureFull; onOpenDesign: (path: string) => void }) {
  const decisions = full.docs.find((doc) => doc.relPath.endsWith('decisions.md'))
  const spec = full.docs.find((doc) => doc.relPath.endsWith('spec.md'))
  const lead: Part = full.preview ? 'preview' : spec ? 'spec' : 'decisions'
  const [part, setPart] = useState<Part>(lead)
  const [fullWindow, setFullWindow] = useState(false)
  // The count rides on the Decisions tab whichever part is on show.
  const decisionsDoc = useFeatureDoc(full.feature.id, decisions?.relPath)
  const count = countDecisions(decisionsDoc.content ?? '')
  const updating = useSpecUpdating(full.feature.id, spec?.relPath)

  const items = [
    ...(full.preview ? [{ id: 'preview' as const, label: 'Preview', icon: <IconEye /> }] : []),
    { id: 'decisions' as const, label: 'Decisions', icon: <IconList />, ...(count > 0 ? { count } : {}) },
    { id: 'spec' as const, label: 'Spec', icon: <IconDoc /> },
  ]
  const shown = part === 'preview' && !full.preview ? lead : part
  const shownDoc = shown === 'decisions' ? decisions : shown === 'spec' ? spec : undefined
  const age =
    shown === 'preview' ? full.preview?.updatedAt : shownDoc?.updatedAt

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PanelViewBar
        className="sticky top-0 z-10 bg-surface"
        aside={
          <>
            {shown === 'spec' && updating && (
              <StatusLabel tone="live" className="mr-1 animate-fade-in">
                Updating
              </StatusLabel>
            )}
            {age !== undefined && <span className="mr-1">updated {relTimeAgo(age)}</span>}
            {shown === 'preview' && (
              <IconButton label="Open full window" size="sm" icon={<IconExpand />} onClick={() => setFullWindow(true)} />
            )}
          </>
        }
      >
        <Tabs items={items} value={shown} onChange={setPart} size="sm" label="Plan" className="-ml-1" />
      </PanelViewBar>
      {shown === 'preview' && full.preview ? (
        <PreviewPanel
          featureId={full.feature.id}
          preview={full.preview}
          fullWindow={fullWindow}
          onFullWindow={setFullWindow}
          onOpenDesign={onOpenDesign}
        />
      ) : (
        <div className="min-h-0 flex-1">
          <DocProse
            featureId={full.feature.id}
            relPath={shownDoc?.relPath}
            empty={<PlanDocEmpty part={shown === 'spec' ? 'spec' : 'decisions'} />}
          />
        </div>
      )}
    </div>
  )
}

/**
 * Whether the spec changed in the last three seconds: the live mark while the
 * agent writes it.
 */
function useSpecUpdating(featureId: string, relPath: string | undefined): boolean {
  const doc = useFeatureDoc(featureId, relPath)
  const previous = useRef<string | undefined>(undefined)
  const [updating, setUpdating] = useState(false)
  useEffect(() => {
    if (doc.content === undefined) return
    const changed = previous.current !== undefined && previous.current !== doc.content
    previous.current = doc.content
    if (!changed) return
    setUpdating(true)
    const timer = window.setTimeout(() => setUpdating(false), 3000)
    return () => window.clearTimeout(timer)
  }, [doc.content])
  return updating
}

/** What is coming, never what to do: the chat is where the human starts anything. */
function PlanDocEmpty({ part }: { part: 'decisions' | 'spec' }) {
  return (
    <EmptyState
      compact
      icon={<IconDoc />}
      title={part === 'decisions' ? 'No decisions yet' : 'No spec yet'}
      hint={
        part === 'decisions'
          ? 'They land here one by one as the agent settles them with you.'
          : 'The agent writes the spec once the decisions settle. It appears here as it is written.'
      }
    />
  )
}
