import { Stepper } from '@runcastle/design-system'

const stage = {
  background: 'var(--bg)',
  padding: '24px',
  borderRadius: 8,
  minWidth: 220,
}

/** A feature moving through its lifecycle — the current step gets a violet halo. */
export const Lifecycle = () => (
  <div style={stage}>
    <Stepper
      steps={[
        { label: 'Ideation', state: 'done' },
        { label: 'Spec', state: 'done' },
        { label: 'Tickets', state: 'current' },
        { label: 'Implementation', state: 'todo' },
        { label: 'Review', state: 'todo' },
        { label: 'Shipped', state: 'todo' },
      ]}
    />
  </div>
)

/** A skipped step strikes through. */
export const WithSkips = () => (
  <div style={stage}>
    <Stepper
      steps={[
        { label: 'Ideation', state: 'done' },
        { label: 'Spec', state: 'skipped' },
        { label: 'Tickets', state: 'done' },
        { label: 'Implementation', state: 'current' },
        { label: 'Review', state: 'todo' },
      ]}
    />
  </div>
)
