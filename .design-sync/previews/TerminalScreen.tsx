import { TerminalScreen } from '@runcastle/design-system'

const frame = { width: 820, height: 420, background: 'var(--bg)', border: '1px solid var(--hairline)', borderRadius: 8, overflow: 'hidden' }

/** An embedded Claude Code session with the status strip. */
export const Default = () => (
  <div style={frame}><TerminalScreen /></div>
)
