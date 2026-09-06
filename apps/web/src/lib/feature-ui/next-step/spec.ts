import { hasResumable } from '../internal'
import type { ResolverInput } from './resolver-input'
import type { NextStep } from './types'

export function resolveSpec(input: ResolverInput): NextStep {
  const { full, live, lapTicketCount } = input
  if (live) return step('SESSION LIVE', 'Writing the spec', 'The spec takes shape on the left as the session writes it. The session moves the feature on to tickets when it is done.')
  const hasSpec = (full.docs ?? []).some((doc) => doc.relPath.endsWith('spec.md'))
  if (full.feature.mapped && !hasSpec && lapTicketCount === 0) return step('NEXT STEP', 'Finish converging', 'The converge session ended before the spec and tickets were written. Resume it — it picks up from the map and the decisions.', { label: 'Resume converge', kind: 'resumeConverge' })
  const resumable = hasResumable(full.sessions, 'ideation') || hasResumable(full.sessions, 'converge')
  const door: NextStep['primary'] = { label: resumable ? 'Resume session' : 'Start session', kind: 'startGrill' }
  // The bar's description is the one place that says why the feature cannot
  // advance (decision 3), so it has to read the same disk the pane beside it
  // renders: with spec.md written, "no spec yet" contradicts the document the
  // human is looking at. What is left undone is the next phase's work, and the
  // session is still the only door to it (decision 8 removed the approve verb).
  if (hasSpec) return step('NEXT STEP', 'Break the spec into tickets', `The spec is written — it is on the left. ${resumable ? 'Resume the session' : 'Start a session'}: the agent reads it back, emits a ticket per slice of work, and moves the feature on to tickets itself.`, door)
  return step('NEXT STEP', 'Write the spec', `No spec yet — ${resumable ? 'resume the session' : 'start a session'} to draft it.`, door)
}

function step(kick: string, title: string, desc: string, primary?: NextStep['primary']): NextStep {
  return { kick, title, desc, primary, secondary: [], busy: false }
}
