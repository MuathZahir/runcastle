import { DimLine } from '@runcastle/design-system'

const stage = {
  background: 'var(--bg)',
  padding: '24px',
  borderRadius: 8,
  display: 'flex',
  flexDirection: 'column',
  gap: 4,
  alignItems: 'flex-start',
  minWidth: 300,
}

/** The single empty-state style. */
export const EmptyState = () => (
  <div style={stage}>
    <DimLine>no feature selected</DimLine>
  </div>
)

/** Quiet mono metadata — branches, paths, commit hashes. */
export const Metadata = () => (
  <div style={stage}>
    <DimLine>fix/ship-path-bugs · 3 commits</DimLine>
    <DimLine>packages/server/src/services/git.ts</DimLine>
    <DimLine>33c5fa4</DimLine>
  </div>
)
