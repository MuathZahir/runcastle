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
import { applyStoredTheme } from '../src/lib/theme'
import type { FeatureListItem } from '../src/lib/api'
import type { WorkerEntry } from '../src/lib/workers'
import { installSilentEventSource } from '../../../.runcastle/preview/event-source'
import { featuresWith, mixed } from './workers-sidebar-data'
import { FrameChat, FrameSidebar, LEAD, needing, noop, OPEN_TITLE, SampleBar, workerActions } from './workers-frame'

/**
 * Clicking a feature opens its lead (docs/features/clicking-a-feature-opens-its-lead):
 * a feature row opens the feature with its lead's chat in front and the sidebar
 * stays on the features list. Its workers nest under its row
 * (workers-nest-under-their-feature); a worker that needs you says so on its
 * own row (decision 12).
 *
 * States: ?state=lead | worker-needs. Live in the sample: the "Sidebar
 * refresh" row (its lead) and its worker rows (their chats). Other rows are
 * sample only.
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

type Key = 'lead' | 'worker-needs'

const STATES: { key: Key; label: string }[] = [
  { key: 'lead', label: 'Lead in front' },
  { key: 'worker-needs', label: 'A worker needs you' },
]

/** The sample's workers with nobody waiting: the two that needed you are back at work. */
const calm: WorkerEntry[] = mixed.map((w) => (w.status === 'needs-you' ? { ...w, status: 'working' } : w))

interface View {
  workers: WorkerEntry[]
  current: string
}

function viewOf(key: Key): View {
  return { workers: key === 'lead' ? calm : mixed, current: LEAD }
}

function keyOf(v: View): Key {
  return needing(v.workers) > 0 ? 'worker-needs' : 'lead'
}

/** The open feature as the list has it: its need is the waiting worker's (`services/feature-need.ts`). */
function project(workers: readonly WorkerEntry[]): FeatureListItem[] {
  const waiting = workers.filter((w) => w.status === 'needs-you' || w.status === 'failed').sort((a, b) => b.updatedAt - a.updatedAt)[0]
  const now = Date.now()
  return featuresWith(0).map((f) => {
    if (f.title === OPEN_TITLE && waiting)
      return { ...f, need: { why: waiting.label, since: now - 4 * 60_000, threadId: waiting.id, by: 'agent' as const } }
    return f
  })
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

  // A feature row always opens the lead (decision 7); a worker row opens that worker.
  const onSelectFeature = (id: string) => {
    if (id === open.id) go({ ...view, current: LEAD })
  }

  return (
    <div className="flex h-screen flex-col bg-canvas">
      <SampleBar
        states={STATES}
        value={keyOf(view)}
        onPick={(k) => go(viewOf(k))}
        hint="“Sidebar refresh” and its worker rows are live; other rows are sample only"
      />
      <div className="flex min-h-0 flex-1">
        <div className="flex h-full w-[264px] shrink-0 flex-col overflow-hidden">
          <FrameSidebar
            workers={workers}
            features={features}
            onSelectFeature={onSelectFeature}
            current={current === LEAD ? null : current}
            onOpenWorker={(id) => go({ ...view, current: id })}
          />
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
