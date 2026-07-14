import { Input } from '@runcastle/design-system'

const stage = {
  background: 'var(--bg)',
  padding: '24px',
  borderRadius: 8,
  display: 'flex',
  flexDirection: 'column',
  gap: 12,
  alignItems: 'flex-start',
  fontFamily: 'var(--sans)',
}

/** A text field with a placeholder and a filled value. */
export const Default = () => (
  <div style={stage}>
    <Input placeholder="feature slug…" style={{ width: 240 }} />
    <Input defaultValue="auth flow" style={{ width: 240 }} />
  </div>
)

/** `mono` renders identifiers in JetBrains Mono — for branches and paths. */
export const Mono = () => (
  <div style={stage}>
    <Input mono defaultValue="fix/ship-path-bugs" style={{ width: 240 }} />
  </div>
)

/** `invalid` switches the hairline to danger red. */
export const Invalid = () => (
  <div style={stage}>
    <Input invalid defaultValue="Bad Slug!" style={{ width: 240 }} />
  </div>
)
