import { StatusDot } from '@runcastle/design-system'

const stage = {
  background: 'var(--bg)',
  padding: '24px',
  borderRadius: 8,
  display: 'flex',
  flexWrap: 'wrap',
  gap: 18,
  alignItems: 'center',
}
const item = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 8,
  color: 'var(--text-2)',
  fontFamily: 'var(--sans)',
  fontSize: 12.5,
}

/** The health/status colour set, each labelled. */
export const Tones = () => (
  <div style={stage}>
    <span style={item}><StatusDot tone="ok" /> healthy</span>
    <span style={item}><StatusDot tone="warn" /> needs attention</span>
    <span style={item}><StatusDot tone="danger" /> down</span>
    <span style={item}><StatusDot tone="idle" /> idle</span>
  </div>
)

/** A pulsing dot signals a live/transitional state. */
export const Live = () => (
  <div style={stage}>
    <span style={item}><StatusDot tone="active" pulse /> launching session</span>
  </div>
)
