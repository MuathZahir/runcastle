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
  if (phase === 'ideation' && mapped) return { kind: 'map' }

  const kind = phase === 'spec' ? 'spec' : 'decisions'
  const relPath = docs.find((doc) => doc.relPath.endsWith(`${kind}.md`))?.relPath
  return relPath ? { kind, relPath } : { kind }
}

export function countDecisions(markdown: string): number {
  return markdown.split(/\r?\n/).filter((line) => line.startsWith('## ')).length
}
