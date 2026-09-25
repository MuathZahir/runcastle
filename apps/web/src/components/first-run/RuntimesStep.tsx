import { useState } from 'react'
import { trpc } from '../../trpc'
import { readyRuntimes, RUNTIME_LOGIN, type RuntimeReadiness } from '../../lib/first-run'
import { useToast } from '../../lib/toast'
import { IconArrowRight, IconTerminal } from '../../icons'
import { Button } from '../../ui'
import { Checklist, ChecklistRow, CommandLine, RowTerminal } from '../EnableAfkCard'
import { StepActions, StepHeading } from './StepLayout'

/**
 * Both providers as peers (decision 6). Each row says what was detected, offers
 * that runtime's own sign-in, and states what it unlocks; the operator auths
 * whichever they have or want. The step continues once ONE runtime can open a
 * session — that is the invariant the pipeline actually needs.
 *
 * The rows are the Enable-AFK checklist's own primitives: the two surfaces
 * genuinely do render the same row, and the Settings flow owns the shared
 * component (decision 9).
 */
export function RuntimesStep({
  runtimes,
  onBack,
  onNext,
}: {
  runtimes: RuntimeReadiness[]
  onBack: () => void
  onNext: () => void
}) {
  const ready = readyRuntimes(runtimes)
  return (
    <>
      <StepHeading title="Connect a coding agent">
        runcastle drives whichever agent you have — sign in to one or both. The ones you connect
        here are the ones whose models you can pick later.
      </StepHeading>

      <div className="mt-8">
        <Checklist>
          {runtimes.map((r) => (
            <RuntimeRow key={r.runtime} runtime={r} />
          ))}
        </Checklist>
      </div>

      <StepActions
        onBack={onBack}
        note={
          ready.length === 0 &&
          'Connect at least one agent to continue — runcastle has nothing to run without one.'
        }
      >
        <Button
          variant="primary"
          icon={<IconArrowRight />}
          onClick={onNext}
          disabled={ready.length === 0}
        >
          Continue
        </Button>
      </StepActions>
    </>
  )
}

/** One provider row: detected state, its sign-in flow, and what AFK adds. */
function RuntimeRow({ runtime }: { runtime: RuntimeReadiness }) {
  const [sessionId, setSessionId] = useState<string | null>(null)
  const toast = useToast()
  const utils = trpc.useUtils()
  const start = trpc.setup.startTerminal.useMutation({
    onSuccess: ({ sessionId }) => setSessionId(sessionId),
    onError: (e) => toast.push(e.message),
  })
  const login = RUNTIME_LOGIN[runtime.runtime]

  const status = runtime.talkReady ? 'Ready' : runtime.installed ? 'Not signed in' : 'Not installed'

  return (
    <ChecklistRow
      label={runtime.label}
      status={status}
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
        <CommandLine
          command={runtime.installFix}
          onCopy={() => {
            void navigator.clipboard?.writeText(runtime.installFix ?? '')
            toast.push('copied', 'info')
          }}
        />
      )}
      {/* Secondary, not primary: the step's one primary is Continue. */}
      {runtime.installed && !runtime.talkReady && !sessionId && (
        <Button
          size="sm"
          icon={<IconTerminal />}
          loading={start.isPending}
          onClick={() => start.mutate({ kind: login.kind })}
        >
          Run {login.command}
        </Button>
      )}
      {runtime.talkReady && !runtime.afkReady && (
        <span className="basis-full text-right text-xs text-text-tertiary">
          Signed in for sessions you watch. Unattended burns on {runtime.label} also need its key —
          the next step sets that up.
        </span>
      )}
    </ChecklistRow>
  )
}
