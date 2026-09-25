import { PHASE_ORDER, PHASE_TIP } from '../../lib/feature-ui'
import { IconArrowRight, LogoMark, PHASE_NAME, PhaseIcon } from '../../icons'
import { Button } from '../../ui'
import { StepActions, StepHeading } from './StepLayout'

/**
 * The screen that was missing: what this app is, before the first setting
 * (finding F13). Names the pipeline with the same glyphs and names the feature
 * pages use, so the phases the user is about to see are the phases they just
 * read about.
 *
 * The one screen with no Back and no rail — there is nothing behind it, and
 * setup has not started. It has a little more presence than a step (the mark,
 * a slightly larger lead) and nothing else.
 */
export function IntroStep({ onNext }: { onNext: () => void }) {
  return (
    <>
      <LogoMark size={32} variant="solid" className="mb-6" />
      <StepHeading title="Your coding agent, driven through a pipeline">
        Describe a feature and runcastle runs the agent sessions that carry it from idea to merged,
        stopping at each gate until you say go.
      </StepHeading>
      <ol className="m-0 mt-8 flex list-none flex-col p-0">
        {PHASE_ORDER.map((phase, i) => (
          <li
            key={phase}
            className="grid grid-cols-[16px_96px_minmax(0,1fr)] items-center gap-3 border-b border-border-subtle py-2.5 text-sm last:border-b-0 animate-rise-in"
            style={{ animationDelay: `${120 + i * 40}ms` }}
          >
            <PhaseIcon phase={phase} size={16} label="" />
            <span className="font-medium text-text">{PHASE_NAME[phase]}</span>
            <span className="text-text-tertiary">{PHASE_TIP[phase]}</span>
          </li>
        ))}
      </ol>
      <StepActions>
        <Button variant="primary" icon={<IconArrowRight />} onClick={onNext} autoFocus>
          Set up runcastle
        </Button>
      </StepActions>
    </>
  )
}
