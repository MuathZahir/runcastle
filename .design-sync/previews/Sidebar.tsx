import { Sidebar } from '@runcastle/design-system'

const frame = { width: 240, background: 'var(--bg)', border: '1px solid var(--hairline)', borderRadius: 8, overflow: 'hidden' }

/** The features rail with a mix of phases, a burning row, and a needs-attention dot. */
export const Default = () => (
  <div style={frame}><Sidebar /></div>
)
