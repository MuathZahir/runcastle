import { Panel, Chip, DimLine } from '@runcastle/design-system'

const stage = {
  background: 'var(--bg)',
  padding: '24px',
  borderRadius: 8,
  width: 460,
  fontFamily: 'var(--sans)',
}
const body = { color: 'var(--text-2)', fontFamily: 'var(--sans)', fontSize: 13 }
const docRow = {
  display: 'flex',
  justifyContent: 'space-between',
  padding: '7px 12px',
  borderTop: '1px solid var(--hairline-soft)',
  fontSize: 12.5,
  color: 'var(--text)',
}

/** A headed panel — title left, a status chip as the header action. */
export const Titled = () => (
  <div style={stage}>
    <Panel title="Tickets" actions={<Chip tone="active" pulse>burning</Chip>}>
      <div style={body}>5 tickets · 3 done, 1 burning, 1 blocked</div>
    </Panel>
  </div>
)

/** No header — a plain bordered surface hosting an empty state. */
export const Plain = () => (
  <div style={stage}>
    <Panel>
      <DimLine>no run in progress</DimLine>
    </Panel>
  </div>
)

/** `padded={false}` hosts edge-to-edge rows (hairline-separated). */
export const FlushList = () => (
  <div style={stage}>
    <Panel title="Documents" padded={false}>
      <div style={docRow}><span>SPEC.md</span><span style={{ color: 'var(--text-3)' }}>docs/</span></div>
      <div style={docRow}><span>PRD.md</span><span style={{ color: 'var(--text-3)' }}>docs/</span></div>
      <div style={docRow}><span>RESEARCH.md</span><span style={{ color: 'var(--text-3)' }}>docs/</span></div>
    </Panel>
  </div>
)
