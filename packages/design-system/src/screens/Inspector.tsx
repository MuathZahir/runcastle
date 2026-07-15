import { SectionTitle } from '../components/SectionTitle'
import { DimLine } from '../components/DimLine'
import { Button } from '../components/Button'

type Phase = 'ideation' | 'spec' | 'tickets' | 'implementation' | 'review' | 'shipped'
const PHASE_ORDER: Phase[] = ['ideation', 'spec', 'tickets', 'implementation', 'review', 'shipped']

export interface InspectorDoc {
  title: string
  relPath: string
}
export interface InspectorEvent {
  time: string
  type: string
  message: string
}

export interface InspectorProps {
  /** Current phase — drives the stepper and the gate line. */
  phase?: Phase
  /** Whether the current gate is satisfied. */
  gateSatisfied?: boolean
  /** Knowledge docs. */
  docs?: InspectorDoc[]
  /** Recent activity events. */
  activity?: InspectorEvent[]
}

const DEFAULT_DOCS: InspectorDoc[] = [
  { title: 'Spec', relPath: 'SPEC.md' },
  { title: 'PRD', relPath: 'PRD.md' },
  { title: 'Research', relPath: 'RESEARCH.md' },
]
const DEFAULT_ACTIVITY: InspectorEvent[] = [
  { time: '2m', type: 'burn.done', message: 'ticket #4 merged (a1f9c2)' },
  { time: '4m', type: 'burn.start', message: 'burning 5 tickets' },
  { time: '9m', type: 'gate.pass', message: 'G2 tickets approved' },
  { time: '12m', type: 'tickets.emit', message: '5 tickets shaped' },
]

/**
 * The right rail bound to the active feature: Pipeline (a vertical phase stepper
 * + the current gate and its advance/override actions), Knowledge (doc links),
 * and Activity (recent events).
 * @category Screens
 */
export function Inspector({
  phase = 'review',
  gateSatisfied = true,
  docs = DEFAULT_DOCS,
  activity = DEFAULT_ACTIVITY,
}: InspectorProps) {
  const currentIdx = PHASE_ORDER.indexOf(phase)
  const stateOf = (idx: number) => (idx < currentIdx ? 'done' : idx === currentIdx ? 'current' : 'upcoming')

  return (
    <div className="inspector">
      <section className="insp-section">
        <SectionTitle>Pipeline</SectionTitle>
        <div className="stepper">
          {PHASE_ORDER.map((p, idx) => (
            <div key={p} className={`step step-${stateOf(idx)}`}>
              <span className={`step-mark phase-fg-${p}`} />
              <span className="step-label mono">{p}</span>
            </div>
          ))}
        </div>
        <div className="gate">
          <div className={`gate-line mono ${gateSatisfied ? 'gate-ok' : 'gate-block'}`}>
            G3 · {gateSatisfied ? 'satisfied' : 'blocked — burn incomplete'}
          </div>
          <div className="gate-actions">
            <Button size="xs">Advance</Button>
            <Button size="xs">Override…</Button>
          </div>
        </div>
      </section>

      <section className="insp-section">
        <SectionTitle>Knowledge</SectionTitle>
        {docs.length === 0 ? (
          <DimLine>no docs yet</DimLine>
        ) : (
          <ul className="doc-list">
            {docs.map((d) => (
              <li key={d.relPath}>
                <button className="doc-link">
                  <span className="doc-title">{d.title}</span>
                  <span className="doc-path mono dim">{d.relPath}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="insp-section insp-activity">
        <SectionTitle>Activity</SectionTitle>
        <div className="activity-log">
          {activity.map((e, i) => (
            <div key={i} className="act-line mono">
              <span className="act-time">{e.time}</span>
              <span className="act-type">{e.type}</span>
              <span className="act-msg">{e.message}</span>
            </div>
          ))}
        </div>
      </section>
    </div>
  )
}
