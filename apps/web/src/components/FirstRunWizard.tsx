import { useState } from 'react'
import { trpc } from '../trpc'
import { PHASE_LABELS, PHASE_ORDER } from '../lib/feature-ui'
import {
  firstSetupStep,
  nextSetupStep,
  readyRuntimes,
  runtimeReadiness,
  RUNTIME_LOGIN,
  wizardSteps,
  type RuntimeReadiness,
  type SetupStep,
  type WizardScreen,
  type WizardStepRow,
} from '../lib/first-run'
import { useToast } from '../lib/toast'
import { AFK_BURN_EXPLAINER } from '../lib/vocabulary'
import { Button, DimLine } from '../ui'
import { IconCheck, LogoMark } from '../icons'
import { Checklist, ChecklistRow, EnableAfkCard, RowTerminal } from './EnableAfkCard'
import { OpenProject } from './OpenProject'

/**
 * First-run wizard (issue #50). Shown only when the projects table is empty; it
 * never re-appears once a project exists (the shell drops straight into a
 * project after that). It opens on an intro screen — a first-time user meets
 * "AFK burns" before anything has told them what runcastle does (finding F13) —
 * then walks the setup steps. Two *hard* steps: the git-identity form (commits
 * fail late without it, so we collect it up front and write it to `git config
 * --global`) and a coding agent — runcastle needs at least one runtime that can
 * open a session, though never a particular vendor's (decision 6). AFK setup is
 * a single non-blocking card the user can act on or skip. The wizard terminates
 * in "Open your first project", straight into the pipeline UI.
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
            runtimes={runtimes}
            onNext={() => {
              const next = nextSetupStep(screen)
              if (next === 'project' || next === undefined) finish()
              else setScreen(next)
            }}
          />
        )}
      </div>
    </div>
  )
}

function SetupScreen({
  step,
  steps,
  runtimes,
  onNext,
}: {
  step: SetupStep
  steps: WizardStepRow[]
  runtimes: RuntimeReadiness[]
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
      {step === 'identity' && <IdentityStep onNext={onNext} />}
      {step === 'runtimes' && <RuntimesStep runtimes={runtimes} onNext={onNext} />}
      {step === 'afk' && <AfkStep onNext={onNext} />}
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
      <div className="op-h">Your coding agent, driven through a pipeline</div>
      <div className="op-sub">
        Describe a feature and runcastle runs the agent sessions that carry it from idea to merged —{' '}
        <span className="mono">{pipeline}</span> — keeping the decisions, spec, tickets and commits
        together on the feature's own branch.
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

/**
 * Both providers as peers (decision 6). Each card says what was detected, offers
 * that runtime's own sign-in, and states what it unlocks; the operator auths
 * whichever they have or want. The step continues once ONE runtime can open a
 * session — that is the invariant the pipeline actually needs.
 */
function RuntimesStep({
  runtimes,
  onNext,
}: {
  runtimes: RuntimeReadiness[]
  onNext: () => void
}) {
  const ready = readyRuntimes(runtimes)
  return (
    <>
      <div className="op-kick">WELCOME TO RUNCASTLE</div>
      <div className="op-h">Connect a coding agent</div>
      <div className="op-sub">
        runcastle drives whichever agent you have — sign in to one or both. Sessions run on the agent
        the model you pick belongs to, so the ones you connect here are the ones you can choose from
        later.
      </div>

      <Checklist>
        {runtimes.map((r) => (
          <RuntimeCard key={r.runtime} runtime={r} />
        ))}
      </Checklist>

      <div className="op-actions">
        <Button variant="solid" onClick={onNext} disabled={ready.length === 0}>
          Continue
        </Button>
      </div>
      {ready.length === 0 && (
        <DimLine>Connect at least one agent to continue — runcastle has nothing to run without one.</DimLine>
      )}
    </>
  )
}

/** One provider card: detected state, its sign-in flow, and what AFK adds. */
function RuntimeCard({ runtime }: { runtime: RuntimeReadiness }) {
  const [sessionId, setSessionId] = useState<string | null>(null)
  const toast = useToast()
  const utils = trpc.useUtils()
  const start = trpc.setup.startTerminal.useMutation({
    onSuccess: ({ sessionId }) => setSessionId(sessionId),
    onError: (e) => toast.push(e.message),
  })
  const login = RUNTIME_LOGIN[runtime.runtime]

  const state = runtime.talkReady ? 'ready' : runtime.installed ? 'sign in' : 'not installed'

  return (
    <ChecklistRow
      label={`${runtime.label} — ${state}`}
      detail={runtime.detail}
      ok={runtime.talkReady}
      below={
        sessionId && (
          <RowTerminal
            sessionId={sessionId}
            label={login.kind}
            onDone={() => {
              setSessionId(null)
              void utils.setup.doctor.invalidate()
            }}
          />
        )
      }
    >
      {runtime.installFix && (
        <>
          <code className="max-w-full truncate rounded-sm border border-hairline bg-panel-inset px-2 py-1 font-mono text-xs text-accent-hi">
            {runtime.installFix}
          </code>
          <Button
            variant="ghost"
            onClick={() => {
              void navigator.clipboard?.writeText(runtime.installFix ?? '')
              toast.push('copied', 'info')
            }}
          >
            Copy
          </Button>
        </>
      )}
      {runtime.installed && !runtime.talkReady && !sessionId && (
        <Button
          variant="solid"
          disabled={start.isPending}
          onClick={() => start.mutate({ kind: login.kind })}
        >
          {start.isPending ? 'Starting…' : `Run ${login.command}`}
        </Button>
      )}
      {runtime.talkReady && !runtime.afkReady && (
        <span className="basis-full text-right text-xs text-text-3">
          Signed in for sessions you watch. Unattended burns on {runtime.label} also need its key —
          the next step sets that up.
        </span>
      )}
    </ChecklistRow>
  )
}

function AfkStep({ onNext }: { onNext: () => void }) {
  return (
    <>
      {/* The checklist itself says only what is missing, so the one sentence
          explaining what AFK burns even are belongs here — a new user meets the
          three letters at the first thing they are asked to set up (F13/F16). */}
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
