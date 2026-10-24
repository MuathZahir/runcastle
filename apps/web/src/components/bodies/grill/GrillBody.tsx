import type { FeatureFull } from '../../../lib/api'
import { ArtifactPane } from './ArtifactPane'

/**
 * The decisions and the spec: the artifact the conversation is shaping, the
 * whole width of the Plan view while there is no preview. The conversation
 * itself is the chat beside it.
 *
 * The root claims the main axis of the workspace's body row (`flex-1`): without
 * it the pane is sized to its content rather than to the body.
 */
export function GrillBody({ full }: { full: FeatureFull }) {
  // One view, two documents: spec.md on disk means the spec is what there is
  // to read; before that, the decisions are.
  const kind = full.docs.some((doc) => doc.relPath.endsWith('spec.md')) ? 'spec' : 'decisions'
  return (
    <div className="flex h-full min-h-0 min-w-0 flex-1">
      <ArtifactPane featureId={full.feature.id} kind={kind} docs={full.docs} />
    </div>
  )
}
