import { useState } from 'react'
import { PHASE_ORDER, PHASE_TIP } from '../../lib/feature-ui'
import { IconArrowRight, LogoMark, PHASE_NAME, PhaseIcon } from '../../icons'
import { AccentTile } from '../SidebarParts'
import { USAGE_PING_SENDS } from '../../lib/settings'
import { trpc } from '../../trpc'
import { Button, Checkbox } from '../../ui'
import { StepActions, StepHeading } from './StepLayout'

/**
 * The screen that was missing: what this app is, before the first setting
 * (finding F13). Names the pipeline with the same glyphs and names the feature
 * pages use, so the phases the user is about to see are the phases they just
 * read about.
 *
 * The one screen with no Back and no rail — there is nothing behind it, and
 * setup has not started. It has a little more presence than a step — the mark
 * in the accent tile the Orchestrator's empty chat opens on, the same first
 * moment — and nothing else.
 */
export function IntroStep({ onNext }: { onNext: () => void }) {
  const usage = useUsagePingAnswer()
  const next = () => {
    usage.record()
    onNext()
  }
  return (
    <>
      <AccentTile large className="mb-6">
        <LogoMark size={26} />
      </AccentTile>
      <StepHeading title="Your coding agent, driven through a pipeline">
        Describe a feature and runcastle runs the agents that carry it from idea to merged.
        You test-drive the result and decide when it ships.
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
      <div className="mt-8 flex flex-col gap-1">
        <Checkbox
          size="md"
          label="Send the usage ping"
          checked={usage.checked}
          disabled={usage.locked}
          onChange={usage.set}
        />
        <p className="m-0 pl-5.5 text-xs text-text-tertiary">
          Once per boot, so we know runcastle is used. {USAGE_PING_SENDS} Turn it off here or in
          Settings at any time.
        </p>
      </div>
      <StepActions>
        <Button variant="primary" icon={<IconArrowRight />} onClick={next} autoFocus>
          Set up runcastle
        </Button>
      </StepActions>
    </>
  )
}

/**
 * The intro's usage-ping answer (decision 4). Ticked by default, or showing the
 * current setting when the wizard is replayed; leaving the step forward writes
 * `usageSignal`, which is what lets a fresh install ping at all. An env-locked
 * setting is shown as it stands and never written.
 */
function useUsagePingAnswer() {
  const globals = trpc.settings.get.useQuery()
  const update = trpc.settings.update.useMutation()
  const field = globals.data?.fields.find((f) => f.key === 'usageSignal')
  // `null` until the box is touched, so a setting that loads late still shows.
  const [touched, setTouched] = useState<boolean | null>(null)
  const checked = touched ?? field?.value !== 'off'
  const locked = field !== undefined && !field.editable
  return {
    checked,
    locked,
    set: setTouched,
    record: () => {
      if (!locked) update.mutate({ key: 'usageSignal', value: checked ? 'on' : 'off' })
    },
  }
}
