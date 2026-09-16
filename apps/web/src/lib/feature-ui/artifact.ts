import type { Phase } from '@runcastle/core'

export type ArtifactKind = 'map' | 'decisions' | 'spec'

export interface ArtifactDoc {
  relPath: string
}

export function artifactSelection({
  phase,
  mapped,
  docs,
}: {
  phase: Phase
  mapped: boolean
  docs: ArtifactDoc[]
}): { kind: ArtifactKind; relPath?: string } {
  if (phase === 'planning' && mapped) return { kind: 'map' }

  // `kind` names a document, not a state: planning covers both, so which one is
  // the artifact is derived from disk the way decision 2 derives everything —
  // spec.md written means the spec is what there is to show.
  const kind: ArtifactKind =
    phase === 'planning' && docs.some((doc) => doc.relPath.endsWith('spec.md'))
      ? 'spec'
      : 'decisions'
  const relPath = docs.find((doc) => doc.relPath.endsWith(`${kind}.md`))?.relPath
  return relPath ? { kind, relPath } : { kind }
}

export function countDecisions(markdown: string): number {
  return markdown.split(/\r?\n/).filter((line) => line.startsWith('## ')).length
}
