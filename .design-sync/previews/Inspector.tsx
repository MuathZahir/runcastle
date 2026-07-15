import { Inspector } from '@runcastle/design-system'

const frame = { width: 280, background: 'var(--bg)', border: '1px solid var(--hairline)', borderRadius: 8, overflow: 'hidden' }

/** Pipeline stepper + gate, Knowledge docs, and recent Activity. */
export const Default = () => (
  <div style={frame}><Inspector /></div>
)
