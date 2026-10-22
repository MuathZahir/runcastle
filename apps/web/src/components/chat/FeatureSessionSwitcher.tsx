import { EndSessionItem } from '../EndSessionButton'
import { ScenarioChatMenu, scenarioErrandHint } from './ScenarioChat'
import { SessionSwitcher } from './SessionSwitcher'
import { SideSessionMenu } from './SideSessions'
import type { FeatureChatColumn } from './use-feature-chat-column'

/**
 * The feature page's session switcher (design-mode decisions 9, 12), in its
 * one header row. Its menu speaks for the chat in front, where that chat's own
 * header row was: the feature chat's End session and its note, the scenario
 * chat's errand, its close and End session, or a side session's End session.
 * New side session is always there (several-sessions-per-feature decision 10).
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
  const sideInFront = column.sides.rows.some((s) => s.id === column.inFront)
  const hint = scenarioInFront
    ? scenarioErrandHint(column.scenario.errand)
    : sideInFront
      ? 'A side session · everything but the rounds'
      : 'Plans the feature · the lead after Go'
  return (
    <SessionSwitcher entries={column.entries} current={column.inFront} onPick={column.pick} hint={hint}>
      {scenarioInFront ? (
        <ScenarioChatMenu chat={column.scenario} featureId={featureId} />
      ) : (
        !sideInFront && liveSessionId && <EndSessionItem featureId={featureId} sessionId={liveSessionId} />
      )}
      <SideSessionMenu sides={column.sides} featureId={featureId} inFront={column.inFront} />
    </SessionSwitcher>
  )
}
