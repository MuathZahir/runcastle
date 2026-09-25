import { useState } from 'react'
import { trpc } from '../../trpc'
import {
  firstSetupStep,
  nextSetupStep,
  prevSetupStep,
  readyRuntimes,
  runtimeReadiness,
  wizardSteps,
  type WizardScreen,
} from '../../lib/first-run'
import { Spinner } from '../../ui'
import { OpenProject } from '../OpenProject'
import { AfkStep } from './AfkStep'
import { IdentityStep } from './IdentityStep'
import { IntroStep } from './IntroStep'
import { RuntimesStep } from './RuntimesStep'
import { SetupFrame } from './StepLayout'
import { WizardRail } from './WizardRail'

/**
 * First-run wizard (issue #50). Shown while setup is incomplete — no git
 * identity, or no coding agent ready to open a session (decision 3) — which is a
 * fact about the host, so closing the last project never replays it.
 *
 * It opens on an intro screen: a first-time user used to meet "AFK burns" before
 * anything had told them what runcastle does (finding F13). Then two *hard*
 * steps — the git identity (commits fail late without it) and a coding agent,
 * though never a particular vendor's (decision 6) — and one optional one. Every
 * step after the intro can go Back (decision 4). It terminates in "Open your
 * first project", straight into the pipeline UI.
 *
 * This file owns sequencing; the frame is `SetupFrame` and each step is its own
 * file beside it.
 */
export function FirstRunWizard({
  onOpened,
  onCancel,
}: {
  onOpened: (projectId: string) => void
  onCancel: () => void
}) {
  const doctor = trpc.setup.doctor.useQuery(undefined, { refetchOnWindowFocus: false })
  // If git identity is already configured on this host, its step is a no-op — but
  // it stays on the rail as a passed row saying what was found, never skipped in
  // silence. (undefined while the probe is in flight.)
  const identity = doctor.data?.results.find((r) => r.id === 'git-identity')
  const runtimes = runtimeReadiness(doctor.data?.results ?? [])
  const [screen, setScreen] = useState<WizardScreen>('intro')
  // Which way the last move went, so a step slides in going forward and rises
  // in place going back — motion that agrees with the rail.
  const [direction, setDirection] = useState<'forward' | 'back'>('forward')
  const go = (next: WizardScreen, dir: 'forward' | 'back') => {
    setDirection(dir)
    setScreen(next)
  }

  // Onboarding's last act: the global default and smoke models come from the
  // pair of a runtime the operator actually authed, so a Codex-only install
  // never lands on dead Claude defaults (decision 7).
  const seed = trpc.setup.seedModelDefaults.useMutation()
  const finish = () => {
    seed.mutate({ runtimes: readyRuntimes(runtimes) })
    go('project', 'forward')
  }

  if (doctor.isLoading) {
    return (
      <SetupFrame>
        <div className="flex items-center justify-center gap-2 text-sm text-text-tertiary">
          <Spinner /> Preparing setup…
        </div>
      </SetupFrame>
    )
  }

  if (screen === 'project') {
    return (
      <OpenProject
        firstRun
        rail={<WizardRail steps={wizardSteps('project', identity)} />}
        onOpened={onOpened}
        onCancel={onCancel}
      />
    )
  }

  if (screen === 'intro') {
    return (
      <SetupFrame stepKey="intro" direction={direction}>
        <IntroStep onNext={() => go(firstSetupStep(identity), 'forward')} />
      </SetupFrame>
    )
  }

  const onNext = () => {
    const next = nextSetupStep(screen)
    if (next === 'project' || next === undefined) finish()
    else go(next, 'forward')
  }
  // No earlier step means the first step this host was shown, so Back from there
  // is Back to the intro.
  const onBack = () => go(prevSetupStep(screen, identity) ?? 'intro', 'back')

  return (
    <SetupFrame
      rail={<WizardRail steps={wizardSteps(screen, identity)} />}
      stepKey={screen}
      direction={direction}
    >
      {screen === 'identity' && <IdentityStep onBack={onBack} onNext={onNext} />}
      {screen === 'runtimes' && (
        <RuntimesStep runtimes={runtimes} onBack={onBack} onNext={onNext} />
      )}
      {screen === 'afk' && <AfkStep onBack={onBack} onNext={onNext} />}
    </SetupFrame>
  )
}
