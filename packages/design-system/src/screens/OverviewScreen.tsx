import { Tag } from '../components/Tag'
import { Button } from '../components/Button'
import { GhostLink } from '../components/GhostLink'
import { DimLine } from '../components/DimLine'

type Phase = 'ideation' | 'spec' | 'tickets' | 'implementation' | 'review' | 'shipped'

export interface OverviewEvent {
  time: string
  type: string
  message: string
}

export interface OverviewScreenProps {
  /** Feature phase (colours the tag). */
  phase?: Phase
  /** Feature title. */
  title?: string
  /** One-line state summary. */
  summary?: string
  /** Label for the single solid primary action. */
  primaryLabel?: string
  /** Recent timeline events. */
  events?: OverviewEvent[]
}

const DEFAULT_EVENTS: OverviewEvent[] = [
  { time: '2m', type: 'run.succeeded', message: '5/5 tickets burned clean' },
  { time: '18m', type: 'burn.start', message: 'burning 5 tickets' },
  { time: '1h', type: 'gate.pass', message: 'G2 tickets approved' },
  { time: '1h', type: 'tickets.emit', message: '5 tickets shaped from spec' },
  { time: '2h', type: 'phase.advance', message: 'spec → tickets' },
]

/**
 * The overview tab — NOT a dashboard. A single centred column: phase tag +
 * title, a one-line state summary, THE primary action as the only solid button,
 * ghost secondary actions, then a recent-events timeline.
 * @category Screens
 */
export function OverviewScreen({
  phase = 'review',
  title = 'Auth flow',
  summary = 'Implementation is clean and merged to the branch. Test drive it, then merge to ship.',
  primaryLabel = 'Test drive',
  events = DEFAULT_EVENTS,
}: OverviewScreenProps) {
  return (
    <div className="overview">
      <div className="overview-col">
        <div className="overview-phase">
          <Tag tone={phase}>{phase}</Tag>
          <span className="overview-title">{title}</span>
        </div>
        <p className="overview-summary">{summary}</p>

        <Button variant="solid" className="overview-primary">{primaryLabel}</Button>

        <div className="overview-secondary">
          <GhostLink>Open terminal</GhostLink>
          <GhostLink>Tickets</GhostLink>
          <GhostLink>Open Q&amp;A</GhostLink>
          <GhostLink>Open docs</GhostLink>
        </div>

        <div className="overview-timeline">
          <div className="section-title">Recent</div>
          {events.length === 0 && <DimLine>no activity yet</DimLine>}
          {events.map((e, i) => (
            <div key={i} className="tl-line mono">
              <span className="tl-time">{e.time}</span>
              <span className="tl-type">{e.type}</span>
              <span className="tl-msg">{e.message}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
