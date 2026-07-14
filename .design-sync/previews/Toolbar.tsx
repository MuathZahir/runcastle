import { Toolbar, Button, Chip, Spinner } from '@runcastle/design-system'

const stage = {
  background: 'var(--bg)',
  padding: '24px',
  borderRadius: 8,
  width: 480,
}
const left = { color: 'var(--text)', fontFamily: 'var(--sans)', fontSize: 12.5 }
const runInfo = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  color: 'var(--text-2)',
  fontFamily: 'var(--sans)',
  fontSize: 12,
}

/** A pane header: title and counts left, the one solid action right. */
export const WithActions = () => (
  <div style={stage}>
    <Toolbar right={<Button variant="solid" size="xs">Burn all</Button>}>
      <span style={left}>burn</span>
      <Chip tone="done">3 / 5</Chip>
    </Toolbar>
  </div>
)

/** A run header with a live spinner on the right. */
export const Running = () => (
  <div style={stage}>
    <Toolbar right={<span style={runInfo}><Spinner /> 2 runs</span>}>
      <span style={left}>run · auth-flow</span>
    </Toolbar>
  </div>
)
