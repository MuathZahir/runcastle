import { Chip } from '@runcastle/design-system'

const stage = {
  background: 'var(--bg)',
  padding: '24px',
  borderRadius: 8,
  display: 'flex',
  flexWrap: 'wrap',
  gap: 10,
  alignItems: 'center',
}

/** Every status tone — colour plus (for `active`) a pulse carries the state. */
export const Tones = () => (
  <div style={stage}>
    <Chip tone="neutral">queued</Chip>
    <Chip tone="pending">pending</Chip>
    <Chip tone="active" pulse>burning</Chip>
    <Chip tone="done">done</Chip>
    <Chip tone="failed">failed</Chip>
    <Chip tone="blocked">blocked</Chip>
  </div>
)

/** Chips as compact counts. */
export const Counts = () => (
  <div style={stage}>
    <Chip tone="done">5 passed</Chip>
    <Chip tone="failed">1 failed</Chip>
    <Chip tone="pending">2 queued</Chip>
  </div>
)
