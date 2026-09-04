import { useState } from 'react'
import { trpc } from '../../trpc'
import { readyRuntimes, RUNTIME_LOGIN, type RuntimeReadiness } from '../../lib/first-run'
import { useToast } from '../../lib/toast'
import { Button, DimLine } from '../../ui'
import { Checklist, ChecklistRow, RowTerminal } from '../EnableAfkCard'
import { StepActions, StepHeading } from './StepLayout'

/**
 * Both providers as peers (decision 6). Each card says what was detected, offers
 * that runtime's own sign-in, and states what it unlocks; the operator auths
 * whichever they have or want. The step continues once ONE runtime can open a
 * session — that is the invariant the pipeline actually needs.
 *
 * The rows are the Enable-AFK card's own checklist primitives: the two surfaces
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
        runcastle drives whichever agent you have — sign in to one or both. Sessions run on the
        agent the model you pick belongs to, so the ones you connect here are the ones you can
        choose from later.
      </StepHeading>

      <div className="mt-7">
        <Checklist>
          {runtimes.map((r) => (
            <RuntimeCard key={r.runtime} runtime={r} />
          ))}
        </Checklist>
      </div>

      <StepActions onBack={onBack}>
        <Button variant="solid" onClick={onNext} disabled={ready.length === 0}>
          Continue
        </Button>
      </StepActions>
      {ready.length === 0 && (
        <DimLine>
          Connect at least one agent to continue — runcastle has nothing to run without one.
        </DimLine>
      )}
    </>
  )
}

/** One provider row: detected state, its sign-in flow, and what AFK adds. */
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
