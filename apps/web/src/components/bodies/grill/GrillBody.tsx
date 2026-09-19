import type { Phase } from '@runcastle/core'
import type { FeatureFull } from '../../../lib/api'
import { bodySessions, mapDocPath } from '../../../lib/feature-ui'
import { IconTerminal } from '../../../icons'
import { EmptyState } from '../../../ui'
import { SessionPanel } from '../../SessionPanel'
import { ArtifactPane } from './ArtifactPane'
import { MapRail } from './MapRail'

/**
 * Live ideation and spec: the artifact on the left, the terminal on the right
 * (decision 11). A pinned view of either phase is a different body — see
 * `PinnedBody` — so nothing here is ever read-only.
 *
 * The root claims the main axis of the workspace's two-pane body row (`flex-1`):
 * without it the split is sized to its content, and the terminal — the pane that
 * grows — collapses to whatever shrink-to-fit leaves it (258–368px at 1440×900,
 * with the rest of the workspace unclaimed beside it), which is the width
 * decision 15 hides the Details panel to avoid.
 */
export function GrillBody({ full, effective, chatDocked = false, mapRailCollapsed, onToggleMapRail, artifactPaneCollapsed, onToggleArtifactPane }: {
  full: FeatureFull; effective: Phase; chatDocked?: boolean; mapRailCollapsed: boolean; onToggleMapRail: () => void; artifactPaneCollapsed: boolean; onToggleArtifactPane: () => void
}) {
  // Planning is one state but two documents, so the pane follows the same
  // derived rule the rest of the collapse uses: spec.md on disk means the spec
  // step is done and the spec is what there is to read; before that, the
  // decisions are.
  const kind = full.docs.some((doc) => doc.relPath.endsWith('spec.md')) ? 'spec' : 'decisions'
  // With the chat docked beside this body it owns the chat's terminal, so what
  // is left here is the map's own sessions (decision 16). Losing the last one
  // that way is a different empty state from never having opened one — a
  // feature nobody has talked to still gets the door, not a pointer at a panel
  // holding nothing.
  const sessions = bodySessions(full.sessions, chatDocked)
  return (
    <div className="flex h-full min-h-0 min-w-0 flex-1 gap-4">
      {full.feature.mapped && effective === 'planning' ? (
        <MapRail full={full} relPath={mapDocPath(full)} collapsed={mapRailCollapsed} onToggle={onToggleMapRail} />
      ) : (
        <ArtifactPane featureId={full.feature.id} kind={kind} docs={full.docs} collapsed={artifactPaneCollapsed} onToggle={onToggleArtifactPane} mapped={full.feature.mapped} />
      )}
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        {sessions.length > 0 ? (
          <SessionPanel featureId={full.feature.id} sessions={sessions} full={full} />
        ) : (
          <div className="flex min-h-0 flex-1 rounded-lg border border-hairline bg-panel-2">
            {sessions.length < full.sessions.length ? (
              <EmptyState icon={<IconTerminal size={16} />} title="The chat is docked" hint="The conversation is in the panel on the right — collapse it to bring the terminal back here." />
            ) : (
              <EmptyState icon={<IconTerminal size={16} />} title="No session yet" hint="Start a session from the bar above — you and the agent shape the idea here before any code is written." />
            )}
          </div>
        )}
      </div>
    </div>
  )
}
