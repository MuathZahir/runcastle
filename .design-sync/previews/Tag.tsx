import { Tag } from '@runcastle/design-system'

const stage = {
  background: 'var(--bg)',
  padding: '24px',
  borderRadius: 8,
  display: 'flex',
  flexWrap: 'wrap',
  gap: 14,
  alignItems: 'center',
}

/** The full lifecycle phase palette — the system's semantic colour spine. */
export const Phases = () => (
  <div style={stage}>
    <Tag tone="ideation">ideation</Tag>
    <Tag tone="spec">spec</Tag>
    <Tag tone="tickets">tickets</Tag>
    <Tag tone="implementation">implementation</Tag>
    <Tag tone="review">review</Tag>
    <Tag tone="shipped">shipped</Tag>
  </div>
)

/** No tone → neutral secondary text. */
export const Neutral = () => (
  <div style={stage}>
    <Tag>draft</Tag>
  </div>
)
