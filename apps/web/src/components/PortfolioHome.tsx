import { trpc } from '../trpc'
import { projectStats } from '../lib/projects'
import { useLivePoll } from '../lib/live'
import type { ProjectNavApi } from '../lib/use-project-nav'
import { IconPlus, LogoMark, LogoWordmark } from '../icons'
import { ProjectCard } from './ProjectCard'

/**
 * The portfolio home (issue #45): the canonical cross-project surface. One card
 * per open project, each reflecting live pipeline health, active-run count and
 * needs-you count, and clicking through into the project.
 *
 * The dashed card at the end of the grid is the only way to open a project from
 * here (decision 7) — a second button in the top bar said the same thing a
 * hand's width away. Home is never reached with no projects open (decision 3),
 * so it has no empty state: the shell lands on the first-project screen instead.
 */

// `cursor-pointer bg-transparent` are the button reset this app has to write
// itself: it ships no preflight while the legacy sheet is alive (STYLE.md), so
// an unstyled background here paints the card in the user agent's grey.
const OPEN_CARD =
  'flex min-h-38 cursor-pointer flex-col items-start justify-center gap-1 rounded-lg ' +
  'border border-dashed border-hairline-strong bg-transparent p-4 text-left text-text-3 ' +
  'transition-[color,background-color,border-color] duration-(--dur-2) ease-app ' +
  'hover:border-accent-line hover:bg-accent-soft hover:text-text'
export function PortfolioHome({ nav }: { nav: ProjectNavApi }) {
  const projects = nav.projects ?? []

  // One feature.list per project — the cards' health/runs/needs-you are derived
  // client-side, and the same polling powers the aggregate runs pill upstairs.
  const poll = useLivePoll()
  const featureQueries = trpc.useQueries((t) =>
    projects.map((p) => t.feature.list({ projectId: p.id }, { refetchInterval: poll })),
  )

  return (
    <div className="flex h-full flex-col">
      <header className="flex h-11 flex-none items-center border-b border-hairline bg-panel px-4">
        {/* Inline utilities, not `.tb-home` / `.tb-logo`: those rules were the
            in-project titlebar's, and the shell flow deleted them with the
            rest of that surface (apps/web/STYLE.md). */}
        <span className="inline-flex shrink-0 items-center gap-2">
          <span className="inline-flex shrink-0 items-center">
            <LogoMark size={17} />
          </span>
          <LogoWordmark />
        </span>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-[clamp(20px,6vw,72px)] pt-12 pb-14">
        <div className="mx-auto max-w-[1100px]">
          <header className="mb-7">
            <h1 className="text-xl font-semibold text-text">Projects ({projects.length})</h1>
            <p className="mt-2 max-w-[60ch] text-base text-text-2">
              Every open project and where it stands — runs keep going in the background while you
              switch.
            </p>
          </header>

          <div className="grid grid-cols-[repeat(auto-fill,minmax(280px,1fr))] gap-4">
            {projects.map((p, i) => {
              const features = featureQueries[i]?.data
              return (
                <ProjectCard
                  key={p.id}
                  project={p}
                  stats={projectStats(features ?? [])}
                  loading={features === undefined}
                  onOpen={() => nav.enterProject(p.id)}
                />
              )
            })}

            <button
              className={OPEN_CARD}
              onClick={nav.showOpen}
            >
              <span className="mb-0.5 inline-flex text-accent-hi">
                <IconPlus size={16} />
              </span>
              <span className="text-base font-semibold">Open a project</span>
              <span className="text-xs text-text-4">Point runcastle at a local git repo</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
