import { StrictMode, useState } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource-variable/geist'
import '@fontsource-variable/geist-mono'
import '../src/theme.css'
import '../src/styles.css'
import { TooltipProvider } from '../src/ui/tooltip'
import { ToastProvider } from '../src/lib/toast'
import { DimLine } from '../src/ui'
import { PageTopbar } from '../src/ui/page'
import { FeaturePanel, PanelSplit, PanelToggle } from '../src/components/workspace/FeaturePanel'
import { FeatureStatusLine } from '../src/components/workspace/FeatureStatusLine'
import { FeatureActionsMenu } from '../src/components/FeatureActionsMenu'
import { WorkerHeaderActions, WorkerStatusLine } from '../src/components/workers/WorkerParts'
import { FeatureSidebarPage } from '../src/components/workers/FeatureSidebarPage'
import { PANEL_VIEW_LABEL } from '../src/lib/feature-ui/panel'
import { applyStoredTheme } from '../src/lib/theme'
import type { WorkerEntry } from '../src/lib/workers'
import { installSilentEventSource } from '../../../.runcastle/preview/event-source'
import { featuresWith, mixed } from './workers-sidebar-data'
import {
  FrameChat,
  FrameSidebar,
  HEADER,
  LEAD,
  lead,
  leadActions,
  needing,
  noop,
  OPEN_TITLE,
  PREVIEW_SRC,
  SampleBar,
  workerActions,
} from './workers-frame'

/**
 * The drill-in sidebar (interactive-workers, third placement, on the human's
 * "I don't like two right-hand columns"): clicking a feature opens its chat and
 * swaps the left sidebar to the feature's own page, one level down, built as
 * the features list is: a header (back, the feature's title, "+" New worker),
 * the Lead card in the Orchestrator card's shape, the workers that need you,
 * the Working shelf, Done folded like Shipped. No rail; the panel stays the
 * one right column. States: ?state=mixed | panel-open | none |
 * list. Back and the open feature's row move between them live, with a short
 * slide down or up. A dead end otherwise.
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

type Key = 'mixed' | 'panel-open' | 'none' | 'list'

const STATES: { key: Key; label: string }[] = [
  { key: 'mixed', label: 'Mixed' },
  { key: 'panel-open', label: 'Panel open' },
  { key: 'none', label: 'No workers' },
  { key: 'list', label: 'Back on the list' },
]


interface View {
  /** Down in the feature's page, or up on the features list. */
  level: 'feature' | 'list'
  workers: WorkerEntry[]
  current: string
  panel: boolean
  motion: 'down' | 'up' | null
}

function viewOf(key: Key): View {
  if (key === 'none') return { level: 'feature', workers: [], current: LEAD, panel: false, motion: null }
  return { level: key === 'list' ? 'list' : 'feature', workers: mixed, current: HEADER, panel: key === 'panel-open', motion: null }
}

function keyOf(v: View): Key {
  if (v.level === 'list') return 'list'
  if (v.workers.length === 0) return 'none'
  return v.panel ? 'panel-open' : 'mixed'
}

function Page() {
  const asked = new URLSearchParams(location.search).get('state')
  const [view, setView] = useState<View>(() => viewOf(STATES.find((s) => s.key === asked)?.key ?? 'mixed'))
  const go = (next: View) => {
    setView(next)
    history.replaceState(null, '', `?state=${keyOf(next)}`)
  }
  const { workers, current, panel } = view
  const features = featuresWith(needing(workers))
  const open = features.find((f) => f.title === OPEN_TITLE)!
  const worker = workers.find((w) => w.id === current)

  const page =
    view.level === 'feature' ? (
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
        hint={view.level === 'list' ? 'Click “Sidebar refresh” to go back down' : 'The back chevron goes up · rows bring their chat to the front'}
      />
      <div className="flex min-h-0 flex-1">
        <div className="flex h-full w-[264px] shrink-0 flex-col overflow-hidden">
          <FrameSidebar
            workers={workers}
            features={features}
            onSelectFeature={(id) => id === open.id && go({ ...view, level: 'feature', motion: 'down' })}
            page={page}
            motion={view.motion}
          />
        </div>
        <section className="my-2 mr-2 flex min-w-0 flex-1 flex-col overflow-hidden rounded-lg border border-border bg-surface" aria-label={OPEN_TITLE}>
          <PageTopbar
            crumbs={[{ label: OPEN_TITLE }, { label: worker ? worker.label : 'Lead' }]}
            trail
            status={
              worker ? (
                <WorkerStatusLine status={worker.status} oldSideChat={worker.oldSideChat ?? false} {...(worker.failure ? { why: worker.failure } : {})} />
              ) : (
                <FeatureStatusLine status={{ kind: 'talking', label: 'Talking with you' }} />
              )
            }
            actions={
              <>
                {worker ? (
                  <WorkerHeaderActions
                    {...(worker.id === HEADER ? { onOpenPreview: noop } : {})}
                    {...(worker.status === 'needs-you' || worker.status === 'working' ? { onHandBack: noop } : {})}
                    menu={workerActions(worker)}
                  />
                ) : (
                  <FeatureActionsMenu actions={[{ key: 'copy-link', label: 'Copy link', onSelect: noop }]} label="Feature actions" />
                )}
                <PanelToggle open={panel} views={['design']} onToggle={() => go({ ...view, panel: !panel, motion: null })} />
              </>
            }
          />
          <PanelSplit
            chat={<FrameChat current={current} workers={workers} />}
            panel={
              panel && (
                <FeaturePanel
                  view="design"
                  views={['plan', 'design', 'details']}
                  label={(v) => PANEL_VIEW_LABEL[v]}
                  onSwitch={noop}
                  onCollapse={() => go({ ...view, panel: false, motion: null })}
                  onClose={() => go({ ...view, panel: false, motion: null })}
                >
                  <div className="flex min-h-0 flex-1 flex-col gap-3 p-4">
                    <DimLine>Design · the Header worker's preview</DimLine>
                    <img src={PREVIEW_SRC} alt="The Header worker's preview" className="w-full rounded-md ring-1 ring-border-subtle" />
                  </div>
                </FeaturePanel>
              )
            }
            share={0.42}
            collapsed={false}
            onResize={noop}
            onToggleFull={noop}
          />
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
