import type { Phase } from '@runcastle/core'
import type { FeatureFull } from '../../../lib/api'
import { mapDocPath } from '../../../lib/feature-ui'
import { ArtifactPane } from './ArtifactPane'
import { MapRail } from './MapRail'

/**
 * Live ideation and spec: the artifact the conversation is shaping, the whole
 * width of the body. The conversation itself is on the Chat tab
 * (one-chat-layout-everywhere decisions 1 and 2 — no split, not even here). A
 * pinned view of either phase is a different body — see `PinnedBody` — so
 * nothing here is ever read-only.
 *
 * The root claims the main axis of the workspace's body row (`flex-1`): without
 * it the pane is sized to its content rather than to the body.
 */
export function GrillBody({ full, effective }: { full: FeatureFull; effective: Phase }) {
  // Planning is one state but two documents, so the pane follows the same
  // derived rule the rest of the collapse uses: spec.md on disk means the spec
  // step is done and the spec is what there is to read; before that, the
  // decisions are.
  const kind = full.docs.some((doc) => doc.relPath.endsWith('spec.md')) ? 'spec' : 'decisions'
  return (
    <div className="flex h-full min-h-0 min-w-0 flex-1">
      {full.feature.mapped && effective === 'planning' ? (
        <MapRail full={full} relPath={mapDocPath(full)} />
      ) : (
        <ArtifactPane featureId={full.feature.id} kind={kind} docs={full.docs} mapped={full.feature.mapped} />
      )}
    </div>
  )
}
