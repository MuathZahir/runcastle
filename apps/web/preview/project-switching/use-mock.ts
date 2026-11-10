import { useMemo, useState } from 'react'
import { projectsFor, type MockProject, type SampleKey } from './data'

/**
 * The mock's own switching: which project is in front. Nothing leaves the
 * page; a pick only changes this state. The order is the sample's, fixed.
 */
export function useMockProjects(sample: SampleKey, start: 'first' | 'none') {
  const projects: MockProject[] = useMemo(() => projectsFor(sample), [sample])
  const [currentId, setCurrentId] = useState<string | null>(start === 'first' ? projects[0]!.id : null)
  const current = currentId ? (projects.find((p) => p.id === currentId) ?? null) : null
  return { projects, current, currentId, pick: setCurrentId }
}
