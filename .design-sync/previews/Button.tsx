import { Button } from '@runcastle/design-system'

// Dark stage — the preview card body is white, but runcastle is a near-black
// DS, so every story renders on its own --bg canvas (its real context).
const stage = {
  background: 'var(--bg)',
  padding: '24px',
  borderRadius: 8,
  display: 'flex',
  flexWrap: 'wrap',
  gap: 12,
  alignItems: 'center',
  fontFamily: 'var(--sans)',
}

/** The three weights side by side — one solid violet primary, ghosts, and a danger outline. */
export const Variants = () => (
  <div style={stage}>
    <Button variant="solid">Ship feature</Button>
    <Button variant="ghost">Run tests</Button>
    <Button variant="danger">Delete branch</Button>
  </div>
)

/** Default vs the compact `xs` height used in dense rows. */
export const Sizes = () => (
  <div style={stage}>
    <Button variant="solid">Burn tickets</Button>
    <Button variant="solid" size="xs">Burn</Button>
    <Button variant="ghost" size="xs">Skip</Button>
  </div>
)

/** Disabled controls dim to 40%. */
export const Disabled = () => (
  <div style={stage}>
    <Button variant="solid" disabled>Ship feature</Button>
    <Button variant="ghost" disabled>Run tests</Button>
  </div>
)
