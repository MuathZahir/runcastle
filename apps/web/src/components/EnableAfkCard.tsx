import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import type { AgentRuntime } from '@runcastle/core'
import { trpc } from '../trpc'
import {
  BURN_PREREQUISITES,
  afkCredentialField,
  afkCredentialRows,
  afkReadiness,
  type AfkCredentialRow,
  type BurnPrerequisite,
} from '../lib/afk-rows'
import type { RouterOutputs } from '../lib/api'
import { RUNTIME_LOGIN } from '../lib/first-run'
import { fmtBytes } from '../lib/format'
import { useToast } from '../lib/toast'
import { Button } from '../ui'
import { ErrorBoundary } from './ErrorBoundary'
import { HIGHLIGHT_RING, useHighlight } from './settings/highlight'
import { showsSetting, type FilterState } from './settings/types'
import { TerminalView } from './TerminalView'

/**
 * The prerequisites for unattended burns, as a checklist (flow-redesign-settings
 * decision 9). AFK burns need what the interactive path never does: a container
 * runtime, the sandcastle image, and — per runtime — an unattended credential.
 * Each is one row: a status dot, the one line the probe observed, and a single
 * action, with the terminals (image build, `setup-token`, sign-in) opening
 * inline underneath their own row.
 *
 * It replaces a card that opened on the kicker "ENABLE AFK BURNS", a title and a
 * paragraph before the first thing to do — three screens of prose the human
 * called useless. What is left is the summary line, which says how far along the
 * machine is and what is in the way.
 *
 * Everything is non-blocking: the user can act on any row now or leave it. The
 * component is rendered on Settings → Burns and inside the first-run wizard —
 * same component, `onDismiss` there and omitted here.
 *
 * `projectId` is the one thing the wizard cannot supply: the burn cache is one
 * volume per project, so its row appears only where a project is open (from
 * Settings), and the wizard — which may run before any project exists — omits it.
 */
export function EnableAfkCard({
  projectId,
  filter,
  highlightField,
  onDismiss,
}: {
  projectId?: string
  /** The Burns page's filter box. Absent — the wizard — shows every row. */
  filter?: FilterState
  /** The row a deep link named: scroll to it and flash it once. */
  highlightField?: string
  onDismiss?: () => void
}) {
  const utils = trpc.useUtils()
  const doctor = trpc.setup.doctor.useQuery(undefined, { refetchOnWindowFocus: false })
  const report = doctor.data
  const slow = useSlowSince(doctor.isLoading)

  const probe = (id: string) => report?.results.find((r) => r.id === id)
  const runtime = probe('container-runtime')
  const image = probe('sandcastle-image')
  const credentials = afkCredentialRows(report?.results ?? [])

  // Cancel before refetching: a re-check asked for while the probe is still out
  // has to be able to interrupt it. React Query folds a plain refetch into the
  // request already in flight, so against a daemon that never answers the
  // button would do nothing at all.
  const recheck = () => void utils.setup.doctor.cancel().then(() => doctor.refetch())
  const shows = (field: string) => (filter ? showsSetting(filter, field) : true)

  // The one thing standing between the human and the checklist, with the Retry
  // that takes it away. A probe that fails and a probe that never comes back are
  // the same dead end (decision 9) and get the same way out.
  const trouble = doctor.error?.message ?? (slow ? SLOW_DETAIL : null)

  // Everything a burn is actually blocked on, in checklist order. The burn cache
  // is deliberately not one of them: a burn runs without it, so counting it
  // would report a machine as not ready when it is.
  const gates = [
    ...(runtime ? [{ field: 'container-runtime', ok: runtime.status === 'ok' }] : []),
    ...(image ? [{ field: 'sandcastle-image', ok: image.status === 'ok' }] : []),
    ...credentials.map((row) => ({
      field: afkCredentialField(row.runtime),
      ok: row.probe.status === 'ok',
    })),
  ]
  const readiness = afkReadiness(
    gates.map(({ field, ok }) => ({
      ok,
      reason: PREREQUISITE[field].reason ?? PREREQUISITE[field].label,
    })),
  )

  const rowProps = (field: string) => ({
    field,
    label: PREREQUISITE[field].label,
    visible: shows(field),
    highlight: highlightField === field,
  })

  return (
    <Checklist>
      <div className="flex items-center gap-2.5 border-b border-hairline-soft bg-panel-2 px-3 py-2.5 text-sm text-text-2">
        <span className="min-w-0">
          {doctor.isLoading ? (
            slow ? (
              SLOW_SUMMARY
            ) : (
              'checking prerequisites…'
            )
          ) : doctor.error ? (
            'could not run checks'
          ) : (
            <>
              {readiness.count && <b className="font-semibold text-text">{readiness.count} </b>}
              {readiness.text}
            </>
          )}
        </span>
        {report && (
          <span className="ml-auto flex shrink-0 gap-1" aria-hidden>
            {gates.map((gate) => (
              <span
                key={gate.field}
                className={cx('h-1.5 w-5.5 rounded-pill', gate.ok ? 'bg-ok' : 'bg-hairline-strong')}
              />
            ))}
          </span>
        )}
        {onDismiss && (
          <Button variant="ghost" className="ml-auto" onClick={onDismiss}>
            Set up later
          </Button>
        )}
      </div>

      <div>
        {trouble && (
          // Not a dead end: the probe shells out to a container runtime, and the
          // commonest reason it fails — or hangs — is one the human just fixed
          // elsewhere.
          <div className="flex items-center gap-2.5 px-3 py-2.5">
            <span className="min-w-0 grow text-sm text-warn">{trouble}</span>
            <Button variant="ghost" onClick={recheck}>
              Retry
            </Button>
          </div>
        )}
        {report && (
          <>
            <RuntimeRow {...rowProps('container-runtime')} probe={runtime} onRecheck={recheck} />
            <ImageRow
              {...rowProps('sandcastle-image')}
              probe={image}
              runtimeOk={runtime?.status === 'ok'}
              onDone={recheck}
            />
            {credentials.map((row) =>
              row.kind === 'token' ? (
                <CredentialRow
                  key={row.runtime}
                  {...rowProps(afkCredentialField(row.runtime))}
                  probe={row.probe}
                  onDone={recheck}
                />
              ) : (
                <SignInRow
                  key={row.runtime}
                  {...rowProps(afkCredentialField(row.runtime))}
                  row={row}
                  onDone={recheck}
                />
              ),
            )}
            {projectId && <ProjectBurnCache {...rowProps('burn-cache')} projectId={projectId} />}
          </>
        )}
      </div>
    </Checklist>
  )
}

/** Exported for the same reason `ImageBuildAction` is: so a test can build one. */
export type Probe = RouterOutputs['setup']['doctor']['results'][number]

/**
 * How long the checks may run before the wait itself is reported. A healthy
 * doctor answers in a second or two; the bound is loose enough that an ordinary
 * run never trips it.
 */
const SLOW_MS = 10_000

/** The summary line and the detail once {@link SLOW_MS} has passed. */
const SLOW_SUMMARY = 'still checking — this is taking longer than usual'
const SLOW_DETAIL =
  'The checks have not come back. A container runtime that is starting up — or wedged — ' +
  'can leave them outstanding for minutes.'

/**
 * True once `active` has stayed true for {@link SLOW_MS}; false again the moment
 * it lets go.
 *
 * The doctor shells out to the container runtime, and a runtime that is still
 * starting up answers slowly or not at all — `docker version` has been measured
 * at 90s on a booting Docker Desktop, with `docker image inspect` not returning
 * at all. Without a bound the checklist sits at "checking prerequisites…"
 * forever, with no control on it: the dead end decision 9 removed from the
 * failed branch, reached through a slow daemon instead.
 */
function useSlowSince(active: boolean): boolean {
  const [slow, setSlow] = useState(false)
  useEffect(() => {
    if (!active) {
      setSlow(false)
      return
    }
    const timer = setTimeout(() => setSlow(true), SLOW_MS)
    return () => clearTimeout(timer)
  }, [active])
  return slow
}

/** Join the parts that are present. Falsy branches drop out. */
function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ')
}

/** The checklist's rows by field, so a row and its metadata never drift apart. */
const PREREQUISITE: Record<string, BurnPrerequisite> = Object.fromEntries(
  BURN_PREREQUISITES.map((p) => [p.field, p]),
)

/** What every checklist row is given, whatever drives it. */
interface RowChrome {
  /** Stable row id — the `data-field` a deep link and the filter box name. */
  field: string
  label: string
  /** The filter box left this row standing. */
  visible: boolean
  /** A deep link named this row. */
  highlight: boolean
}

/**
 * One checklist row: status dot, label and observed detail, and the row's single
 * action. `below` is the terminal a flow opens, which runs the full width rather
 * than squeezing into the action column.
 *
 * Exported for the first-run wizard, whose "Coding agents" step is the same list
 * of one-line verdicts with one action each.
 */
export function ChecklistRow({
  field,
  label,
  visible = true,
  highlight = false,
  detail,
  ok,
  children,
  below,
}: Partial<RowChrome> & {
  label: string
  detail: string
  ok: boolean
  children?: ReactNode
  below?: ReactNode
}) {
  const { ref, flash } = useHighlight<HTMLDivElement>(highlight)
  if (!visible) return null
  return (
    <div
      ref={ref}
      {...(field ? { 'data-field': field } : {})}
      className={cx(
        'grid grid-cols-[18px_minmax(160px,1fr)_auto] items-center gap-x-2.5 gap-y-2',
        'border-t border-hairline-soft px-3 py-2.5 first:border-t-0',
        flash && HIGHLIGHT_RING,
      )}
    >
      <span
        aria-hidden
        className={cx(
          'size-2 justify-self-center rounded-pill',
          ok ? 'bg-ok' : 'bg-warn ring-3 ring-warn/15',
        )}
      />
      <div className="min-w-0">
        <div className="text-sm font-medium text-text">{label}</div>
        <div className="truncate font-mono text-xs text-text-3" title={detail}>
          {detail}
        </div>
      </div>
      <div className="flex max-w-90 flex-wrap items-center justify-end gap-2">{children}</div>
      {below}
    </div>
  )
}

/** The bordered list a set of {@link ChecklistRow}s sits in. */
export function Checklist({ children }: { children: ReactNode }) {
  return <div className="overflow-hidden rounded-md border border-hairline">{children}</div>
}

/** The terminal a row's flow opened, under it and across the whole row. */
export function RowTerminal({
  sessionId,
  label,
  onDone,
}: {
  sessionId: string
  label: string
  onDone?: () => void
}) {
  return (
    <div className="col-span-full flex flex-col gap-2">
      <div className="h-70 overflow-hidden rounded-sm border border-hairline">
        <ErrorBoundary label={label}>
          <TerminalView sessionId={sessionId} />
        </ErrorBoundary>
      </div>
      {onDone && (
        <div className="flex justify-end">
          <Button variant="ghost" onClick={onDone}>
            Done — re-check
          </Button>
        </div>
      )}
    </div>
  )
}

function RuntimeRow({
  probe,
  onRecheck,
  ...chrome
}: RowChrome & { probe: Probe | undefined; onRecheck: () => void }) {
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
  const ok = probe.status === 'ok'

  return (
    <ChecklistRow {...chrome} detail={probe.detail} ok={ok}>
      {!ok && command && (
        <>
          <code className="max-w-full truncate rounded-sm border border-hairline bg-panel-inset px-2 py-1 font-mono text-xs text-accent-hi">
            {command}
          </code>
          <Button
            variant="ghost"
            onClick={() => {
              void navigator.clipboard?.writeText(command)
              toast.push('copied', 'info')
            }}
          >
            Copy
          </Button>
        </>
      )}
      {!ok && install?.note && (
        <span className="basis-full text-right text-xs text-text-3">{install.note}</span>
      )}
      {!ok && (
        <Button variant="ghost" onClick={onRecheck}>
          Re-check
        </Button>
      )}
    </ChecklistRow>
  )
}

function ImageRow({
  probe,
  runtimeOk,
  onDone,
  ...chrome
}: RowChrome & { probe: Probe | undefined; runtimeOk: boolean; onDone: () => void }) {
  const [sessionId, setSessionId] = useState<string | null>(null)
  const toast = useToast()
  const start = trpc.setup.startTerminal.useMutation({
    onSuccess: ({ sessionId }) => setSessionId(sessionId),
    onError: (e) => toast.push(e.message),
  })
  if (!probe) return null

  return (
    <ChecklistRow
      {...chrome}
      detail={probe.detail}
      ok={probe.status === 'ok'}
      below={
        sessionId && (
          <RowTerminal
            sessionId={sessionId}
            label="build-image"
            onDone={() => {
              setSessionId(null)
              onDone()
            }}
          />
        )
      }
    >
      {!sessionId && (
        <ImageBuildAction
          probe={probe}
          runtimeOk={runtimeOk}
          pending={start.isPending}
          onStart={() => start.mutate({ kind: 'build-image' })}
        />
      )}
    </ChecklistRow>
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
    <Button
      variant="ghost"
      disabled={!runtimeOk || pending}
      title={runtimeOk ? undefined : 'Install a container runtime first'}
      onClick={onStart}
    >
      {pending ? 'Starting…' : probe.status === 'missing' ? 'Build image' : 'Rebuild image'}
    </Button>
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
  ...chrome
}: Partial<RowChrome> & {
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
    <ChecklistRow
      field={PREREQUISITE['burn-cache'].field}
      label={PREREQUISITE['burn-cache'].label}
      {...chrome}
      ok
      detail={`${status.volumeName} — ${status.sizeBytes === null ? 'empty' : fmtBytes(status.sizeBytes)}`}
    >
      <Button variant="ghost" disabled={pending} onClick={onClear}>
        {pending ? 'Clearing…' : 'Clear'}
      </Button>
      {refusal && <span className="basis-full text-right text-xs text-warn">{refusal}</span>}
    </ChecklistRow>
  )
}

/** {@link BurnCacheRow} wired to the project's cache: size in, clear out. */
function ProjectBurnCache({ projectId, ...chrome }: RowChrome & { projectId: string }) {
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
      {...chrome}
      status={status.data}
      pending={clear.isPending}
      refusal={refusal}
      onClear={() => clear.mutate({ projectId })}
    />
  )
}

/**
 * How each runtime that has a credential to *capture* obtains it. Claude Code
 * mints a long-lived token with its own `setup-token` flow, so the row runs it
 * in an embedded terminal and takes the printed line. Codex is absent by design:
 * a Codex burn borrows the login the operator already has (decision 4), so there
 * is nothing to paste and its row is a {@link SignInRow}.
 */
const AFK_CREDENTIAL: Partial<
  Record<AgentRuntime, { mint?: { kind: 'setup-token'; label: string }; placeholder: string }>
> = {
  'claude-code': {
    mint: { kind: 'setup-token', label: 'Run claude setup-token' },
    placeholder: 'paste sk-ant-oat01-…',
  },
}

/** One runtime's AFK credential: mint it if the CLI can, then capture and verify. */
function CredentialRow({
  probe,
  onDone,
  ...chrome
}: RowChrome & { probe: Probe | undefined; onDone: () => void }) {
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

  return (
    <ChecklistRow
      {...chrome}
      detail={probe.detail}
      ok={probe.status === 'ok'}
      below={sessionId && <RowTerminal sessionId={sessionId} label="setup-token" />}
    >
      {flow.mint && !sessionId && (
        <Button
          variant="ghost"
          onClick={() => flow.mint && start.mutate({ kind: flow.mint.kind })}
          disabled={start.isPending}
        >
          {start.isPending ? 'Starting…' : flow.mint.label}
        </Button>
      )}
      <input
        // The label is a heading on the row, not a `<label>`, so the control
        // carries its own accessible name (findings F17.7).
        aria-label={chrome.label}
        className="h-7 w-48 min-w-0 rounded-sm border border-hairline bg-panel-inset px-2 font-mono text-xs text-text placeholder:text-text-4"
        value={tokenText}
        onChange={(e) => setTokenText(e.target.value)}
        placeholder={flow.placeholder}
        spellCheck={false}
        autoComplete="off"
      />
      {/* The page's one solid button: the whole checklist exists to get here. */}
      <Button
        variant="solid"
        disabled={tokenText.trim() === '' || save.isPending}
        onClick={() => save.mutate({ token: tokenText, runtime })}
      >
        {save.isPending ? 'Verifying…' : 'Save & verify'}
      </Button>
      {verdict && (
        <span
          className={cx('basis-full text-right text-xs', verdict.valid ? 'text-ok' : 'text-warn')}
        >
          {verdict.valid ? '✓ ' : '⚠ '}
          {verdict.detail}
          {/* The verdict is the *only* feedback this step gives, so a failure
              must carry its own next step — a bare "cannot verify" leaves the
              user with nothing to try but re-pasting the same token. */}
          {verdict.fix && <span className="block text-text-3">{verdict.fix}</span>}
        </span>
      )}
    </ChecklistRow>
  )
}

/**
 * One runtime whose unattended credential IS its interactive login: the burn
 * container borrows the file that login wrote (decision 4), so signing in is the
 * whole of the setup and the row has exactly one thing to offer — the sign-in
 * terminal the wizard runs. Once it closes, the doctor is re-run and the row
 * turns green on its own.
 */
function SignInRow({
  row,
  onDone,
  ...chrome
}: RowChrome & { row: AfkCredentialRow<Probe>; onDone: () => void }) {
  const [sessionId, setSessionId] = useState<string | null>(null)
  const toast = useToast()
  const start = trpc.setup.startTerminal.useMutation({
    onSuccess: ({ sessionId }) => setSessionId(sessionId),
    onError: (e) => toast.push(e.message),
  })
  const login = RUNTIME_LOGIN[row.runtime]
  const signedIn = row.probe.status === 'ok'

  return (
    <ChecklistRow
      {...chrome}
      ok={signedIn}
      detail={signedIn ? `Signed in — ${row.probe.detail}` : row.probe.detail}
      below={
        sessionId && (
          <RowTerminal
            sessionId={sessionId}
            label={login.kind}
            onDone={() => {
              setSessionId(null)
              onDone()
            }}
          />
        )
      }
    >
      {signedIn ? (
        <span className="inline-flex h-5 items-center gap-1.5 rounded-pill border border-hairline bg-panel-2 px-2 text-xs text-text-2">
          <span className="size-1.5 rounded-pill bg-ok" aria-hidden />
          Ready
        </span>
      ) : (
        !sessionId && (
          <Button
            variant="ghost"
            disabled={start.isPending}
            onClick={() => start.mutate({ kind: login.kind })}
          >
            {start.isPending ? 'Starting…' : 'Sign in'}
          </Button>
        )
      )}
    </ChecklistRow>
  )
}
