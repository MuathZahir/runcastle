import { useState } from 'react'
import { trpc } from '../trpc'
import { newestThread } from '../lib/chat-sessions'
import { openApp, openAppWaitingLabel, type OpenApp } from '../lib/feature-ui'
import { useLivePoll } from '../lib/live'
import { useToast } from '../lib/toast'
import {
  Button,
  Disclosure,
  IconButton,
  List,
  ListRow,
  PageTopbar,
  Aside,
  AsideLayout,
  LINK,
  StatusDot,
  StatusLabel,
  cx,
} from '../ui'
import {
  IconAlert,
  IconCheck,
  IconDot,
  IconExternalLink,
  IconFolder,
  IconPanelRight,
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
import { ThreadColumn } from './chat/ThreadColumn'

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
 * One layout (chat-as-web-components decision 7): the preparation chat owns
 * the body as a thread — opened at once, its first message starting it when it
 * never ran — and what is still open and what is established sit in the one
 * aside beside it.
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
  const poll = useLivePoll()

  const projectsQ = trpc.project.list.useQuery()
  const project = projectsQ.data?.find((p) => p.id === projectId)

  const prep = trpc.project.prep.useQuery({ projectId }, { refetchInterval: useLivePoll(3000) })

  // The preparation thread: the newest the project lists, else the open
  // conversation's row while the list cannot be read.
  const threads = trpc.thread.list.useQuery({ projectId }, { refetchInterval: poll }).data ?? []
  const sessionQ = trpc.project.prepSession.useQuery({ projectId }, { refetchInterval: poll })
  const [started, setStarted] = useState<string | null>(null)
  const threadId = newestThread(threads, 'prepare') ?? started ?? sessionQ.data?.id ?? null

  // The first message of a preparation nobody started starts it; the thread says why it was refused.
  const talk = trpc.project.talkToPrep.useMutation({
    onSuccess: () => void utils.project.prepSession.invalidate(),
    onError: () => undefined,
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

  const view = prep.data as PrepView | undefined
  const findings = view?.findings ?? []
  const pending = view?.pendingKeys ?? []
  const staleCount = findings.filter(isStale).length
  const [asideOpen, setAsideOpen] = useState(true)
  const hasAside = findings.length > 0 || pending.length > 0

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
          hasAside ? (
            <IconButton
              label={asideOpen ? 'Hide what is established' : 'Show what is established'}
              icon={<IconPanelRight />}
              active={asideOpen}
              onClick={() => setAsideOpen((open) => !open)}
            />
          ) : undefined
        }
      />

      {/* Above everything: what is up on this machine right now. A prep
          session that dies mid-run leaves a dev server and a temp database
          behind, and the teardown half has to be reachable without it
          (decision 9). */}
      {view?.dryRun && (
        <DryRunRow
          open={openApp(view.dryRun)}
          stopping={stopDryRun.isPending}
          onStop={() => stopDryRun.mutate({ projectId })}
        />
      )}

      <AsideLayout
        aside={
          asideOpen &&
          hasAside && (
            <Aside title={view?.prepared ? 'Established' : 'To establish'} onClose={() => setAsideOpen(false)} bodyClassName="px-4 py-3">
              <PrepAside pending={pending} findings={findings} staleCount={staleCount} />
            </Aside>
          )
        }
      >
        <ThreadColumn
          // One column through the first message's start, so it stays on screen.
          key="prepare"
          label="Preparation chat"
          threadId={threadId}
          start={async () => (await talk.mutateAsync({ projectId, holdOpening: true })).sessionId}
          startsAs={{ projectId, kind: 'prepare' }}
          onStarted={(id) => {
            setStarted(id)
            void utils.thread.list.invalidate({ projectId })
          }}
          draftKey={`prepare:${projectId}`}
          emptyHint={prepHint(view?.prepared ?? false)}
          {...(view ? { meta: prepMeta(view) } : {})}
        />
      </AsideLayout>
    </section>
  )
}

/**
 * What preparation is, said in the empty thread before anything has been
 * said: what it does, then how this conversation goes about it.
 */
export function prepHint(prepared: boolean): string {
  return prepared
    ? `${WHAT_IT_DOES} Repo facts drift; re-preparing measures them again with you there — values you typed by hand are never overwritten.`
    : `${WHAT_IT_DOES} The agent works in your own checkout — it runs this repo's commands, records the answers, and asks you the ones only you know.`
}

/** The quiet line under the composer: when it was prepared, or how much is still open. */
function prepMeta(view: PrepView): string {
  if (view.prepared) return view.preparedAt !== null ? `Prepared ${relativeAge(view.preparedAt)}` : 'Prepared'
  return view.pendingKeys.length > 0 ? `${view.pendingKeys.length} to establish` : 'Preparing'
}

/**
 * The aside beside the preparation chat: what is still open, as rows, then what
 * is established with its evidence.
 */
export function PrepAside({
  pending,
  findings,
  staleCount,
}: {
  pending: readonly string[]
  findings: readonly ProjectFinding[]
  staleCount: number
}) {
  return (
    <div className="flex flex-col gap-4">
      {pending.length > 0 && (
        <List divided label="To establish">
          {pending.map((k, i) => (
            <ListRow key={k} index={i} leading={<IconDot />} title={PREPARED_LABEL[k] ?? k} meta="Not yet" />
          ))}
        </List>
      )}
      {staleCount > 0 && <StaleWarning count={staleCount} />}
      {findings.length > 0 && <EstablishedFrame findings={findings} />}
    </div>
  )
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
        <div className={cx('text-xs', stale ? 'text-warning-text' : 'text-text-tertiary')}>
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
