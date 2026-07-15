import { OverviewScreen } from '@runcastle/design-system'

const frame = { width: 820, height: 600, background: 'var(--bg)', border: '1px solid var(--hairline)', borderRadius: 8, overflow: 'hidden' }

/** A feature in review — primary action + secondary links + timeline. */
export const Default = () => (
  <div style={frame}><OverviewScreen /></div>
)

/** A feature still in the tickets phase. */
export const Tickets = () => (
  <div style={frame}>
    <OverviewScreen
      phase="tickets"
      title="Billing webhooks"
      summary="5 tickets shaped and reviewed. Burn them to implement, then review the run."
      primaryLabel="Burn 5 tickets"
    />
  </div>
)
