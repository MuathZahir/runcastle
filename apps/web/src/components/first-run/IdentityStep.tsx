import { useState } from 'react'
import { trpc } from '../../trpc'
import { useToast } from '../../lib/toast'
import { Button, Field, TEXT_INPUT } from '../../ui'
import { StepActions, StepHeading } from './StepLayout'

/**
 * The first hard step: runcastle commits documentation and merges on the user's
 * behalf, so it collects an identity up front rather than letting a commit fail
 * late inside a session. Shown only when the host has none — {@link
 * firstSetupStep} passes over it otherwise, and the rail says so.
 */
export function IdentityStep({ onBack, onNext }: { onBack: () => void; onNext: () => void }) {
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
  const onKeyDown = (e: React.KeyboardEvent) => e.key === 'Enter' && submit()

  return (
    <>
      <StepHeading title="Set your git identity">
        runcastle commits documentation and merges on your behalf, so it needs a name and email.
        This writes to <code className="font-mono text-text">git config --global</code>.
      </StepHeading>

      <div className="mt-7 flex flex-col gap-4">
        <Field label="Name">
          <input
            id="wiz-name"
            className={TEXT_INPUT}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Ada Lovelace"
            autoFocus
            spellCheck={false}
            onKeyDown={onKeyDown}
          />
        </Field>
        <Field label="Email">
          <input
            id="wiz-email"
            className={TEXT_INPUT}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="ada@example.com"
            spellCheck={false}
            onKeyDown={onKeyDown}
          />
        </Field>
      </div>

      <StepActions onBack={onBack}>
        <Button variant="solid" onClick={submit} disabled={!valid || write.isPending}>
          {write.isPending ? 'Saving…' : 'Continue'}
        </Button>
      </StepActions>
    </>
  )
}
