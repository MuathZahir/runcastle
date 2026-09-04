import type { Phase } from '@runcastle/core'
import type { FeatureFull } from '../../../lib/api'
import { artifactSelection, mapDocPath } from '../../../lib/feature-ui'
import { IconTerminal } from '../../../icons'
import { EmptyState } from '../../../ui'
import { SessionPanel } from '../../SessionPanel'
import { ArtifactPane } from './ArtifactPane'
import { MapRail } from './MapRail'

export function GrillBody({ full, effective, readonly = false, mapRailCollapsed, onToggleMapRail, artifactPaneCollapsed, onToggleArtifactPane }: {
  full: FeatureFull; effective: Phase; readonly?: boolean; mapRailCollapsed: boolean; onToggleMapRail: () => void; artifactPaneCollapsed: boolean; onToggleArtifactPane: () => void
}) {
  const selection = artifactSelection({ phase: effective, mapped: full.feature.mapped, docs: full.docs })
  return (
    <div className="flex h-full min-h-0 gap-4">
      {full.feature.mapped && effective === 'ideation' && selection.kind === 'map' ? (
        <MapRail full={full} relPath={mapDocPath(full)} collapsed={mapRailCollapsed} onToggle={onToggleMapRail} readonly={readonly} />
      ) : (
        <ArtifactPane featureId={full.feature.id} kind={effective === 'spec' ? 'spec' : 'decisions'} docs={full.docs} collapsed={artifactPaneCollapsed} onToggle={onToggleArtifactPane} mapped={full.feature.mapped} />
      )}
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        {full.sessions.length > 0 ? (
          <SessionPanel featureId={full.feature.id} sessions={full.sessions} full={full} />
        ) : (
          <div className="flex min-h-0 flex-1 rounded-lg border border-hairline bg-panel-2">
            <EmptyState icon={<IconTerminal size={16} />} title="No session yet" hint={readonly ? 'No session was recorded for this phase.' : 'Start a session from the bar above — you and the agent shape the idea here before any code is written.'} />
          </div>
        )}
      </div>
    </div>
  )
}
