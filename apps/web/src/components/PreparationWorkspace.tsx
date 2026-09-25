import { useState } from 'react'
import { trpc } from '../trpc'
import { openApp, openAppWaitingLabel, sessionStatusLabel, type OpenApp } from '../lib/feature-ui'
import { useLivePoll } from '../lib/live'
import { useToast } from '../lib/toast'
import {
  Button,
  Disclosure,
  EmptyState,
  IconButton,
  List,
  ListRow,
  Page,
  PageHeader,
  PageSection,
  PageTopbar,
  Aside,
  AsideLayout,
  LINK,
  Loading,
  StatusDot,
  StatusLabel,
  cx,
} from '../ui'
import type { MetaItem } from '../ui'
import {
  IconAlert,
  IconCheck,
  IconClock,
  IconDot,
  IconExternalLink,
  IconFolder,
  IconPanelRight,
  IconPlay,
  IconPlus,
  IconRefresh,
  IconShield,
  IconStop,
} from '../icons'
import {
  PREPARED_LABEL,
  describeFinding,
  findingSource,
  isStale,
  isVerifiable,
  relativeAge,
} from '../lib/prep-findings'
import type { PrepView, ProjectFinding } from '../lib/api'
import { sentenceCase } from '../lib/conversation-title'
import { EndSessionButton } from './EndSessionButton'
import { ErrorBoundary } from './ErrorBoundary'
import { TerminalView } from './TerminalView'

/** What preparation is, in the one sentence every state of the page leads with. */
const WHAT_IT_DOES =
  'Repo facts an agent establishes once — how to install, how to verify, what is already red — so no burn agent re-derives them per ticket.'

/**
 * The preparation workspace — the whole body, not a card in an overlay.
 *
 * Preparation fills in the fields nobody fills in — verify commands, the test
 * baseline, the install command — by establishing them once so no burn agent
 * re-derives them per ticket. It used to live behind the settings overlay,
 * which meant you had to already know it existed to find it, and it is the one
 * thing a fresh project needs before anything else works well. So it gets the
 * screen: an unprepared project with no features lands here, and one with
 * features reaches it from the rail's pinned nudge.
 *
 * It is one conversation on the human's own machine and nothing else. The
 * questions that block preparation — how this dev server starts, which database
 * a drive should point at — are answered by asking, and this session can
 * actually RUN the answers, which a sandbox never could.
 *
 * Two layouts: at rest it is a page (what preparation does, the one primary,
 * what is established); while the conversation is open the terminal owns the
 * body and what is established moves into the one aside.
 */
export function PreparationWorkspace({
  projectId,
  onClose,
}: {
  projectId: string
  /** Leave preparation, when there is somewhere to go back to. */
  onClose?: () => void
}) {
  const utils = trpc.useUtils()
  const toast = useToast()

  const projectsQ = trpc.project.list.useQuery()
  const project = projectsQ.data?.find((p) => p.id === projectId)

  const prep = trpc.project.prep.useQuery({ projectId }, { refetchInterval: useLivePoll(3000) })

  // The open conversation, if there is one. Polled so the terminal appears when
  // a session is launched from anywhere (⌘K, another tab) and disappears when it
  // ends — the session row is the single source of truth, not local state.
  const sessionQ = trpc.project.prepSession.useQuery(
    { projectId },
    { refetchInterval: useLivePoll() },
  )

  const talk = trpc.project.talkToPrep.useMutation({
    onSuccess: () => void utils.project.prepSession.invalidate(),
    onError: (e) => toast.push(e.message),
  })

  // The dry run's stop half, by hand. It frees the singleton drive slot, so the
  // drive info every other surface polls has to be refetched too.
  const stopDryRun = trpc.project.dryRunStop.useMutation({
    onSuccess: () => {
      void utils.project.prep.invalidate()
      void utils.feature.driveInfo.invalidate()
    },
    onError: (e) => toast.push(e.message),
  })

  const [asideOpen, setAsideOpen] = useState(false)

  const view = prep.data as PrepView | undefined
  const session = sessionQ.data ?? null
  const findings = view?.findings ?? []
  const pending = view?.pendingKeys ?? []
  const staleCount = findings.filter(isStale).length
  const sid = session ? (session.ccSessionId ?? session.id) : ''

  return (
    <section className="flex h-full min-h-0 min-w-0 flex-1 flex-col">
      <PageTopbar
        crumbs={[
          {
            label: project?.name ?? 'This project',
            icon: <IconFolder />,
            ...(onClose ? { onClick: onClose } : {}),
          },
          { label: 'Preparation', icon: <IconShield /> },
        ]}
        actions={
          session ? (
            <>
              <div className="mr-2 hidden items-center gap-4 text-xs text-text-tertiary md:flex">
                <StatusLabel tone={session.status === 'live' ? 'live' : 'accent'}>
                  {sentenceCase(sessionStatusLabel(session))}
                </StatusLabel>
                <span className="font-mono" title={sid}>
                  {sid.slice(0, 8)}
                </span>
              </div>
              <EndSessionButton
                sessionId={session.id}
                onEnded={() => {
                  void utils.project.prepSession.invalidate()
                  void utils.project.prep.invalidate()
                }}
              />
              {findings.length > 0 && (
                <IconButton
                  label={asideOpen ? 'Hide what is established' : 'Show what is established'}
                  icon={<IconPanelRight />}
                  active={asideOpen}
                  onClick={() => setAsideOpen((open) => !open)}
                />
              )}
            </>
          ) : undefined
        }
      />

      {/* Above everything, session or not: what is up on this machine right
          now. A prep session that dies mid-run leaves a dev server and a temp
          database behind, and the teardown half has to be reachable without it
          (decision 9). */}
      {view?.dryRun && (
        <DryRunRow
          open={openApp(view.dryRun)}
          stopping={stopDryRun.isPending}
          onStop={() => stopDryRun.mutate({ projectId })}
        />
      )}

      {session ? (
        // While a conversation is open the call-to-action is gone, so what it
        // carries stands on its own in the aside.
        <AsideLayout
          aside={
            asideOpen &&
            findings.length > 0 && (
              <Aside title="Established" onClose={() => setAsideOpen(false)} bodyClassName="px-4 py-3">
                <PrepEvidence findings={findings} staleCount={staleCount} compact />
              </Aside>
            )
          }
        >
          <div className="min-h-0 min-w-0 flex-1 bg-surface-inset animate-fade-in">
            <ErrorBoundary label="terminal">
              <TerminalView sessionId={session.id} />
            </ErrorBoundary>
          </div>
        </AsideLayout>
      ) : (
        <Page routeKey={`prepare-${projectId}`}>
          {prep.isLoading && (
            <Loading>Loading preparation…</Loading>
          )}
          {prep.error && (
            <EmptyState
              icon={<IconAlert />}
              title="Could not load preparation"
              hint={prep.error.message}
            />
          )}
          {/* Only once the view has answered: `prepared` decides between two
              headings that say opposite things, and guessing one flashes the
              wrong sentence on every first paint. */}
          {view && (
            <PrepCallToAction
              prepared={view.prepared}
              preparedAt={view.preparedAt}
              pending={pending}
              findings={findings}
              staleCount={staleCount}
              starting={talk.isPending}
              onStart={() => talk.mutate({ projectId })}
              onStartFresh={() => talk.mutate({ projectId, fresh: true })}
            />
          )}
        </Page>
      )}
    </section>
  )
}

/**
 * The resting state — and it has two, because preparation does not end.
 *
 * Unprepared, this is the one thing to do: what is still open, and the button
 * that opens it. Prepared, it is the door back — what was established, when, and
 * the two ways to go again. That second state is the whole point of the change:
 * `prepared` is monotonic, so the screen used to congratulate the human by
 * removing every mention of preparation from the app, leaving a settings tooltip
 * that said "re-prepare to refresh it" and no way to.
 *
 * Laid out as a page (DESIGN.md §Page anatomy): the title once, a meta line of
 * facts, one sentence, the one primary; then the sections.
 */
export function PrepCallToAction({
  prepared,
  preparedAt,
  pending,
  findings,
  staleCount,
  starting,
  onStart,
  onStartFresh,
}: {
  prepared: boolean
  preparedAt: number | null
  pending: readonly string[]
  findings: readonly ProjectFinding[]
  staleCount: number
  starting: boolean
  onStart: () => void
  onStartFresh: () => void
}) {
  const anyEstablished = findings.length > 0
  const meta: Array<MetaItem | false> = [
    prepared && {
      icon: <IconClock />,
      text:
        preparedAt !== null
          ? `Prepared ${relativeAge(preparedAt)}`
          : 'No preparation conversation on record',
    },
    !prepared && pending.length > 0 && { strong: pending.length, text: 'to establish' },
    anyEstablished && { strong: findings.length, text: 'established' },
    staleCount > 0 && { tone: 'warning', strong: staleCount, text: 'stale' },
  ]

  if (prepared)
    return (
      <>
        <PageHeader title="Re-prepare this project" meta={meta}>
          <p className="m-0 max-w-[60ch] text-base text-pretty text-text-secondary">
            {preparedAt === null && 'Every field already had a value. '}
            {WHAT_IT_DOES} Repo facts drift; re-preparing measures them again with you there.
          </p>
          <div className="mt-6 flex flex-wrap items-center gap-2">
            <Button
              variant="primary"
              icon={<IconRefresh />}
              loading={starting}
              disabled={starting}
              onClick={onStart}
            >
              Resume
            </Button>
            <Button icon={<IconPlus />} disabled={starting} onClick={onStartFresh}>
              Start fresh
            </Button>
          </div>
          <p className="mt-2 mb-0 max-w-[60ch] text-xs text-pretty text-text-tertiary">
            Resume continues your last preparation conversation; Start fresh opens one that has
            never seen it — values you typed by hand are never overwritten.
          </p>
        </PageHeader>
        <PrepEvidence findings={findings} staleCount={staleCount} />
      </>
    )

  return (
    <>
      <PageHeader
        title={anyEstablished ? 'Finish preparing this project' : 'Prepare this project first'}
        meta={meta}
      >
        <p className="m-0 max-w-[60ch] text-base text-pretty text-text-secondary">{WHAT_IT_DOES}</p>
        <div className="mt-6 flex flex-wrap items-center gap-2">
          <Button
            variant="primary"
            icon={<IconPlay />}
            loading={starting}
            disabled={starting}
            onClick={onStart}
          >
            Start preparation
          </Button>
        </div>
        <p className="mt-2 mb-0 max-w-[60ch] text-xs text-pretty text-text-tertiary">
          Opens a terminal session here with an agent in your own checkout — it runs this repo's
          commands, records the answers, and asks you the ones only you know.
        </p>
      </PageHeader>

      {pending.length > 0 && (
        <PageSection title="To establish">
          <List divided label="To establish">
            {pending.map((k, i) => (
              <ListRow
                key={k}
                index={i}
                leading={<IconDot />}
                title={PREPARED_LABEL[k] ?? k}
                meta="Not yet"
              />
            ))}
          </List>
        </PageSection>
      )}
      <PrepEvidence findings={findings} staleCount={staleCount} />
    </>
  )
}

/**
 * What preparation has to show for itself, in the one order that reads: why to
 * act, then what is already there. On the page it is an "Established" section;
 * in the session's aside (`compact`) the same content without the heading.
 */
function PrepEvidence({
  findings,
  staleCount,
  compact = false,
}: {
  findings: readonly ProjectFinding[]
  staleCount: number
  compact?: boolean
}) {
  if (findings.length === 0) return null
  const body = (
    <>
      {staleCount > 0 && <StaleWarning count={staleCount} />}
      <EstablishedFrame findings={findings} />
    </>
  )
  return compact ? body : <PageSection title="Established">{body}</PageSection>
}

/**
 * The preparation dry run, while it holds the drive slot (decision 9). It is a
 * real drive on the human's machine — services up, a temp database created — so
 * the strip says so and offers the teardown, which is the half a dead prep
 * session never runs. The sniffed URL is shown when there is one: it is the same
 * evidence `devCommand`'s stamp is made of. It is a LINK only once the server
 * has watched it answer, exactly as the feature drive's pane behaves.
 *
 * A strip under the topbar, not a tinted callout: a breathing dot, the words,
 * the address, and Stop.
 */
function DryRunRow({
  open,
  stopping,
  onStop,
}: {
  open: OpenApp | null
  stopping: boolean
  onStop: () => void
}) {
  return (
    <div className="flex h-10 shrink-0 items-center gap-3 border-b border-border-subtle px-4 animate-fade-in">
      <StatusLabel tone="live" size="sm" strong>
        Preparation dry run in progress
      </StatusLabel>
      {open &&
        (open.state === 'ready' ? (
          <a
            className={cx(LINK, 'inline-flex min-w-0 items-center gap-1 truncate font-mono text-xs')}
            href={open.url}
            target="_blank"
            rel="noreferrer"
          >
            {open.url}
            <IconExternalLink size={12} className="shrink-0" />
          </a>
        ) : (
          <span className="min-w-0 truncate font-mono text-xs text-text-tertiary">
            {openAppWaitingLabel(open)}
          </span>
        ))}
      <span className="flex-1" />
      <Button
        variant="ghost"
        size="sm"
        icon={<IconStop />}
        loading={stopping}
        disabled={stopping}
        onClick={onStop}
      >
        Stop
      </Button>
    </div>
  )
}

/** Why a re-prepare is worth the interruption: the baseline has gone off. A line, not a box. */
function StaleWarning({ count }: { count: number }) {
  return (
    <div className="mb-4 flex max-w-[64ch] items-start gap-2 text-sm text-pretty text-text-secondary">
      <IconAlert size={16} className="mt-0.5 shrink-0 text-warning" />
      <span>
        {count} finding{count === 1 ? ' has' : 's have'} not been re-measured in a long time. A
        stale test baseline is worse than none — agents trust it and file their own breakage under
        “already red on main”.
      </span>
    </div>
  )
}

/**
 * What preparation established, with the provenance that says whether to trust
 * it: one row per finding — its name, who established it, whether a dry run has
 * proven it, whether it has gone stale — and the evidence folded beneath it.
 */
export function EstablishedFrame({ findings }: { findings: readonly ProjectFinding[] }) {
  return (
    <div className="flex flex-col [&>details:last-child]:border-b [&>details:last-child]:border-border-subtle">
      {findings.map((f, i) => (
        <FindingRow key={f.key} finding={f} label={PREPARED_LABEL[f.key] ?? f.key} index={i} />
      ))}
    </div>
  )
}

function FindingRow({
  finding: f,
  label,
  index,
}: {
  finding: ProjectFinding
  label: string
  /** Position on first render, for the entrance stagger. */
  index: number
}) {
  const [expanded, setExpanded] = useState(false)
  const source = findingSource(f)
  const stale = isStale(f)
  return (
    <Disclosure
      title={label}
      index={index}
      aside={
        <span className="flex items-center gap-4">
          {stale && <StatusLabel tone="warning">Stale</StatusLabel>}
          <DryRunStamp finding={f} />
          {/* Provenance is a fact, not a verdict: a neutral dot. Colour is kept
              for what needs acting on (stale, unproven) and what is proven. */}
          <StatusLabel title={source.title}>
            {source.label}
          </StatusLabel>
        </span>
      }
    >
      <div className="flex flex-col gap-2">
        <div className={cx('text-xs', stale ? 'text-warning' : 'text-text-tertiary')}>
          {describeFinding(f)}
        </div>
        {f.evidence && (
          <>
            <div className="rounded-md border border-border-subtle bg-surface-inset px-3 py-2">
              <div
                className={cx(
                  'font-mono text-xs leading-[1.5] break-words whitespace-pre-wrap text-text-secondary',
                  !expanded && 'line-clamp-3',
                )}
              >
                {f.evidence}
              </div>
            </div>
            <Button
              variant="ghost"
              size="sm"
              className="-ml-2 self-start"
              onClick={() => setExpanded((value) => !value)}
              aria-expanded={expanded}
              aria-label={`${expanded ? 'Collapse' : 'Show full'} evidence for ${label}`}
            >
              {expanded ? 'Show less' : 'Show full evidence'}
            </Button>
          </>
        )}
      </div>
    </Disclosure>
  )
}

/**
 * Whether a dry run has ever seen this value work, on the keys one can prove.
 * Nothing at all on the rest — `dbResetCommand` has no drive slot to prove it in
 * and a host drive never touches the sandbox keys, so silence is the honest
 * report (decision 10).
 */
function DryRunStamp({ finding }: { finding: ProjectFinding }) {
  if (!isVerifiable(finding.key)) return null
  const proven = finding.verifiedAt !== undefined
  return proven ? (
    <StatusLabel
      tone="success"
      icon={<IconCheck size={14} />}
      title="A preparation dry run ran this value on the real drive machinery and it worked"
    >
      Proven {relativeAge(finding.verifiedAt!)}
    </StatusLabel>
  ) : (
    <StatusLabel
      tone="warning"
      title="No dry run has ever proven this value — a drive that depends on it may fall over"
    >
      Unproven
    </StatusLabel>
  )
}
