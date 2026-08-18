import { useState } from 'react'
import type { AgentRuntime } from '@runcastle/core'
import { trpc } from '../trpc'
import type { RouterOutputs } from '../lib/api'
import { useToast } from '../lib/toast'
import { Button, DimLine } from '../ui'
import { ErrorBoundary } from './ErrorBoundary'
import { TerminalView } from './TerminalView'

/**
 * The "Enable AFK burns" card (issue #50). AFK (unattended sandbox) burns need
 * prerequisites the interactive path never does: a container runtime, the
 * sandcastle image, and — per runtime — an unattended credential. This card
 * makes each one actionable in place: a live re-check on the runtime, a
 * one-click image build that streams and re-probes, and a credential section per
 * agent runtime, each enabled independently of the other (decision 6).
 *
 * Everything is non-blocking: the user can act on any row now or leave it. The
 * card is rendered inside the first-run wizard and, dismissed there, stays
 * reachable from Settings — same component, `onDismiss` omitted.
 */
export function EnableAfkCard({ onDismiss }: { onDismiss?: () => void }) {
  const doctor = trpc.setup.doctor.useQuery(undefined, { refetchOnWindowFocus: false })
  const report = doctor.data

  const probe = (id: string) => report?.results.find((r) => r.id === id)
  const runtime = probe('container-runtime')
  const image = probe('sandcastle-image')
  const credentials = (report?.results ?? []).filter((r) => r.check === 'afk-key')

  const recheck = () => doctor.refetch()

  return (
    <div className="afk-card">
      <div className="afk-card-head">
        <div>
          <div className="op-kick">ENABLE AFK BURNS</div>
          <div className="afk-card-title">Run features unattended</div>
        </div>
        {onDismiss && (
          <Button variant="ghost" onClick={onDismiss}>
            Set up later
          </Button>
        )}
      </div>
      <p className="afk-card-sub">
        AFK burns run each feature to completion in a sandbox — no interactive
        session. They need a container runtime, the sandcastle image, and a key
        for each agent you want to burn with. Set them up now or anytime from
        Settings.
      </p>

      {doctor.isLoading && <DimLine>checking prerequisites…</DimLine>}
      {doctor.error && <DimLine>could not run checks: {doctor.error.message}</DimLine>}

      {report && (
        <div className="afk-rows">
          <RuntimeRow probe={runtime} onRecheck={recheck} />
          <ImageRow probe={image} runtimeOk={runtime?.status === 'ok'} onDone={recheck} />
          {credentials.map((c) => (
            <CredentialRow key={c.id} probe={c} onDone={recheck} />
          ))}
        </div>
      )}
    </div>
  )
}

type Probe = RouterOutputs['setup']['doctor']['results'][number]

/** One prerequisite row: status dot, label + observed detail, and its action slot. */
function Row({
  probe,
  children,
}: {
  probe: Probe | undefined
  children?: React.ReactNode
}) {
  if (!probe) return null
  const ok = probe.status === 'ok'
  return (
    <div className={`afk-row${ok ? ' is-ok' : ''}`}>
      <div className="afk-row-head">
        <span className={`afk-dot afk-dot-${ok ? 'ok' : 'warn'}`} aria-hidden />
        <div className="afk-row-text">
          <div className="afk-row-label">{probe.label}</div>
          <div className="afk-row-detail mono">{probe.detail}</div>
        </div>
      </div>
      {!ok && <div className="afk-row-action">{children}</div>}
    </div>
  )
}

function RuntimeRow({ probe, onRecheck }: { probe: Probe | undefined; onRecheck: () => void }) {
  const guide = trpc.setup.runtimeGuide.useQuery(undefined, {
    enabled: probe?.status === 'missing',
    refetchOnWindowFocus: false,
  })
  const toast = useToast()
  if (!probe) return null

  // The fix differs by exact failure — never conflate not-installed with a
  // present-but-unhealthy runtime (machine-stopped / daemon-dead).
  const install = probe.status === 'missing' ? guide.data : undefined
  const command = install?.command ?? probe.fix ?? ''

  return (
    <Row probe={probe}>
      {command && (
        <div className="afk-cmd">
          <code className="afk-cmd-text mono">{command}</code>
          <Button
            variant="ghost"
            onClick={() => {
              void navigator.clipboard?.writeText(command)
              toast.push('copied', 'info')
            }}
          >
            Copy
          </Button>
        </div>
      )}
      {install?.note && <div className="afk-note">{install.note}</div>}
      <Button variant="solid" onClick={onRecheck}>
        Re-check
      </Button>
    </Row>
  )
}

function ImageRow({
  probe,
  runtimeOk,
  onDone,
}: {
  probe: Probe | undefined
  runtimeOk: boolean
  onDone: () => void
}) {
  const [sessionId, setSessionId] = useState<string | null>(null)
  const toast = useToast()
  const start = trpc.setup.startTerminal.useMutation({
    onSuccess: ({ sessionId }) => setSessionId(sessionId),
    onError: (e) => toast.push(e.message),
  })
  if (!probe) return null

  return (
    <Row probe={probe}>
      {sessionId ? (
        <>
          <div className="afk-term">
            <ErrorBoundary label="build-image">
              <TerminalView sessionId={sessionId} />
            </ErrorBoundary>
          </div>
          <div className="afk-term-actions">
            <Button
              variant="solid"
              onClick={() => {
                setSessionId(null)
                onDone()
              }}
            >
              Done — re-check
            </Button>
          </div>
        </>
      ) : (
        <Button
          variant="solid"
          disabled={!runtimeOk || start.isPending}
          title={runtimeOk ? undefined : 'Install a container runtime first'}
          onClick={() => start.mutate({ kind: 'build-image' })}
        >
          {start.isPending ? 'Starting…' : 'Build image'}
        </Button>
      )}
    </Row>
  )
}

/**
 * How each runtime's unattended credential is obtained. Claude Code mints a
 * long-lived token with its own `setup-token` flow, so the card runs it in an
 * embedded terminal and takes the printed line; Codex has no such flow — its
 * unattended credential is an OpenAI API key the operator already holds, pasted
 * straight in.
 */
const AFK_CREDENTIAL: Record<
  AgentRuntime,
  { mint?: { kind: 'setup-token'; label: string }; prompt: string; placeholder: string }
> = {
  'claude-code': {
    mint: { kind: 'setup-token', label: 'Run claude setup-token' },
    prompt: 'Paste the token it prints',
    placeholder: 'sk-ant-oat01-…',
  },
  codex: {
    prompt: 'Paste an OpenAI API key (platform.openai.com/api-keys)',
    placeholder: 'sk-…',
  },
}

/** One runtime's AFK credential: mint it if the CLI can, then capture and verify. */
function CredentialRow({ probe, onDone }: { probe: Probe | undefined; onDone: () => void }) {
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [tokenText, setTokenText] = useState('')
  const [verdict, setVerdict] = useState<{ valid: boolean; detail: string; fix?: string } | null>(
    null,
  )
  const toast = useToast()

  const start = trpc.setup.startTerminal.useMutation({
    onSuccess: ({ sessionId }) => setSessionId(sessionId),
    onError: (e) => toast.push(e.message),
  })
  const save = trpc.setup.afkToken.useMutation({
    onSuccess: (res) => {
      setVerdict(res)
      if (res.valid) onDone()
    },
    onError: (e) => toast.push(e.message),
  })
  if (!probe?.runtime) return null
  const runtime = probe.runtime
  const flow = AFK_CREDENTIAL[runtime]
  const inputId = `afk-credential-${runtime}`

  return (
    <Row probe={probe}>
      {flow.mint &&
        (sessionId ? (
          <div className="afk-term">
            <ErrorBoundary label={flow.mint.kind}>
              <TerminalView sessionId={sessionId} />
            </ErrorBoundary>
          </div>
        ) : (
          <Button
            variant="ghost"
            onClick={() => flow.mint && start.mutate({ kind: flow.mint.kind })}
            disabled={start.isPending}
          >
            {start.isPending ? 'Starting…' : flow.mint.label}
          </Button>
        ))}

      <label className="op-label" htmlFor={inputId}>
        {flow.prompt}
      </label>
      <input
        id={inputId}
        className="op-input mono"
        value={tokenText}
        onChange={(e) => setTokenText(e.target.value)}
        placeholder={flow.placeholder}
        spellCheck={false}
        autoComplete="off"
      />
      <div className="afk-term-actions">
        <Button
          variant="solid"
          disabled={tokenText.trim() === '' || save.isPending}
          onClick={() => save.mutate({ token: tokenText, runtime })}
        >
          {save.isPending ? 'Verifying…' : 'Save & verify'}
        </Button>
      </div>
      {verdict && (
        <div className={`afk-verdict ${verdict.valid ? 'is-ok' : 'is-warn'}`}>
          <div>
            {verdict.valid ? '✓ ' : '⚠ '}
            {verdict.detail}
          </div>
          {/* The verdict is the *only* feedback this step gives, so a failure
              must carry its own next step — a bare "cannot verify" leaves the
              user with nothing to try but re-pasting the same token. */}
          {verdict.fix && <div className="afk-verdict-fix">{verdict.fix}</div>}
        </div>
      )}
    </Row>
  )
}
