import { useState } from 'react'
import { trpc } from '../trpc'
import { useToast } from '../lib/toast'
import { Button, DimLine } from '../ui'
import { LogoMark } from '../icons'
import { EnableAfkCard } from './EnableAfkCard'
import { OpenProject } from './OpenProject'

/**
 * First-run wizard (issue #50). Shown only when the projects table is empty; it
 * never re-appears once a project exists (the shell drops straight into a
 * project after that). Linear, and the only *hard* step is the git-identity form
 * — commits (docs, merges) fail late without it, so we collect it up front and
 * write it to `git config --global`. AFK setup is a single non-blocking card the
 * user can act on or skip. The wizard terminates in "Open your first project",
 * straight into the pipeline UI.
 */
type Step = 'identity' | 'afk' | 'project'

export function FirstRunWizard({
  onOpened,
  onCancel,
}: {
  onOpened: (projectId: string) => void
  onCancel: () => void
}) {
  // If git identity is already configured on this host, the hard step is a no-op
  // — start past it. (undefined while the probe is in flight.)
  const doctor = trpc.setup.doctor.useQuery(undefined, { refetchOnWindowFocus: false })
  const gitOk = doctor.data?.results.find((r) => r.id === 'git-identity')?.status === 'ok'
  const [step, setStep] = useState<Step | null>(null)
  const current: Step = step ?? (gitOk ? 'afk' : 'identity')

  if (doctor.isLoading) {
    return (
      <div className="open-project">
        <DimLine>preparing setup…</DimLine>
      </div>
    )
  }

  if (current === 'project') {
    return <OpenProject firstRun onOpened={onOpened} onCancel={onCancel} />
  }

  return (
    <div className="open-project">
      <div className="op-card wizard-card">
        <div className="op-logo">
          <LogoMark size={22} variant="ink" />
        </div>
        <WizardSteps current={current} />
        {current === 'identity' ? (
          <IdentityStep onNext={() => setStep('afk')} />
        ) : (
          <AfkStep onNext={() => setStep('project')} />
        )}
      </div>
    </div>
  )
}

const ORDER: { key: Step; label: string }[] = [
  { key: 'identity', label: 'Git identity' },
  { key: 'afk', label: 'AFK burns' },
  { key: 'project', label: 'First project' },
]

function WizardSteps({ current }: { current: Step }) {
  const idx = ORDER.findIndex((s) => s.key === current)
  return (
    <ol className="wizard-steps" aria-label="Setup progress">
      {ORDER.map((s, i) => (
        <li
          key={s.key}
          className={`wizard-step${i === idx ? ' is-current' : ''}${i < idx ? ' is-done' : ''}`}
        >
          <span className="wizard-step-dot" aria-hidden />
          {s.label}
        </li>
      ))}
    </ol>
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
      <EnableAfkCard onDismiss={onNext} />
      <div className="op-actions">
        <Button variant="solid" onClick={onNext}>
          Continue to your first project
        </Button>
      </div>
    </>
  )
}
