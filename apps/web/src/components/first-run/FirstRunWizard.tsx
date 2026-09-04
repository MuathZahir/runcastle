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
import { DimLine } from '../../ui'
import { LogoMark } from '../../icons'
import { OpenProject } from '../OpenProject'
import { AfkStep } from './AfkStep'
import { IdentityStep } from './IdentityStep'
import { IntroStep } from './IntroStep'
import { RuntimesStep } from './RuntimesStep'
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
 * This file owns sequencing and the frame; each step is its own file beside it.
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

  // Onboarding's last act: the global default and smoke models come from the
  // pair of a runtime the operator actually authed, so a Codex-only install
  // never lands on dead Claude defaults (decision 7).
  const seed = trpc.setup.seedModelDefaults.useMutation()
  const finish = () => {
    seed.mutate({ runtimes: readyRuntimes(runtimes) })
    setScreen('project')
  }

  if (doctor.isLoading) {
    return (
      <Frame>
        <DimLine>preparing setup…</DimLine>
      </Frame>
    )
  }

  if (screen === 'project') {
    return <OpenProject firstRun onOpened={onOpened} onCancel={onCancel} />
  }

  if (screen === 'intro') {
    return (
      <Frame>
        <IntroStep onNext={() => setScreen(firstSetupStep(identity))} />
      </Frame>
    )
  }

  const onNext = () => {
    const next = nextSetupStep(screen)
    if (next === 'project' || next === undefined) finish()
    else setScreen(next)
  }
  // No earlier step means the first step this host was shown, so Back from there
  // is Back to the intro.
  const onBack = () => setScreen(prevSetupStep(screen, identity) ?? 'intro')

  return (
    <Frame>
      <WizardRail steps={wizardSteps(screen, identity)} />
      <div className="mt-6">
        {screen === 'identity' && <IdentityStep onBack={onBack} onNext={onNext} />}
        {screen === 'runtimes' && (
          <RuntimesStep runtimes={runtimes} onBack={onBack} onNext={onNext} />
        )}
        {screen === 'afk' && <AfkStep onBack={onBack} onNext={onNext} />}
      </div>
    </Frame>
  )
}

/**
 * The column every wizard screen sits in — the same one {@link OpenProject}
 * uses, so the last step of the wizard and the screen it hands over to do not
 * jump.
 */
function Frame({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-full items-center justify-center px-6 py-10">
      <div className="w-full max-w-[560px]">
        {/* inverse treatment (logo spec): accent tile, ink mark */}
        <div className="mb-6 flex size-9 items-center justify-center rounded-md bg-accent">
          <LogoMark size={22} variant="ink" />
        </div>
        {children}
      </div>
    </div>
  )
}
