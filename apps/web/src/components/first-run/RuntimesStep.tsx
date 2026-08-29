import { useState } from 'react'
import { trpc } from '../../trpc'
import { readyRuntimes, RUNTIME_LOGIN, type RuntimeReadiness } from '../../lib/first-run'
import { useToast } from '../../lib/toast'
import { Button, DimLine } from '../../ui'
import { ErrorBoundary } from '../ErrorBoundary'
import { TerminalView } from '../TerminalView'
import { StepActions, StepHeading } from './StepLayout'

/**
 * Both providers as peers (decision 6). Each card says what was detected, offers
 * that runtime's own sign-in, and states what it unlocks; the operator auths
 * whichever they have or want. The step continues once ONE runtime can open a
 * session — that is the invariant the pipeline actually needs.
 *
 * The rows keep their `afk-*` class names: they are the Enable-AFK card's rows,
 * whose stylesheet rules the Settings flow still owns (decision 9), and the two
 * surfaces genuinely do render the same row.
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

      <div className="afk-rows mt-7">
        {runtimes.map((r) => (
          <RuntimeCard key={r.runtime} runtime={r} />
        ))}
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
    <div className={`afk-row${runtime.talkReady ? ' is-ok' : ''}`}>
      <div className="afk-row-head">
        <span className={`afk-dot afk-dot-${runtime.talkReady ? 'ok' : 'warn'}`} aria-hidden />
        <div className="afk-row-text">
          <div className="afk-row-label">
            {runtime.label} — {state}
          </div>
          <div className="afk-row-detail mono">{runtime.detail}</div>
        </div>
      </div>
      <div className="afk-row-action">
        {runtime.installFix && (
          <div className="afk-cmd">
            <code className="afk-cmd-text mono">{runtime.installFix}</code>
            <Button
              variant="ghost"
              onClick={() => {
                void navigator.clipboard?.writeText(runtime.installFix ?? '')
                toast.push('copied', 'info')
              }}
            >
              Copy
            </Button>
          </div>
        )}
        {runtime.installed &&
          !runtime.talkReady &&
          (sessionId ? (
            <>
              <div className="afk-term">
                <ErrorBoundary label={login.kind}>
                  <TerminalView sessionId={sessionId} />
                </ErrorBoundary>
              </div>
              <div className="afk-term-actions">
                <Button
                  variant="solid"
                  onClick={() => {
                    setSessionId(null)
                    void utils.setup.doctor.invalidate()
                  }}
                >
                  Done — re-check
                </Button>
              </div>
            </>
          ) : (
            <Button
              variant="solid"
              disabled={start.isPending}
              onClick={() => start.mutate({ kind: login.kind })}
            >
              {start.isPending ? 'Starting…' : `Run ${login.command}`}
            </Button>
          ))}
        {runtime.talkReady && !runtime.afkReady && (
          <div className="afk-note">
            Signed in for sessions you watch. Unattended burns on {runtime.label} also need its key
            — the next step sets that up.
          </div>
        )}
      </div>
    </div>
  )
}
