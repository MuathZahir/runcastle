import { useState } from 'react'
import { trpc } from '../trpc'
import { IconBranch, IconMessage } from '../icons'
import { Button, DimLine, SessionStatusDot } from '../ui'
import type { ProjectConversation } from '../lib/api'
import { sessionStatusLabel } from '../lib/feature-ui'
import { fmtDateTime } from '../lib/format'
import { projectStats } from '../lib/projects'
import { useLivePoll } from '../lib/live'
import { PROJECT_BRANCH, projectBranchNote, sessionBranchState } from '../lib/project-workspace'
import { useToast } from '../lib/toast'
import type { ProjectTalkApi } from '../lib/use-project-talk'
import { ConversationTranscript } from './ConversationTranscript'
import { EndSessionButton } from './EndSessionButton'
import { ErrorBoundary } from './ErrorBoundary'
import { TerminalView } from './TerminalView'

/**
 * The project workspace (decision 20) — what the rail's pinned row swaps in.
 *
 * This is the one surface in the shell bound to a project rather than a feature:
 * the project's CONVERSATIONS, framed by what they read (the charter and the
 * feature index) and by where their commits go. The chrome states the branch and
 * its consequence up front, because unlike every other terminal in runcastle
 * this one writes the repo for real — on a runcastle-owned branch, landing on
 * the base branch, arriving in the human's checkout like a pull.
 *
 * A list, not a terminal, is the resting state (decision 5). Opening the chat
 * used to silently resume one endless conversation, so there was no way to start
 * a clean one and no way back to an old one. Now: New chat is the prominent
 * default, past conversations are named and dated, reopening one is a click on
 * that one, and an ended conversation can be read without being reopened. Only
 * one runs at a time — the launcher's rule — so a live conversation takes the
 * body over, exactly as the single session used to.
 */
export function ProjectWorkspace({
  projectId,
  talk,
}: {
  projectId: string
  talk: ProjectTalkApi
}) {
  const utils = trpc.useUtils()
  // Same query key the nav already polls, so this costs no extra fetch.
  const projectsQ = trpc.project.list.useQuery()
  const project = projectsQ.data?.find((p) => p.id === projectId)
  // Same key (and interval) as the rail's own poll — one fetch, two readers.
  const featuresQ = trpc.feature.list.useQuery({ projectId }, { refetchInterval: useLivePoll() })
  const stats = projectStats(featuresQ.data ?? [])
  const inFlight = stats.total - stats.shipped
  const session = talk.session
  // The conversation being read back, if any. A live session outranks it — the
  // terminal owns the body, whoever opened it and from wherever.
  const [viewing, setViewing] = useState<ProjectConversation | null>(null)
  const reading = session ? null : viewing
  // Reopening leaves the read-only pane behind: what comes back is the terminal,
  // and closing that should land on the list, not on the transcript of the
  // conversation you have just been having.
  const reopen = (sessionId: string): void => {
    talk.resume(sessionId)
    setViewing(null)
  }

  return (
    <section className="workspace">
      <div className="ws-head">
        <div className="ws-title-row">
          <span className="inline-flex h-[18px] items-center rounded-pill border border-accent-line bg-accent-soft px-2 text-[9.5px] font-bold tracking-[0.09em] text-accent-hi">
            PROJECT
          </span>
          <span className="ws-title">{project?.name ?? 'This project'}</span>
          <span className="ws-title-spacer" />
          <span className="ws-branch is-static" title="the branch this session works on">
            <IconBranch size={11} />
            {PROJECT_BRANCH}
          </span>
        </div>
        <SessionLanding projectId={projectId} />
      </div>

      <div className="ws-body">
        <div className="ws-body-inner">
          {session ? (
            <>
              <SessionFrame stats={stats} inFlight={inFlight} />
              <div className="grill-panel">
                <div className="grill-strip">
                  <span className="grill-kind">
                    {titleFor(talk.conversations, session.id) ?? 'project'}
                  </span>
                  <SessionStatusDot status={session.status} />
                  <span className="grill-live-label">{sessionStatusLabel(session)}</span>
                  <span className="grill-strip-spacer" />
                  <span className="grill-sid" title={session.ccSessionId ?? session.id}>
                    {(session.ccSessionId ?? session.id).slice(0, 8)}
                  </span>
                  <EndSessionButton
                    sessionId={session.id}
                    onEnded={() => {
                      void utils.project.projectSession.invalidate()
                      void utils.project.conversations.invalidate()
                    }}
                  />
                </div>
                <div className="grill-term h-[clamp(300px,calc(100dvh-420px),1200px)]">
                  <ErrorBoundary label="terminal">
                    <TerminalView sessionId={session.id} />
                  </ErrorBoundary>
                </div>
              </div>
            </>
          ) : reading ? (
            <ReadingPane
              conversation={reading}
              onBack={() => setViewing(null)}
              onReopen={() => reopen(reading.id)}
              reopening={talk.starting}
            />
          ) : (
            <>
              <NewChatCard onStart={talk.start} starting={talk.starting} />
              <ConversationList
                conversations={talk.conversations}
                pending={talk.conversationsPending}
                busy={talk.starting}
                onResume={reopen}
                onView={setViewing}
              />
              <SessionFrame stats={stats} inFlight={inFlight} />
            </>
          )}
        </div>
      </div>
    </section>
  )
}

/**
 * Where this chat's work lands, said and chosen in the same place (decision 5).
 *
 * It used to be a stored project-level "Main branch" field in the settings
 * overlay, which nobody would guess also decided where the project chat's
 * charter commits went, and which detection overwrote on every project open. The
 * control belongs beside the thing it controls, named for what it does, so it
 * lives in this chrome rather than in settings.
 *
 * Reading never writes (decision 6): an unpicked project shows the detected main
 * line and stays unpicked until somebody chooses here. Options are LOCAL
 * branches only — a remote-only pick is what `resolveSessionBranch` would reject
 * as vanished at launch.
 */
function SessionLanding({ projectId }: { projectId: string }) {
  const utils = trpc.useUtils()
  const toast = useToast()
  const viewQ = trpc.project.sessionBranch.useQuery({ projectId })
  const branchesQ = trpc.project.branches.useQuery({ projectId })
  const landing = sessionBranchState(viewQ.data, branchesQ.data?.branches)
  const update = trpc.settings.update.useMutation({
    onSuccess: () => {
      void utils.project.sessionBranch.invalidate()
      // The same value is a row in the settings overlay; one write, both readers.
      void utils.settings.get.invalidate()
    },
    onError: (e) => toast.push(e.message),
  })

  // A stored pick whose branch is gone is not in the list, and a select whose
  // value is not among its options renders blank — so the value on screen is
  // always an option, even when it is the problem being reported.
  const options = branchesQ.data?.branches ?? []
  const shown = landing?.value
  const offered = shown && !options.includes(shown) ? [shown, ...options] : options

  return (
    <>
      <div className="mt-2 text-sm leading-6 text-text-3">{projectBranchNote(shown ?? '')}</div>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <label className="nf-base-label text-sm text-text-3" htmlFor="session-branch-select">
          This chat’s work lands on
        </label>
        <select
          id="session-branch-select"
          className="nf-base-select"
          value={shown ?? ''}
          disabled={!landing || offered.length === 0 || update.isPending}
          onChange={(e) => update.mutate({ projectId, key: 'sessionBranch', value: e.target.value })}
        >
          {!landing && <option value="">loading…</option>}
          {offered.map((b) => (
            <option key={b} value={b}>
              {b}
            </option>
          ))}
        </select>
        {landing && (
          <>
            <span className={`rounded-sm border px-1.5 py-0.5 text-xs font-bold tracking-[0.09em] uppercase ${landing.origin === 'vanished' ? 'border-danger/55 text-danger' : 'border-hairline text-text-3'}`}>{landing.label}</span>
            <span className="size-hint basis-full">{landing.note}</span>
          </>
        )}
      </div>
    </>
  )
}

/** The conversation's name, once the list knows it. */
function titleFor(conversations: ProjectConversation[], sessionId: string): string | null {
  return conversations.find((c) => c.id === sessionId)?.title ?? null
}

/**
 * What the conversation already knows before you type. Doc contents are a later
 * slice — the count and the charter's whereabouts are what make a chat legible.
 */
function SessionFrame({
  stats,
  inFlight,
}: {
  stats: { total: number; shipped: number }
  inFlight: number
}) {
  return (
    <div className="mb-[18px] rounded-lg border border-hairline bg-panel-2 px-4 py-3.5">
      <div className="mb-2 text-xs font-bold tracking-[0.09em] text-text-3 uppercase">What every chat here already has</div>
      <ul className="m-0 flex flex-col gap-1.5 pl-[18px] text-sm leading-[1.55] text-text-3 [&_b]:font-semibold [&_b]:text-text-2 [&_code]:font-mono [&_code]:text-xs">
        <li>
          <b>
            {stats.total} feature{stats.total === 1 ? '' : 's'}
          </b>{' '}
          as a one-line index — {inFlight} in flight, {stats.shipped} shipped.
        </li>
        <li>
          The project charter (<code>CONTEXT.md</code>) and the decision log, when the repo has them.
        </li>
        <li>
          Every merged feature’s docs, already on disk in its worktree — it can read them without
          asking.
        </li>
      </ul>
    </div>
  )
}

/** The default action, and the only one on a project nobody has talked to yet. */
function NewChatCard({ onStart, starting }: { onStart: () => void; starting: boolean }) {
  return (
    <div className="mb-[18px] flex items-center gap-5 rounded-lg border border-accent-line bg-accent-soft px-[22px] py-5">
      <div className="flex flex-1 flex-col gap-1.5">
        <div className="text-base font-medium text-text-2">Talk it through</div>
        <div className="max-w-[52ch] text-sm leading-[1.6] text-text-3">
          Bring a lump of raw intent. The chat looks at what this project has already built and
          decided, asks what it needs to, suggests how to split the work — then creates the
          features.
        </div>
      </div>
      <Button variant="solid" disabled={starting} onClick={onStart}>
        {starting ? 'Opening…' : 'New chat'}
      </Button>
    </div>
  )
}

/**
 * Past conversations, newest first. Resuming is a click on the conversation you
 * mean and never the default — the complaint this whole surface answers is that
 * opening the chat resumed one endless thread nobody chose.
 */
function ConversationList({
  conversations,
  pending,
  busy,
  onResume,
  onView,
}: {
  conversations: ProjectConversation[]
  pending: boolean
  busy: boolean
  onResume: (sessionId: string) => void
  onView: (conversation: ProjectConversation) => void
}) {
  if (pending) return null
  if (conversations.length === 0)
    return <DimLine>No conversations yet — the first one starts above.</DimLine>

  return (
    <div className="mb-[18px] flex flex-col gap-0.5">
      <div className="mb-1.5 text-xs font-bold tracking-[0.09em] text-text-3 uppercase">Past conversations</div>
      {conversations.map((c) => (
        <div key={c.id} className="flex items-center gap-2.5 rounded-md border border-transparent px-3 py-[9px] transition-colors duration-(--dur-1) ease-app hover:border-hairline hover:bg-panel-2">
          <span className="inline-flex text-text-3">
            <IconMessage size={13} />
          </span>
          <span className="flex min-w-0 flex-1 flex-col gap-0.5">
            <span className="overflow-hidden text-ellipsis whitespace-nowrap text-sm text-text-2">{c.title}</span>
            <span className="text-xs text-text-3">
              {c.createdAt ? fmtDateTime(c.createdAt) : 'date unknown'}
              {c.status !== 'ended' && ' · open'}
            </span>
          </span>
          <button className="btn btn-ghost btn-xs" onClick={() => onView(c)}>
            Transcript
          </button>
          {/* A conversation Claude Code never picked up has nothing to resume —
              reopening it would silently be a new chat, so it does not offer. */}
          <button
            className="btn btn-ghost btn-xs"
            disabled={busy || !c.resumable}
            title={c.resumable ? 'continue this conversation' : 'this one never got started'}
            onClick={() => onResume(c.id)}
          >
            Reopen
          </button>
        </div>
      ))}
    </div>
  )
}

/** One conversation, read back — with the way out of it and the way into it. */
function ReadingPane({
  conversation,
  onBack,
  onReopen,
  reopening,
}: {
  conversation: ProjectConversation
  onBack: () => void
  onReopen: () => void
  reopening: boolean
}) {
  return (
    <div className="flex flex-col gap-3.5">
      <div className="flex items-center gap-3">
        <button className="btn btn-ghost btn-xs" onClick={onBack}>
          ← Conversations
        </button>
        <span className="overflow-hidden text-ellipsis whitespace-nowrap text-sm text-text-2">{conversation.title}</span>
        <span className="grill-strip-spacer" />
        <Button disabled={reopening || !conversation.resumable} onClick={onReopen}>
          {reopening ? 'Opening…' : 'Reopen'}
        </Button>
      </div>
      <ConversationTranscript sessionId={conversation.id} />
    </div>
  )
}
