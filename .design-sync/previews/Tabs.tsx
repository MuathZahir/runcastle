import { Tabs } from '@runcastle/design-system'

const stage = {
  background: 'var(--bg)',
  padding: '24px',
  borderRadius: 8,
  width: 520,
}

/** A typed tab strip — glyph, mono slug, dim type suffix; one active (violet rule). */
export const Typed = () => (
  <div style={stage}>
    <Tabs
      activeId="t2"
      tabs={[
        { id: 't1', label: 'auth-flow', type: 'overview', icon: '▤' },
        { id: 't2', label: 'auth-flow', type: 'term', icon: '▸_' },
        { id: 't3', label: 'ship-bugs', type: 'tickets', icon: '☰' },
      ]}
    />
  </div>
)

/** With `onClose`, each tab shows a ✕ affordance. */
export const Closable = () => (
  <div style={stage}>
    <Tabs
      activeId="t1"
      onClose={() => {}}
      tabs={[
        { id: 't1', label: 'auth-flow', type: 'run', icon: '⚙' },
        { id: 't2', label: 'ship-bugs', type: 'overview', icon: '▤' },
      ]}
    />
  </div>
)
