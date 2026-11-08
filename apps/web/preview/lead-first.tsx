import { StrictMode, useState } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource-variable/geist'
import '@fontsource-variable/geist-mono'
import '../src/theme.css'
import '../src/styles.css'
import { TooltipProvider } from '../src/ui/tooltip'
import { ToastProvider } from '../src/lib/toast'
import { PageTopbar } from '../src/ui/page'
import { FeatureStatusLine } from '../src/components/workspace/FeatureStatusLine'
import { FeatureActionsMenu } from '../src/components/FeatureActionsMenu'
import { WorkerHeaderActions, WorkerStatusLine } from '../src/components/workers/WorkerParts'
import { FeatureSidebarPage } from '../src/components/workers/FeatureSidebarPage'
import { applyStoredTheme } from '../src/lib/theme'
import { workerGroups } from '../src/lib/workers'
import type { FeatureListItem } from '../src/lib/api'
import type { WorkerEntry } from '../src/lib/workers'
import { installSilentEventSource } from '../../../.runcastle/preview/event-source'
import { featuresWith, mixed } from './workers-sidebar-data'
import { FrameChat, FrameSidebar, LEAD, lead, leadActions, needing, noop, OPEN_TITLE, SampleBar, workerActions } from './workers-frame'

/**
 * Clicking a feature opens its lead (docs/features/clicking-a-feature-opens-its-lead):
 * a feature row opens the feature with its lead's chat in front and the sidebar
 * stays on the features list; a quiet "3 ›" at the row's end goes down to the
 * feature's workers page, built as interactive-workers decision 24 left it.
 *
 * States: ?state=lead | worker-needs | workers. Live in the sample: the
 * "Sidebar refresh" row (its lead), its arrow (down)
 * and the workers page's back chevron (up). Other rows are sample only.
 * A dead end otherwise. A row always opens the lead, even one that says a
 * worker needs you (decision 7); the worker is reached through the pill.
 */

applyStoredTheme()
installSilentEventSource()
document.addEventListener(
  'click',
  (e) => {
    if ((e.target as Element | null)?.closest?.('a[href]')) e.preventDefault()
  },
  true,
)

type Key = 'lead' | 'worker-needs' | 'workers'

const STATES: { key: Key; label: string }[] = [
  { key: 'lead', label: 'Lead in front' },
  { key: 'worker-needs', label: 'A worker needs you' },
  { key: 'workers', label: 'Arrow pressed' },
]

/** The sample's workers with nobody waiting: the two that needed you are back at work. */
const calm: WorkerEntry[] = mixed.map((w) => (w.status === 'needs-you' ? { ...w, status: 'working' } : w))

interface View {
  level: 'list' | 'workers'
  workers: WorkerEntry[]
  current: string
  motion: 'down' | 'up' | null
}

function viewOf(key: Key): View {
  if (key === 'lead') return { level: 'list', workers: calm, current: LEAD, motion: null }
  if (key === 'worker-needs') return { level: 'list', workers: mixed, current: LEAD, motion: null }
  return { level: 'workers', workers: calm, current: LEAD, motion: null }
}

function keyOf(v: View): Key {
  if (v.level === 'workers') return 'workers'
  return needing(v.workers) > 0 ? 'worker-needs' : 'lead'
}

/** The open feature as the list has it: a worker's need named on its row (`services/feature-need.ts`, kind "worker"). */
function project(workers: readonly WorkerEntry[]): FeatureListItem[] {
  const waiting = workers.filter((w) => w.status === 'needs-you' || w.status === 'failed').sort((a, b) => b.updatedAt - a.updatedAt)[0]
  const now = Date.now()
  return featuresWith(0).map((f) => {
    if (f.title === OPEN_TITLE && waiting)
      return { ...f, need: { kind: 'worker', why: waiting.label, words: `${waiting.label} needs you`, held: false, since: now - 4 * 60_000, threadId: waiting.id } }
    return f
  })
}

/** Which other rows carry an arrow in the sample, and their live counts: one at work, one with everything handed back, one shipped. */
const OTHERS: Record<string, number> = {
  'Prepare reruns stale checks': 1,
  'Changelog file per release': 0,
  'Codex runtime': 0,
}

function Page() {
  const asked = new URLSearchParams(location.search).get('state')
  const [view, setView] = useState<View>(() => viewOf(STATES.find((s) => s.key === asked)?.key ?? 'lead'))
  const go = (next: View) => {
    setView(next)
    history.replaceState(null, '', `?state=${keyOf(next)}`)
  }
  const { workers, current } = view
  const features = project(workers)
  const open = features.find((f) => f.title === OPEN_TITLE)!
  const worker = workers.find((w) => w.id === current)
  const groups = workerGroups(workers)
  const live = groups.needsYou.length + groups.working.length

  const workersFor = (f: FeatureListItem) => {
    if (f.id === open.id) return { live, onOpen: () => go({ ...view, level: 'workers', motion: 'down' }) }
    const n = OTHERS[f.title]
    return n === undefined ? undefined : { live: n, onOpen: noop }
  }

  // A row always opens the lead, even one that says a worker needs you (decision 7): the pill leads to the worker.
  const onSelectFeature = (id: string) => {
    if (id === open.id) go({ ...view, current: LEAD, motion: null })
  }

  const page =
    view.level === 'workers' ? (
      <FeatureSidebarPage
        feature={open}
        leadStatus="Talking with you"
        onBack={() => go({ ...view, level: 'list', motion: 'up' })}
        onNewWorker={noop}
        lead={lead}
        workers={workers}
        current={current}
        onOpen={(id) => go({ ...view, current: id })}
        leadActions={leadActions}
        actionsFor={workerActions}
      />
    ) : undefined

  return (
    <div className="flex h-screen flex-col bg-canvas">
      <SampleBar
        states={STATES}
        value={keyOf(view)}
        onPick={(k) => go(viewOf(k))}
        hint={view.level === 'workers' ? 'The back chevron goes up to the list' : '“Sidebar refresh” and its arrow are live; other rows are sample only'}
      />
      <div className="flex min-h-0 flex-1">
        <div className="flex h-full w-[264px] shrink-0 flex-col overflow-hidden">
          <FrameSidebar workers={workers} features={features} onSelectFeature={onSelectFeature} page={page} motion={view.motion} workersFor={workersFor} />
        </div>
        <section className="my-2 mr-2 flex min-w-0 flex-1 flex-col overflow-hidden rounded-lg border border-border bg-surface" aria-label={OPEN_TITLE}>
          <PageTopbar
            crumbs={[{ label: OPEN_TITLE }, { label: worker ? worker.label : 'Lead' }]}
            trail
            status={
              worker ? (
                <WorkerStatusLine status={worker.status} {...(worker.old ? { old: worker.old } : {})} {...(worker.failure ? { why: worker.failure } : {})} />
              ) : (
                <FeatureStatusLine status={{ kind: 'talking', label: 'Talking with you' }} />
              )
            }
            actions={
              worker ? (
                <WorkerHeaderActions
                  {...(worker.status === 'needs-you' || worker.status === 'working' ? { onHandBack: noop } : {})}
                  menu={workerActions(worker)}
                />
              ) : (
                <FeatureActionsMenu actions={[{ key: 'copy-link', label: 'Copy link', onSelect: noop }]} label="Feature actions" />
              )
            }
          />
          <FrameChat current={current} workers={workers} />
        </section>
      </div>
    </div>
  )
}

const rootEl = document.getElementById('root')
if (!rootEl) throw new Error('#root not found')
createRoot(rootEl).render(
  <StrictMode>
    <TooltipProvider>
      <ToastProvider>
        <Page />
      </ToastProvider>
    </TooltipProvider>
  </StrictMode>,
)
