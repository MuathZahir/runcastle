import { GhostLink } from '@runcastle/design-system'

const stage = {
  background: 'var(--bg)',
  padding: '24px',
  borderRadius: 8,
  display: 'flex',
  flexWrap: 'wrap',
  gap: 16,
  alignItems: 'center',
  fontFamily: 'var(--sans)',
}

/** Borderless secondary text actions — hover lifts to violet. */
export const Default = () => (
  <div style={stage}>
    <GhostLink>View diff</GhostLink>
    <GhostLink>Open in editor</GhostLink>
    <GhostLink>Copy branch</GhostLink>
  </div>
)

/** A disabled link dims to 40%. */
export const Disabled = () => (
  <div style={stage}>
    <GhostLink>View diff</GhostLink>
    <GhostLink disabled>Open in editor</GhostLink>
  </div>
)
