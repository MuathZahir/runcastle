import { AppShell } from '@runcastle/design-system'

const frame = {
  width: 1160,
  height: 720,
  background: 'var(--bg)',
  overflow: 'hidden',
  borderRadius: 8,
  border: '1px solid var(--hairline)',
}

/** The whole IDE with the Overview tab active. */
export const Overview = () => (
  <div style={frame}><AppShell activeTab="overview" /></div>
)

/** The same frame with the Tickets tab active. */
export const Tickets = () => (
  <div style={frame}><AppShell activeTab="tickets" /></div>
)
