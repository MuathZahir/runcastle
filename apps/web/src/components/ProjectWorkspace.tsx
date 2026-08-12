import { trpc } from '../trpc'
import { IconBranch } from '../icons'
import { Button, DimLine, SessionStatusDot } from '../ui'
import { sessionStatusLabel } from '../lib/feature-ui'
import { projectStats } from '../lib/projects'
import { useLivePoll } from '../lib/live'
import { PROJECT_BRANCH, projectBranchNote } from '../lib/project-workspace'
import type { ProjectTalkApi } from '../lib/use-project-talk'
import { EndSessionButton } from './EndSessionButton'
import { ErrorBoundary } from './ErrorBoundary'
import { TerminalView } from './TerminalView'

/**
 * The project workspace (decision 20) — what the rail's pinned row swaps in.
 *
 * This is the one surface in the shell bound to a project rather than a feature:
 * a terminal for the intake session, framed by what that session reads (the
 * charter and the feature index) and by where its commits go. The chrome states
 * the branch and its consequence up front, because unlike every other terminal
 * in runcastle this one writes the repo for real — on a runcastle-owned branch,
 * landing on the base branch, arriving in the human's checkout like a pull.
 *
 * The terminal itself is the same embedding a feature session gets: one strip
 * over one PTY on `/ws/terminal/:sessionId`.
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

  return (
    <section className="workspace">
      <div className="ws-head">
        <div className="ws-title-row">
          <span className="pw-tag">PROJECT</span>
          <span className="ws-title">{project?.name ?? 'This project'}</span>
          <span className="ws-title-spacer" />
          <span className="ws-branch is-static" title="the branch this session works on">
            <IconBranch size={11} />
            {PROJECT_BRANCH}
          </span>
        </div>
        <div className="pw-consequence">{projectBranchNote(project?.mainBranch ?? '')}</div>
      </div>

      <div className="ws-body">
        <div className="ws-body-inner">
          {/* The resting frame: what the conversation already knows before you
              type. Doc contents are a later slice — the count and the charter's
              whereabouts are what make the session legible today. */}
          <div className="pw-frame">
            <div className="pw-frame-head">What this session already has</div>
            <ul className="pw-frame-list">
              <li>
                <b>
                  {stats.total} feature{stats.total === 1 ? '' : 's'}
                </b>{' '}
                as a one-line index — {inFlight} in flight, {stats.shipped} shipped.
              </li>
              <li>
                The project charter (<code>CONTEXT.md</code>) and the decision log, when the repo has
                them.
              </li>
              <li>
                Every merged feature’s docs, already on disk in its worktree — it can read them
                without asking.
              </li>
            </ul>
          </div>

          {session ? (
            <div className="grill-panel pw-session">
              <div className="grill-strip">
                <span className="grill-kind">project</span>
                <SessionStatusDot status={session.status} />
                <span className="grill-live-label">{sessionStatusLabel(session)}</span>
                <span className="grill-strip-spacer" />
                <span className="grill-sid" title={session.ccSessionId ?? session.id}>
                  {(session.ccSessionId ?? session.id).slice(0, 8)}
                </span>
                <EndSessionButton
                  sessionId={session.id}
                  onEnded={() => void utils.project.projectSession.invalidate()}
                />
              </div>
              <div className="grill-term pw-term">
                <ErrorBoundary label="terminal">
                  <TerminalView sessionId={session.id} />
                </ErrorBoundary>
              </div>
            </div>
          ) : (
            <div className="pw-rest">
              <div className="pw-rest-title">Talk it through</div>
              <div className="pw-rest-sub">
                Bring a lump of raw intent and this session grills it until it resolves into
                features — then creates them. It also answers “have we already decided this?” and
                routes a bug or a tweak to the right door.
              </div>
              <Button variant="solid" disabled={talk.starting} onClick={talk.start}>
                {talk.starting ? 'Opening…' : 'Talk it through'}
              </Button>
              <DimLine>Opening it again resumes your last project conversation.</DimLine>
            </div>
          )}
        </div>
      </div>
    </section>
  )
}
