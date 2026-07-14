import { Spinner } from '@runcastle/design-system'

const stage = {
  background: 'var(--bg)',
  padding: '24px',
  borderRadius: 8,
  display: 'flex',
  flexWrap: 'wrap',
  gap: 20,
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

/** The one spinner, inline beside a busy label. */
export const Default = () => (
  <div style={stage}>
    <span style={item}><Spinner /> burning tickets…</span>
  </div>
)

/** Sized to context. */
export const Sizes = () => (
  <div style={stage}>
    <Spinner size={10} />
    <Spinner size={14} />
    <Spinner size={20} />
  </div>
)
