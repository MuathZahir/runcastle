import { IconCube, IconHome, IconMessage } from '../../icons'
import { StatusDot, Tabs } from '../../ui'

/** The views a feature page switches between with its topbar Tabs. */
export type FeatureView = 'overview' | 'tickets' | 'chat'

/**
 * A feature's view tabs: Overview | Tickets | Chat, the same in every state
 * (one-chat-layout-everywhere decision 1). Chat sits where the top bar's old
 * Chat toggle sat, with the same word; it is a view now, and switching to it
 * never launches anything (decision 5). Its dot says a session is live.
 *
 * A draft has no branch to chat on and nothing to ticket, so it has no views
 * at all (decision 11) — this renders nothing for one.
 */
export function FeatureViewTabs({
  isDraft,
  value,
  onChange,
  ticketCount,
  sessionLive,
}: {
  isDraft: boolean
  value: FeatureView
  onChange: (view: FeatureView) => void
  /** This lap's implementation tickets; 0 shows no count. */
  ticketCount: number
  sessionLive: boolean
}) {
  if (isDraft) return null
  return (
    <Tabs<FeatureView>
      label="Feature views"
      size="sm"
      value={value}
      onChange={onChange}
      items={[
        { id: 'overview', label: 'Overview', icon: <IconHome /> },
        {
          id: 'tickets',
          label: 'Tickets',
          icon: <IconCube />,
          ...(ticketCount > 0 ? { count: ticketCount } : {}),
        },
        {
          id: 'chat',
          label: (
            <span className="inline-flex items-center gap-1.5">
              Chat
              {sessionLive && <StatusDot tone="live" label="Session live" />}
            </span>
          ),
          icon: <IconMessage />,
        },
      ]}
    />
  )
}
