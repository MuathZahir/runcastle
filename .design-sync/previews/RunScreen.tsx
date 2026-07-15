import { RunScreen } from '@runcastle/design-system'

const frame = { width: 960, height: 560, background: 'var(--bg)', border: '1px solid var(--hairline)', borderRadius: 8, overflow: 'hidden' }

/** A live burn: ticket lanes on the left, event stream on the right. */
export const Default = () => (
  <div style={frame}><RunScreen /></div>
)
