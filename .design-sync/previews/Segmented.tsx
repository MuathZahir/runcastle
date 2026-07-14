import { Segmented } from '@runcastle/design-system'

const stage = {
  background: 'var(--bg)',
  padding: '24px',
  borderRadius: 8,
  display: 'flex',
  flexDirection: 'column',
  gap: 14,
  alignItems: 'flex-start',
  fontFamily: 'var(--sans)',
}

/** A size switch — the active segment fills violet. */
export const Sizes = () => (
  <div style={stage}>
    <Segmented
      aria-label="size"
      value="md"
      options={[
        { label: 'sm', value: 'sm' },
        { label: 'md', value: 'md' },
        { label: 'lg', value: 'lg' },
      ]}
    />
  </div>
)

/** A two-way mode switch. */
export const Mode = () => (
  <div style={stage}>
    <Segmented
      aria-label="view"
      value="board"
      options={[
        { label: 'list', value: 'list' },
        { label: 'board', value: 'board' },
      ]}
    />
  </div>
)
