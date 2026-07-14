import { SectionTitle, DimLine } from '@runcastle/design-system'

const stage = {
  background: 'var(--bg)',
  padding: '24px',
  borderRadius: 8,
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
  alignItems: 'flex-start',
  fontFamily: 'var(--sans)',
  minWidth: 220,
}

/** The 11px uppercase, tracked heading on its own. */
export const Default = () => (
  <div style={stage}>
    <SectionTitle>Active features</SectionTitle>
  </div>
)

/** Heading a small group — its real job in a sidebar pane. */
export const WithItems = () => (
  <div style={stage}>
    <SectionTitle>Documents</SectionTitle>
    <DimLine>SPEC.md</DimLine>
    <DimLine>PRD.md</DimLine>
    <DimLine>RESEARCH.md</DimLine>
  </div>
)
