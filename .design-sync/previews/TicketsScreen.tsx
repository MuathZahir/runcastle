import { TicketsScreen } from '@runcastle/design-system'

const frame = { width: 820, height: 600, background: 'var(--bg)', border: '1px solid var(--hairline)', borderRadius: 8, overflow: 'hidden' }

/** The burn bar over a ticket ledger, with one row expanded. */
export const Default = () => (
  <div style={frame}><TicketsScreen /></div>
)
