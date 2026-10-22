import { EndSessionItem } from '../EndSessionButton'
import { ScenarioChatMenu, scenarioErrandHint } from './ScenarioChat'
import { SessionSwitcher } from './SessionSwitcher'
import type { FeatureChatColumn } from './use-feature-chat-column'

/**
 * The feature page's session switcher (design-mode decisions 9, 12), in its
 * one header row. Its menu speaks for the chat in front, where that chat's own
 * header row was: the feature chat's End session and its one-transcript note,
 * or the scenario chat's errand, its close and End session.
 */
export function FeatureSessionSwitcher({
  column,
  featureId,
  liveSessionId,
}: {
  column: FeatureChatColumn
  featureId: string
  /** The feature's own live session, which End session ends. */
  liveSessionId?: string
}) {
  const scenarioInFront = !!column.scenario.sessionId && column.inFront === column.scenario.sessionId
  return (
    <SessionSwitcher
      entries={column.entries}
      current={column.inFront}
      onPick={column.pick}
      hint={scenarioInFront ? scenarioErrandHint(column.scenario.errand) : 'One transcript per feature'}
    >
      {scenarioInFront ? (
        <ScenarioChatMenu chat={column.scenario} featureId={featureId} />
      ) : (
        liveSessionId && <EndSessionItem featureId={featureId} sessionId={liveSessionId} />
      )}
    </SessionSwitcher>
  )
}
