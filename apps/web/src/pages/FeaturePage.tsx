import { BurnControl } from '../components/BurnControl'
import { KnowledgeCard } from '../components/KnowledgeCard'
import { PhaseStepper } from '../components/PhaseStepper'
import { RunPanel } from '../components/RunPanel'
import { SessionsCard } from '../components/SessionsCard'
import { TestDriveMergePanel } from '../components/TestDriveMergePanel'
import { TicketsTable } from '../components/TicketsTable'
import { Timeline } from '../components/Timeline'
import { useEventLog } from '../lib/events'
import { navigate } from '../lib/router'
import { trpc } from '../trpc'
import { PhaseBadge } from '../ui'

export function FeaturePage({ id }: { id: string }) {
  const featureQuery = trpc.feature.get.useQuery(
    { id },
    { refetchInterval: 1500 },
  )
  const events = useEventLog(id)

  if (featureQuery.isLoading) {
    return <div className="empty">Loading feature…</div>
  }
  if (featureQuery.error || !featureQuery.data) {
    return (
      <div>
        <button className="link-btn back" onClick={() => navigate({ name: 'home' })}>
          &larr; features
        </button>
        <div className="banner-error">
          Failed to load feature:{' '}
          {featureQuery.error?.message ?? 'not found'}
        </div>
      </div>
    )
  }

  const { feature, tickets, sessions, runs, docs, gate } = featureQuery.data

  return (
    <div className="feature-page">
      <button className="link-btn back" onClick={() => navigate({ name: 'home' })}>
        &larr; features
      </button>

      <div className="feature-head">
        <div>
          <h1>{feature.title}</h1>
          <div className="muted">{feature.oneLiner}</div>
          <div className="feature-meta mono muted">
            {feature.branch} · {feature.size} · {feature.status}
          </div>
        </div>
        <PhaseBadge phase={feature.phase} />
      </div>

      <PhaseStepper
        featureId={feature.id}
        phase={feature.phase}
        size={feature.size}
        gate={gate}
      />

      <div className="grid-2">
        <SessionsCard featureId={feature.id} sessions={sessions} />
        <KnowledgeCard featureId={feature.id} docs={docs} />
      </div>

      <div className="card">
        <div className="card-head">
          <h2 className="section-title">
            Tickets <span className="muted">{tickets.length}</span>
          </h2>
          <BurnControl
            featureId={feature.id}
            phase={feature.phase}
            ticketCount={tickets.length}
          />
        </div>
        <div className="card-body">
          <TicketsTable tickets={tickets} />
        </div>
      </div>

      <RunPanel runs={runs} events={events} />
      <TestDriveMergePanel featureId={feature.id} phase={feature.phase} />
      <Timeline events={events} />
    </div>
  )
}
