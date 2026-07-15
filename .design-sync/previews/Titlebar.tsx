import { Titlebar } from '@runcastle/design-system'

const frame = { width: 980, background: 'var(--bg)', border: '1px solid var(--hairline)', borderRadius: 8, overflow: 'hidden' }

/** The IDE title bar. */
export const Default = () => (
  <div style={frame}><Titlebar /></div>
)
