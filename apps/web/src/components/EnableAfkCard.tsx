import { useState } from 'react'
import type { AgentRuntime } from '@runcastle/core'
import { trpc } from '../trpc'
import { afkCredentialRows, type AfkCredentialRow } from '../lib/afk-rows'
import type { RouterOutputs } from '../lib/api'
import { RUNTIME_LOGIN } from '../lib/first-run'
import { fmtBytes } from '../lib/format'
import { RUNTIME_LABEL } from '../lib/settings'
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
 *
 * `projectId` is the one thing the wizard cannot supply: the burn cache is one
 * volume per project, so its row appears only where a project is open (from
 * Settings), and the wizard — which may run before any project exists — omits it.
 */
export function EnableAfkCard({
  projectId,
  onDismiss,
}: {
  projectId?: string
  onDismiss?: () => void
}) {
  const doctor = trpc.setup.doctor.useQuery(undefined, { refetchOnWindowFocus: false })
  const report = doctor.data

  const probe = (id: string) => report?.results.find((r) => r.id === id)
  const runtime = probe('container-runtime')
  const image = probe('sandcastle-image')
  const credentials = afkCredentialRows(report?.results ?? [])

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
        session. They need a container runtime, the sandcastle image, and the
        unattended credential of each agent you want to burn with. Set them up
        now or anytime from Settings.
      </p>

      {doctor.isLoading && <DimLine>checking prerequisites…</DimLine>}
      {doctor.error && <DimLine>could not run checks: {doctor.error.message}</DimLine>}

      {report && (
        <div className="afk-rows">
          <RuntimeRow probe={runtime} onRecheck={recheck} />
          <ImageRow probe={image} runtimeOk={runtime?.status === 'ok'} onDone={recheck} />
          {projectId && <ProjectBurnCache projectId={projectId} />}
          {credentials.map((row) =>
            row.kind === 'token' ? (
              <CredentialRow key={row.runtime} probe={row.probe} onDone={recheck} />
            ) : (
              <SignInRow key={row.runtime} row={row} onDone={recheck} />
            ),
          )}
        </div>
      )}
    </div>
  )
}

/** Exported for the same reason `ImageBuildAction` is: so a test can build one. */
export type Probe = RouterOutputs['setup']['doctor']['results'][number]

/** One prerequisite row: status dot, label + observed detail, and its action slot. */
function Row({
  probe,
  label,
  showAction = probe?.status !== 'ok',
  children,
}: {
  probe: Probe | undefined
  /** Overrides the probe's own label, for a row asking a narrower question than it. */
  label?: string
  showAction?: boolean
  children?: React.ReactNode
}) {
  if (!probe) return null
  const ok = probe.status === 'ok'
  return (
    <div className={`afk-row${ok ? ' is-ok' : probe.status === 'stale' ? ' is-stale' : ''}`}>
      <div className="afk-row-head">
        <span className={`afk-dot afk-dot-${ok ? 'ok' : 'warn'}`} aria-hidden />
        <div className="afk-row-text">
          <div className="afk-row-label">{label ?? probe.label}</div>
          <div className="afk-row-detail mono">{probe.detail}</div>
        </div>
      </div>
      {showAction && <div className="afk-row-action">{children}</div>}
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
    <Row probe={probe} showAction>
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
        <ImageBuildAction
          probe={probe}
          runtimeOk={runtimeOk}
          pending={start.isPending}
          onStart={() => start.mutate({ kind: 'build-image' })}
        />
      )}
    </Row>
  )
}

/** Status-specific image action, split from the tRPC wrapper for component testing. */
export function ImageBuildAction({
  probe,
  runtimeOk,
  pending,
  onStart,
}: {
  probe: Probe
  runtimeOk: boolean
  pending: boolean
  onStart: () => void
}) {
  return (
    <>
      {probe.status === 'stale' && probe.fix && <div className="afk-note">{probe.fix}</div>}
      <Button
        variant={probe.status === 'ok' ? 'ghost' : 'solid'}
        disabled={!runtimeOk || pending}
        title={runtimeOk ? undefined : 'Install a container runtime first'}
        onClick={onStart}
      >
        {pending ? 'Starting…' : probe.status === 'missing' ? 'Build image' : 'Rebuild image'}
      </Button>
    </>
  )
}

type BurnCacheStatus = RouterOutputs['system']['burnCache']['status']

/**
 * The burn cache volume's size and its one Clear button (decision 6). A cache
 * the operator can neither see nor drop is a support ticket waiting to happen —
 * and clearing it is refused while a burn is working out of it, so the server's
 * reason is rendered where the click happened rather than thrown away.
 *
 * Split from the tRPC wrapper for component testing, like {@link ImageBuildAction}.
 */
export function BurnCacheRow({
  status,
  pending,
  refusal,
  onClear,
}: {
  status: BurnCacheStatus | undefined
  pending: boolean
  /** The server's reason for refusing the last clear, shown verbatim. */
  refusal: string | null
  onClear: () => void
}) {
  // Nothing to show until the size is known, and nothing to offer when the
  // cache is off — that mode is byte-for-byte the behaviour that predates it.
  if (status?.mode !== 'volume') return null

  return (
    <div className="afk-row is-ok">
      <div className="afk-row-head">
        <span className="afk-dot afk-dot-ok" aria-hidden />
        <div className="afk-row-text">
          <div className="afk-row-label">Burn cache</div>
          <div className="afk-row-detail mono">
            {status.volumeName} — {status.sizeBytes === null ? 'empty' : fmtBytes(status.sizeBytes)}
          </div>
        </div>
      </div>
      <div className="afk-row-action">
        <Button variant="ghost" disabled={pending} onClick={onClear}>
          {pending ? 'Clearing…' : 'Clear'}
        </Button>
        {refusal && <div className="afk-verdict is-warn">{refusal}</div>}
      </div>
    </div>
  )
}

/** {@link BurnCacheRow} wired to the project's cache: size in, clear out. */
function ProjectBurnCache({ projectId }: { projectId: string }) {
  const utils = trpc.useUtils()
  const [refusal, setRefusal] = useState<string | null>(null)
  // Not on the SSE invalidation allowlist: reading the size shells out to the
  // engine, so — like `setup.doctor` — it refetches when something actually
  // changed it rather than on every burn event.
  const status = trpc.system.burnCache.status.useQuery(
    { projectId },
    { refetchOnWindowFocus: false },
  )
  const clear = trpc.system.burnCache.clear.useMutation({
    onSuccess: () => {
      setRefusal(null)
      void utils.system.burnCache.status.invalidate()
    },
    onError: (e) => setRefusal(e.message),
  })

  return (
    <BurnCacheRow
      status={status.data}
      pending={clear.isPending}
      refusal={refusal}
      onClear={() => clear.mutate({ projectId })}
    />
  )
}

/**
 * How each runtime that has a credential to *capture* obtains it. Claude Code
 * mints a long-lived token with its own `setup-token` flow, so the card runs it
 * in an embedded terminal and takes the printed line. Codex is absent by design:
 * a Codex burn borrows the login the operator already has (decision 4), so there
 * is nothing to paste and its row is a {@link SignInRow}.
 */
const AFK_CREDENTIAL: Partial<
  Record<
    AgentRuntime,
    { mint?: { kind: 'setup-token'; label: string }; prompt: string; placeholder: string }
  >
> = {
  'claude-code': {
    mint: { kind: 'setup-token', label: 'Run claude setup-token' },
    prompt: 'Paste the token it prints',
    placeholder: 'sk-ant-oat01-…',
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
  if (!flow) return null
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

/**
 * One runtime whose unattended credential IS its interactive login: the burn
 * container borrows the file that login wrote (decision 4), so signing in is the
 * whole of the setup and the row has exactly one thing to offer — the sign-in
 * terminal the wizard runs. Once it closes, the doctor is re-run and the row
 * turns green on its own.
 */
function SignInRow({ row, onDone }: { row: AfkCredentialRow<Probe>; onDone: () => void }) {
  const [sessionId, setSessionId] = useState<string | null>(null)
  const toast = useToast()
  const start = trpc.setup.startTerminal.useMutation({
    onSuccess: ({ sessionId }) => setSessionId(sessionId),
    onError: (e) => toast.push(e.message),
  })
  const login = RUNTIME_LOGIN[row.runtime]
  const signedIn = row.probe.status === 'ok'

  return (
    <Row
      probe={row.probe}
      label={`${RUNTIME_LABEL[row.runtime]} — ${signedIn ? 'Signed in' : 'Sign in'}`}
    >
      {sessionId ? (
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
          disabled={start.isPending}
          onClick={() => start.mutate({ kind: login.kind })}
        >
          {start.isPending ? 'Starting…' : 'Sign in'}
        </Button>
      )}
    </Row>
  )
}
