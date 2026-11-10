import { Button, cx, MetaLine, StatusDot } from '../../src/ui'
import { PageHeader } from '../../src/ui/page'
import { IconPlus } from '../../src/icons'
import { byUrgency, runningIn, statsOf, waitingIn, type MockProject } from './data'
import { ProjectTile } from './tile'

/**
 * What the All projects page shows beside the rail: a card for each project
 * with something going on, needs-you first; then the quiet ones as plain rows.
 */

export function portfolioMeta(projects: MockProject[]) {
  const waiting = projects.reduce((n, p) => n + statsOf(p).needsYou, 0)
  const running = projects.reduce((n, p) => n + statsOf(p).working, 0)
  return [
    { strong: projects.length, text: 'projects open' },
    running > 0 && { tone: 'live' as const, strong: running, text: 'running' },
    waiting > 0 && { tone: 'warning' as const, strong: waiting, text: waiting === 1 ? 'needs you' : 'need you' },
  ]
}

export function HomeHeader({ projects, phone }: { projects: MockProject[]; phone?: boolean }) {
  return (
    <PageHeader
      title="Projects"
      meta={portfolioMeta(projects)}
      actions={
        phone ? undefined : (
          <Button variant="primary" icon={<IconPlus />}>
            Open a project
          </Button>
        )
      }
    />
  )
}

/**
 * The page, as calm as the rail: a card for each project with
 * something going on (needs-you first), each waiting feature on its own line
 * with the one amber dot; then the quiet projects as plain one-line rows.
 */
export function CardsHome({ projects, onOpen, phone }: { projects: MockProject[]; onOpen: (id: string) => void; phone?: boolean }) {
  const ordered = byUrgency(projects)
  const active = ordered.filter((p) => statsOf(p).needsYou > 0 || statsOf(p).working > 0)
  const quiet = ordered.filter((p) => !active.includes(p))
  return (
    <>
      <HomeHeader projects={projects} phone={phone} />
      {active.length > 0 ? (
        <div className={cx('mt-8 grid gap-3', phone ? 'grid-cols-1' : 'grid-cols-3')}>
          {active.map((p) => (
            <ProjectCard key={p.id} p={p} onOpen={onOpen} />
          ))}
        </div>
      ) : (
        <p className="m-0 mt-8 px-3 text-sm text-text-tertiary">Nothing needs you and nothing is running.</p>
      )}
      {quiet.length > 0 && (
        <>
          <h2 className="m-0 mt-8 px-3 text-xs font-medium text-text-tertiary">Quiet</h2>
          <div className={cx('mt-1 grid gap-x-3', phone ? 'grid-cols-1' : 'grid-cols-3')}>
            {quiet.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => onOpen(p.id)}
                className="flex h-(--row-h) min-w-0 cursor-pointer items-center gap-2.5 rounded-lg px-3 text-left text-md text-text-secondary transition-colors duration-(--dur-1) ease-app hover:bg-surface-hover hover:text-text"
              >
                <ProjectTile project={p} size="sm" />
                <span className="min-w-0 flex-1 truncate">{p.name}</span>
              </button>
            ))}
          </div>
        </>
      )}
    </>
  )
}

function ProjectCard({ p, onOpen }: { p: MockProject; onOpen: (id: string) => void }) {
  const s = statsOf(p)
  const waiting = waitingIn(p)
  // What runs is listed only where nothing waits, as plain words: the amber
  // lines stay the card's one colour, the running count sits in its foot.
  const running = waiting.length === 0 ? runningIn(p) : []
  return (
    <button
      type="button"
      onClick={() => onOpen(p.id)}
      className="card flex min-w-0 cursor-pointer flex-col gap-3 rounded-lg p-3.5 text-left transition-colors duration-(--dur-1) ease-app hover:bg-surface-hover"
    >
      <span className="flex min-w-0 items-center gap-3">
        <ProjectTile project={p} size="md" tone="well" className="size-8 rounded-md" />
        <span className="min-w-0">
          <span className="block truncate text-md font-medium text-text">{p.name}</span>
          <span className="block truncate font-mono text-xs text-text-tertiary">{p.repoPath}</span>
        </span>
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-1">
        {waiting.slice(0, 3).map(({ f, words }) => (
          <span key={f.id} className="flex min-w-0 items-center gap-2 text-sm">
            <StatusDot tone="warning" />
            <span className="min-w-0 truncate text-text-secondary">{f.title}</span>
            <span className="ml-auto shrink-0 text-xs text-text-tertiary">{words.split(' · ')[0]}</span>
          </span>
        ))}
        {waiting.length > 3 && <span className="text-xs text-text-tertiary">and {waiting.length - 3} more</span>}
        {running.slice(0, 3).map((f) => (
          <span key={f.id} className="min-w-0 truncate text-sm text-text-tertiary">
            {f.title}
          </span>
        ))}
      </span>
      <MetaLine items={[s.working > 0 && { tone: 'live', strong: s.working, text: 'running' }, { strong: s.total, text: 'features' }]} />
    </button>
  )
}
