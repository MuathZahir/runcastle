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
import { Button, cx, IconButton, Spinner, StatusDot, StatusLabel, TextField } from '../ui'
import {
  IconAlert,
  IconCheck,
  IconCopy,
  IconCube,
  IconFlame,
  IconRefresh,
  IconTerminal,
  IconTrash,
  IconUser,
} from '../icons'
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
  // With a project open the image row is about *that* project's image — the one
  // its `.runcastle/sandbox/Dockerfile` builds, if it ships one. The wizard has
  // no project and asks the machine-wide question.
  const doctor = trpc.setup.doctor.useQuery(projectId ? { projectId } : undefined, {
    refetchOnWindowFocus: false,
  })
  const report = doctor.data

  const probe = (id: string) => report?.results.find((r) => r.id === id)
  const runtime = probe('container-runtime')
  const image = probe('sandcastle-image')
  const credentials = afkCredentialRows(report?.results ?? [])

  // Attempts are counted so that a retry starts the wait over rather than
  // inheriting a line that is already complaining. Cancel before refetching: a
  // re-check asked for while the probe is still out has to be able to interrupt
  // it. React Query folds a plain refetch into the request already in flight, so
  // against a daemon that never answers the button would do nothing at all.
  const [attempt, setAttempt] = useState(0)
  const recheck = () => {
    setAttempt((n) => n + 1)
    void utils.setup.doctor.cancel().then(() => doctor.refetch())
  }
  const slow = useSlowWait(doctor.isLoading, attempt)
  const shows = (field: string) => (filter ? showsSetting(filter, field) : true)

  // How the summary reads while the checks are still out, and — when something
  // is in the way — the line that says what, above the Retry that takes it away.
  // A probe that fails and a probe that never comes back are the same dead end
  // (decision 9) and get the same way out.
  const checking = slow ? SLOW_SUMMARY : 'checking prerequisites…'
  const trouble = doctor.error?.message ?? (slow ? SLOW_DETAIL : null)

  // Everything a burn is actually blocked on, in checklist order. The burn cache
  // is deliberately not one of them: a burn runs without it, so counting it
  // would report a machine as not ready when it is.
  const gates = [
    ...(runtime ? [{ field: 'container-runtime', ok: runtime.status === 'ok' }] : []),
    ...(image ? [{ field: 'sandcastle-image', ok: imageReady(image) }] : []),
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

  const allReady = report !== undefined && readiness.count === null
  return (
    <section aria-label="Unattended burn prerequisites" className="flex flex-col">
      {/* The explanatory head: a glyph, the one line that says how far along the
          machine is, one line about what the list below is — and, in the
          wizard, the way past it. No card, no kicker. */}
      <div className="flex items-start gap-3 pb-3">
        <span
          aria-hidden
          className={cx(
            'mt-0.5 inline-flex size-7 shrink-0 items-center justify-center rounded-md bg-surface-hover [&>svg]:size-4',
            allReady ? 'text-success' : 'text-icon',
          )}
        >
          {allReady ? <IconCheck /> : <IconFlame />}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex min-h-7 items-center gap-2 text-sm font-medium text-text">
            {doctor.isLoading ? (
              <>
                <Spinner />
                <span className="font-normal text-text-secondary">{checking}</span>
              </>
            ) : doctor.error ? (
              'Could not run the checks'
            ) : (
              <span className="min-w-0">
                {readiness.count && <span className="tabular-nums">{readiness.count} </span>}
                {readiness.text}
              </span>
            )}
          </div>
          {/* The wizard's step heading has just said what an AFK burn is — say
              it once (DESIGN.md), so this line is Settings' alone. */}
          {!onDismiss && (
            <p className="m-0 text-xs text-pretty text-text-tertiary">
              A burn you walk away from runs its tickets in containers, so it needs what an
              interactive session never does. Fix any of these now, or leave them for later.
            </p>
          )}
        </div>
        {onDismiss && (
          <Button variant="ghost" className="shrink-0" onClick={onDismiss}>
            Set up later
          </Button>
        )}
      </div>

      {trouble && (
        // Not a dead end, whichever way the checks went wrong: a probe that
        // fails and a probe that never answers both land here, and the
        // commonest reason for either is one the human just fixed elsewhere.
        // Retrying is worth offering while the call is still out because it
        // abandons the request in flight — which is what gets an answer out of
        // a Docker Desktop that has finished starting since.
        <div className="flex items-center gap-2.5 py-2 pl-10">
          <StatusDot tone="warning" />
          <span className="min-w-0 grow text-xs text-text-secondary">{trouble}</span>
          <Button variant="ghost" size="sm" icon={<IconRefresh />} onClick={recheck}>
            Retry
          </Button>
        </div>
      )}
      {report && (
        <Checklist>
          <RuntimeRow {...rowProps('container-runtime')} probe={runtime} onRecheck={recheck} />
          <ImageRow
            {...rowProps('sandcastle-image')}
            probe={image}
            runtimeOk={runtime?.status === 'ok'}
            projectId={projectId}
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
        </Checklist>
      )}
    </section>
  )
}

/** Exported for the same reason `ImageBuildAction` is: so a test can build one. */
export type Probe = RouterOutputs['setup']['doctor']['results'][number]

/**
 * Whether the image row lets a burn through. A probe reported for context only
 * (`info`) never does gate one — which is how a `custom` image the operator
 * tagged themselves reads as ready: the burn has an image, it is simply not one
 * runcastle built or can rebuild. A custom image that is not there is still an
 * `error`, and still in the way.
 */
function imageReady(probe: Probe): boolean {
  return probe.status === 'ok' || probe.severity === 'info'
}

/**
 * How long the checklist waits for `setup.doctor` before it admits the wait and
 * offers a way out. The probes shell out to the container runtime and neither
 * they nor the query have a timeout, so on a machine where Docker Desktop is
 * still starting — an ordinary Windows state — the report can be minutes away.
 * Long enough that the second or two a healthy machine takes never shows it.
 */
const SLOW_DOCTOR_MS = 10_000

/** The summary line and the detail once {@link SLOW_DOCTOR_MS} has passed. */
const SLOW_SUMMARY = 'still checking — this is taking longer than usual'
const SLOW_DETAIL =
  'The container runtime has not answered yet. A runtime that is starting up — or wedged — ' +
  'can leave the checks outstanding for minutes.'

/**
 * Whether `waiting` has stayed true for longer than {@link SLOW_DOCTOR_MS}.
 * Changing `attempt` restarts the clock, so each retry gets its own full wait.
 *
 * `docker version` has been measured at 90s on a booting Docker Desktop, with
 * `docker image inspect` not returning at all. Without a bound the checklist
 * sits at "checking prerequisites…" forever, with no control on it: the dead
 * end decision 9 removed from the failed branch, reached through a slow daemon
 * instead.
 */
function useSlowWait(waiting: boolean, attempt: number): boolean {
  const [slow, setSlow] = useState(false)
  useEffect(() => {
    setSlow(false)
    if (!waiting) return
    const timer = setTimeout(() => setSlow(true), SLOW_DOCTOR_MS)
    return () => clearTimeout(timer)
  }, [waiting, attempt])
  return slow
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
 * One checklist row: its number, the label with a status word beside it, the
 * one line the probe observed, and the row's single action on the right.
 * `below` is the terminal a flow opens, which runs the full width rather than
 * squeezing into the action column.
 *
 * The number is a CSS counter on the {@link Checklist}, so a row the filter box
 * hides takes its number with it rather than leaving a gap.
 *
 * Exported for the first-run wizard, whose "Coding agents" step is the same list
 * of one-line verdicts with one action each. `status` overrides the default
 * Ready / Needed word when a row has something more exact to say.
 */
export function ChecklistRow({
  field,
  label,
  visible = true,
  highlight = false,
  detail,
  ok,
  status,
  children,
  below,
}: Partial<RowChrome> & {
  label: string
  detail: string
  ok: boolean
  status?: string
  children?: ReactNode
  below?: ReactNode
}) {
  const { ref, flash } = useHighlight<HTMLLIElement>(highlight)
  if (!visible) return null
  return (
    <li
      ref={ref}
      {...(field ? { 'data-field': field } : {})}
      className={cx(
        'grid grid-cols-[28px_minmax(0,1fr)_auto] items-start gap-x-3 gap-y-2.5 py-3 [counter-increment:checklist]',
        'border-t border-border-subtle first:border-t-0',
        flash && HIGHLIGHT_RING,
      )}
    >
      <span
        aria-hidden
        className="flex h-5 items-center justify-center text-xs text-text-tertiary tabular-nums before:content-[counter(checklist)]"
      />
      <div className="min-w-0">
        <div className="flex min-h-5 flex-wrap items-center gap-x-3 gap-y-0.5">
          <span className="text-sm font-medium text-text">{label}</span>
          {ok ? (
            <StatusLabel tone="success" icon={<IconCheck />}>
              {status ?? 'Ready'}
            </StatusLabel>
          ) : (
            <StatusLabel tone="warning">{status ?? 'Needed'}</StatusLabel>
          )}
        </div>
        <div className="mt-0.5 truncate font-mono text-xs text-text-tertiary" title={detail}>
          {detail}
        </div>
      </div>
      <div className="flex max-w-96 flex-wrap items-center justify-end gap-2">{children}</div>
      {below}
    </li>
  )
}

/** The numbered list a set of {@link ChecklistRow}s sits in. */
export function Checklist({ children }: { children: ReactNode }) {
  return (
    <ol className="m-0 list-none border-t border-border-subtle p-0 [counter-reset:checklist]">
      {children}
    </ol>
  )
}

/** The terminal a row's flow opened, under it and across the whole row. */
export function RowTerminal({
  sessionId,
  label,
  onDone,
  onEnded,
}: {
  sessionId: string
  label: string
  onDone?: () => void
  /**
   * The flow's process exited on its own. Distinct from `onDone`, which is the
   * operator dismissing the terminal: an exit leaves the output up to be read.
   */
  onEnded?: () => void
}) {
  return (
    <div className="col-span-full flex flex-col gap-2">
      <div className="h-70 overflow-hidden rounded-md border border-border bg-surface-inset animate-rise-in">
        <ErrorBoundary label={label}>
          <TerminalView sessionId={sessionId} onEnded={onEnded} />
        </ErrorBoundary>
      </div>
      {onDone && (
        <div className="flex justify-end">
          <Button variant="ghost" size="sm" icon={<IconRefresh />} onClick={onDone}>
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
          <CommandLine
            command={command}
            onCopy={() => {
              void navigator.clipboard?.writeText(command)
              toast.push('copied', 'info')
            }}
          />
        </>
      )}
      {!ok && install?.note && (
        <span className="basis-full text-right text-xs text-text-tertiary">{install.note}</span>
      )}
      {!ok && (
        <Button variant="ghost" size="sm" icon={<IconRefresh />} onClick={onRecheck}>
          Re-check
        </Button>
      )}
    </ChecklistRow>
  )
}

function ImageRow({
  probe,
  runtimeOk,
  projectId,
  onDone,
  ...chrome
}: RowChrome & {
  probe: Probe | undefined
  runtimeOk: boolean
  /**
   * Whose image to build. With a project open the build is that project's — the
   * chain, when its repo carries `.runcastle/sandbox/Dockerfile`. The wizard has
   * no project yet, and builds the stock image alone.
   */
  projectId?: string
  onDone: () => void
}) {
  const [sessionId, setSessionId] = useState<string | null>(null)
  const toast = useToast()
  const target = trpc.setup.imageBuildTarget.useQuery(projectId ? { projectId } : undefined)
  const start = trpc.setup.startTerminal.useMutation({
    onSuccess: ({ sessionId, notices }) => {
      setSessionId(sessionId)
      // A host CLI version the server could not read: the build runs unpinned
      // for that runtime, and this is the only place that says so.
      for (const notice of notices) toast.push(notice)
    },
    onError: (e) => toast.push(e.message),
  })
  if (!probe) return null

  return (
    <ChecklistRow
      {...chrome}
      detail={probe.detail}
      ok={imageReady(probe)}
      below={
        sessionId && (
          <RowTerminal
            sessionId={sessionId}
            label="build-image"
            // The build's own exit is the signal — a build that took ten minutes
            // should not then wait on someone noticing it finished. Success or
            // failure both re-check: the probe decides whether the image is
            // there now, and the log stays up to say why if it is not.
            onEnded={onDone}
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
          target={imageTargetState(target)}
          runtimeOk={runtimeOk}
          pending={start.isPending}
          onStart={() => start.mutate({ kind: 'build-image', ...(projectId ? { projectId } : {}) })}
        />
      )}
    </ChecklistRow>
  )
}

/**
 * What `setup.imageBuildTarget` has said about this row so far. The three
 * settled answers are kept apart from the wait on purpose: a refusal and a
 * failed query are both final, and a button that reads "resolving Dockerfile →
 * resolving tag" over either of them is a spinner that never stops.
 */
export type ImageTargetState =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'refused'; reason: string }
  | { kind: 'ready'; dockerfile: string; tag: string }

/** The target query's state, as {@link ImageBuildAction} reads it. */
function imageTargetState(query: {
  data: RouterOutputs['setup']['imageBuildTarget'] | undefined
  error: { message: string } | null
}): ImageTargetState {
  const { data } = query
  if (data) {
    return data.kind === 'refused'
      ? { kind: 'refused', reason: data.reason }
      : { kind: 'ready', dockerfile: data.dockerfile, tag: data.tag }
  }
  if (query.error) return { kind: 'error', message: query.error.message }
  return { kind: 'loading' }
}

/** Status-specific image action, split from the tRPC wrapper for component testing. */
export function ImageBuildAction({
  probe,
  target,
  runtimeOk,
  pending,
  onStart,
}: {
  probe: Probe
  target: ImageTargetState
  runtimeOk: boolean
  pending: boolean
  onStart: () => void
}) {
  // An image the operator manages themselves is not runcastle's to rebuild
  // (decision 5): the button would have to build the stock template under their
  // tag, which is the clobber this feature exists to remove. So the row offers
  // the two ways back into runcastle's hands instead of a button that destroys
  // their image.
  if (probe.status === 'custom') {
    return <span className="basis-full text-right text-xs text-text-tertiary">{probe.fix}</span>
  }
  // The resolver refused, and its reason carries the way out — so the row says
  // it, the way the custom-probe row above says its fix. The probe need not
  // agree that the image is `custom` for this to happen: the two answers are
  // resolved separately, and a button left disabled over the disagreement is
  // the stuck "resolving…" this row was rewritten for.
  if (target.kind === 'refused') {
    return <span className="basis-full text-right text-xs text-text-tertiary">{target.reason}</span>
  }
  // "Build" while there is nothing to rebuild — an image runcastle has never
  // built, whether that is the stock one or the project's own Dockerfile.
  const verb = probe.status === 'missing' || probe.status === 'not-built-yet' ? 'Build' : 'Rebuild'
  // The tag alone names the image: the Dockerfile path it is built from is long,
  // is `Dockerfile` at its basename whichever image this is, and is in the
  // tooltip already. A wait is only named while the query is actually out.
  const label = pending
    ? 'Starting…'
    : target.kind === 'ready'
      ? `${verb} image · ${target.tag}`
      : target.kind === 'loading'
        ? `${verb} image · resolving…`
        : `${verb} image`
  return (
    <>
      <Button
        variant="secondary"
        size="sm"
        icon={<IconCube />}
        aria-label={`${verb} image`}
        disabled={!runtimeOk || pending || target.kind !== 'ready'}
        title={
          runtimeOk
            ? target.kind === 'ready'
              ? `Dockerfile: ${target.dockerfile}\nImage: ${target.tag}`
              : undefined
            : 'Install a container runtime first'
        }
        onClick={onStart}
      >
        {label}
      </Button>
      {target.kind === 'error' && (
        <span className="basis-full text-right text-xs text-warning">{target.message}</span>
      )}
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
      <Button variant="ghost" size="sm" icon={<IconTrash />} disabled={pending} onClick={onClear}>
        {pending ? 'Clearing…' : 'Clear'}
      </Button>
      {refusal && <span className="basis-full text-right text-xs text-warning">{refusal}</span>}
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
          size="sm"
          icon={<IconTerminal />}
          onClick={() => flow.mint && start.mutate({ kind: flow.mint.kind })}
          disabled={start.isPending}
        >
          {start.isPending ? 'Starting…' : flow.mint.label}
        </Button>
      )}
      <TextField
        // The label is a heading on the row, not a `<label>`, so the control
        // carries its own accessible name (findings F17.7).
        aria-label={chrome.label}
        mono
        className="w-52"
        value={tokenText}
        onChange={(e) => setTokenText(e.target.value)}
        placeholder={flow.placeholder}
        spellCheck={false}
        autoComplete="off"
      />
      {/* The page's one solid button: the whole checklist exists to get here. */}
      <Button
        variant="primary"
        disabled={tokenText.trim() === '' || save.isPending}
        onClick={() => save.mutate({ token: tokenText, runtime })}
      >
        {save.isPending ? 'Verifying…' : 'Save & verify'}
      </Button>
      {verdict && (
        <span className="basis-full text-right text-xs">
          <StatusLabel
            tone={verdict.valid ? 'success' : 'warning'}
            icon={verdict.valid ? <IconCheck /> : <IconAlert />}
          >
            {verdict.detail}
          </StatusLabel>
          {/* The verdict is the *only* feedback this step gives, so a failure
              must carry its own next step — a bare "cannot verify" leaves the
              user with nothing to try but re-pasting the same token. */}
          {verdict.fix && <span className="mt-0.5 block text-text-tertiary">{verdict.fix}</span>}
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
      status={signedIn ? 'Signed in' : 'Not signed in'}
      detail={row.probe.detail}
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
      {!signedIn && !sessionId && (
          <Button
            variant="secondary"
            size="sm"
            icon={<IconUser />}
            disabled={start.isPending}
            onClick={() => start.mutate({ kind: login.kind })}
          >
            {start.isPending ? 'Starting…' : 'Sign in'}
          </Button>
      )}
    </ChecklistRow>
  )
}

/**
 * A command to run, as code, with the one action on it. Exported for the
 * wizard's agents step, whose install hint is the same thing.
 */
export function CommandLine({ command, onCopy }: { command: string; onCopy: () => void }) {
  return (
    <span className="inline-flex max-w-full min-w-0 items-center gap-1 rounded-md bg-surface-inset py-0.5 pr-0.5 pl-2">
      <code className="min-w-0 truncate font-mono text-xs text-text-secondary" title={command}>
        {command}
      </code>
      <IconButton label="Copy" size="sm" icon={<IconCopy />} onClick={onCopy} />
    </span>
  )
}
