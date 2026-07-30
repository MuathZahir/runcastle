import { useState } from 'react'
import { trpc } from '../trpc'
import { PHASE_LABELS, PHASE_ORDER } from '../lib/feature-ui'
import {
  firstSetupStep,
  wizardSteps,
  type SetupStep,
  type WizardScreen,
  type WizardStepRow,
} from '../lib/first-run'
import { useToast } from '../lib/toast'
import { AFK_BURN_EXPLAINER } from '../lib/vocabulary'
import { Button, DimLine } from '../ui'
import { IconCheck, LogoMark } from '../icons'
import { EnableAfkCard } from './EnableAfkCard'
import { OpenProject } from './OpenProject'

/**
 * First-run wizard (issue #50). Shown only when the projects table is empty; it
 * never re-appears once a project exists (the shell drops straight into a
 * project after that). It opens on an intro screen — a first-time user meets
 * "AFK burns" before anything has told them what runcastle does (finding F13) —
 * then walks the setup steps. The only *hard* step is the git-identity form:
 * commits (docs, merges) fail late without it, so we collect it up front and
 * write it to `git config --global`. AFK setup is a single non-blocking card the
 * user can act on or skip. The wizard terminates in "Open your first project",
 * straight into the pipeline UI.
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
  const [screen, setScreen] = useState<WizardScreen>('intro')

  if (doctor.isLoading) {
    return (
      <div className="open-project">
        <DimLine>preparing setup…</DimLine>
      </div>
    )
  }

  if (screen === 'project') {
    return <OpenProject firstRun onOpened={onOpened} onCancel={onCancel} />
  }

  return (
    <div className="open-project">
      <div className="op-card wizard-card">
        <div className="op-logo">
          <LogoMark size={22} variant="ink" />
        </div>
        {screen === 'intro' ? (
          <IntroStep onNext={() => setScreen(firstSetupStep(identity))} />
        ) : (
          <SetupScreen
            step={screen}
            steps={wizardSteps(screen, identity)}
            onNext={() => setScreen(screen === 'identity' ? 'afk' : 'project')}
          />
        )}
      </div>
    </div>
  )
}

function SetupScreen({
  step,
  steps,
  onNext,
}: {
  step: SetupStep
  steps: WizardStepRow[]
  onNext: () => void
}) {
  return (
    <>
      <WizardSteps steps={steps} />
      {steps
        .filter((s) => s.state === 'passed')
        .map((s) => (
          <div key={s.key} className="wizard-passed">
            <IconCheck size={12} />
            <span>
              {s.label} — {s.detected}
            </span>
          </div>
        ))}
      {step === 'identity' ? <IdentityStep onNext={onNext} /> : <AfkStep onNext={onNext} />}
    </>
  )
}

function WizardSteps({ steps }: { steps: WizardStepRow[] }) {
  return (
    <ol className="wizard-steps" aria-label="Setup progress">
      {steps.map((s) => (
        <li key={s.key} className={`wizard-step is-${s.state}`} title={s.detected}>
          {s.state === 'passed' ? (
            <IconCheck size={11} />
          ) : (
            <span className="wizard-step-dot" aria-hidden />
          )}
          {s.label}
        </li>
      ))}
    </ol>
  )
}

/**
 * The screen that was missing: what this app is, before the first setting. Names
 * the pipeline from the same labels the workspace rail uses, so the phases the
 * user is about to see are the phases they just read about.
 */
function IntroStep({ onNext }: { onNext: () => void }) {
  const pipeline = PHASE_ORDER.map((p) => PHASE_LABELS[p]).join(' → ')
  return (
    <>
      <div className="op-kick">WELCOME TO RUNCASTLE</div>
      <div className="op-h">Claude Code, driven through a pipeline</div>
      <div className="op-sub">
        Describe a feature and runcastle runs the Claude Code sessions that carry it from idea to
        merged — <span className="mono">{pipeline}</span> — keeping the decisions, spec, tickets and
        commits together on the feature's own branch.
      </div>
      <div className="op-sub">
        You are the one who says go. runcastle stops at gates and waits for you there: <b>Burn</b> to
        turn the tickets you have read into commits, <b>Merge</b> once you have taken the branch for
        a test drive.
      </div>
      <div className="op-actions">
        <Button variant="solid" onClick={onNext} autoFocus>
          Set up runcastle →
        </Button>
      </div>
    </>
  )
}

function IdentityStep({ onNext }: { onNext: () => void }) {
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const toast = useToast()
  const utils = trpc.useUtils()

  const write = trpc.setup.gitIdentity.useMutation({
    onSuccess: async () => {
      await utils.setup.doctor.invalidate()
      onNext()
    },
    onError: (e) => toast.push(e.message),
  })

  const valid = name.trim() !== '' && email.includes('@')
  const submit = () => valid && write.mutate({ name: name.trim(), email: email.trim() })

  return (
    <>
      <div className="op-kick">WELCOME TO RUNCASTLE</div>
      <div className="op-h">Set your git identity</div>
      <div className="op-sub">
        runcastle commits documentation and merges on your behalf, so it needs a
        name and email. This writes to <code className="mono">git config --global</code>.
      </div>

      <label className="op-label" htmlFor="wiz-name">
        Name
      </label>
      <input
        id="wiz-name"
        className="op-input mono"
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Ada Lovelace"
        autoFocus
        spellCheck={false}
        onKeyDown={(e) => e.key === 'Enter' && submit()}
      />
      <label className="op-label" htmlFor="wiz-email">
        Email
      </label>
      <input
        id="wiz-email"
        className="op-input mono"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder="ada@example.com"
        spellCheck={false}
        onKeyDown={(e) => e.key === 'Enter' && submit()}
      />

      <div className="op-actions">
        <Button variant="solid" onClick={submit} disabled={!valid || write.isPending}>
          {write.isPending ? 'Saving…' : 'Continue'}
        </Button>
      </div>
    </>
  )
}

function AfkStep({ onNext }: { onNext: () => void }) {
  return (
    <>
      {/* The card itself opens on "ENABLE AFK BURNS" — three unexplained letters
          at the first thing a new user is asked to set up (F13/F16). */}
      <div className="op-sub">
        {AFK_BURN_EXPLAINER} It is optional — skip it and burns run in a terminal you watch.
      </div>
      <EnableAfkCard onDismiss={onNext} />
      <div className="op-actions">
        <Button variant="solid" onClick={onNext}>
          Continue to your first project
        </Button>
      </div>
    </>
  )
}
