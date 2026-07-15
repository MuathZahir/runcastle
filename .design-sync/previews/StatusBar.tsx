import { StatusBar } from '@runcastle/design-system'

const frame = { width: 980, background: 'var(--bg)', border: '1px solid var(--hairline)', borderRadius: 8, overflow: 'hidden' }

/** Idle: test drive off. */
export const Default = () => (
  <div style={frame}><StatusBar /></div>
)

/** Test-driving a review branch (blue) with a Stop control. */
export const Driving = () => (
  <div style={frame}><StatusBar driving="fix/ship-path-bugs" /></div>
)
