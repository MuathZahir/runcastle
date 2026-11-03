import { StrictMode, useState } from 'react'
import type { ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource-variable/geist'
import '@fontsource-variable/geist-mono'
import '../src/theme.css'
import '../src/styles.css'
import { TooltipProvider } from '../src/ui/tooltip'
import { ToastProvider } from '../src/lib/toast'
import { DimLine, IconButton, cx } from '../src/ui'
import { PageTopbar } from '../src/ui/page'
import { FeaturePanel, PanelSplit, PanelToggle } from '../src/components/workspace/FeaturePanel'
import { FeatureStatusLine } from '../src/components/workspace/FeatureStatusLine'
import { IconMore, IconOrchestrator } from '../src/icons'
import { PANEL_VIEW_LABEL, type PanelView } from '../src/lib/feature-ui/panel'
import { nextWaiting, orderDesigns, type DesignEntry } from '../src/lib/feature-ui/designs'
import { applyStoredTheme, useTheme } from '../src/lib/theme'
import { ChatThread } from '../src/components/chat/thread/ChatThread'
import { Markdown } from '../src/components/Markdown'
import { PlanCard } from '../src/components/chat/thread/PlanCard'
import { DesignCards } from '../src/components/design/DesignCard'
import { DesignBar, DesignList } from '../src/components/design/DesignList'
import { DrivePanel } from '../src/components/review/DrivePanel'
import { installSilentEventSource } from '../../../.runcastle/preview/event-source'
import { CLOSING, DESIGNS, NOW, OPENING, PLAN_COUNTS, PLAN_ONE_LINER, TITLE } from './designs-data'

/**
 * The plan and the designs in their own place
 * (docs/features/designs-and-the-plan-get-their-own-place): the plan card and
 * the design cards a planning run leaves in the chat, the dot on the panel
 * toggle and the tabs, and the Design tab — its list, an open design, and the
 * empty tab with and without a design server from before the list. Pick the
 * state with `?state=`, or from the bar at the top. Cards, rows, Approve (on an open design) and
 * the arrows all work here on sample data. A dead end on purpose: links and
 * navigation do nothing.
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

const noop = () => {}

type Stage = 'chat' | 'list' | 'open' | 'done' | 'empty' | 'legacy'
const STAGES: { key: Stage; label: string }[] = [
  { key: 'chat', label: 'Cards in the chat' },
  { key: 'list', label: 'Design tab' },
  { key: 'open', label: 'An open design' },
  { key: 'done', label: 'All approved' },
  { key: 'empty', label: 'No designs yet' },
  { key: 'legacy', label: 'Older design server' },
]

/** A sample page standing in for the live design the server would serve. */
const LIVE_PAGE = `${location.origin}/preview/drive-sample-app.html`

function FeaturePage({ stage }: { stage: Stage }) {
  const none = stage === 'empty' || stage === 'legacy'
  const [designs, setDesigns] = useState<DesignEntry[]>(
    none ? [] : stage === 'done' ? DESIGNS.map((d) => ({ ...d, state: 'approved', isNew: false })) : DESIGNS,
  )
  const [planNew, setPlanNew] = useState(true)
  const [view, setView] = useState<PanelView | null>(stage === 'chat' ? null : 'design')
  const [openId, setOpenId] = useState<string | null>(stage === 'open' ? (orderDesigns(DESIGNS)[0]?.id ?? null) : null)
  // The one message the agent gets, once the last waiting design is approved (decision 25).
  const [told, setTold] = useState<string[] | null>(stage === 'done' ? DESIGNS.map((d) => d.title) : null)

  const ordered = orderDesigns(designs)
  const open = ordered.find((d) => d.id === openId)
  const designNew = designs.some((d) => d.isNew)
  const fresh: PanelView[] = [...(planNew ? (['plan'] as const) : []), ...(designNew ? (['design'] as const) : [])]

  const seen = (id: string) => setDesigns((ds) => ds.map((d) => (d.id === id ? { ...d, isNew: false } : d)))
  const openDesign = (id: string) => {
    setView('design')
    setOpenId(id)
    seen(id)
  }
  // Approve moves on to the next design still waiting (decision 24); the last
  // one goes back to the list and tells the agent, once (decision 25).
  const approve = (id: string) => {
    const next = nextWaiting(designs, id)
    const after = designs.map((d) => (d.id === id ? { ...d, state: 'approved' as const, isNew: false } : d))
    setDesigns(after)
    if (next) {
      openDesign(next.id)
      return
    }
    setOpenId(null)
    setTold(after.filter((d) => d.state === 'approved').map((d) => d.title))
  }
  const switchTo = (next: PanelView) => {
    setView(next)
    if (next === 'plan') setPlanNew(false)
    if (next === 'design') setOpenId(null)
  }

  const cards = (
    <div className="flex flex-col gap-3">
      <PlanCard oneLiner={PLAN_ONE_LINER} counts={none ? { ...PLAN_COUNTS, designs: 0 } : PLAN_COUNTS} isNew={planNew} onOpen={() => switchTo('plan')} />
      {!none && <DesignCards designs={designs} onOpen={openDesign} onOpenList={() => switchTo('design')} />}
      <Markdown source={CLOSING} size="base" tone="primary" breaks />
      {told && (
        <p className="m-0 flex min-w-0 items-center gap-2 text-sm text-text-tertiary animate-rise-in">
          <span className="grid size-5 shrink-0 place-items-center rounded-sm bg-accent-subtle text-accent-text">
            <IconOrchestrator size={12} />
          </span>
          <span className="min-w-0">
            <span className="font-medium text-text-secondary">Runcastle</span> · You approved all {told.length} designs: {told.join(', ')}.
          </span>
        </p>
      )}
    </div>
  )

  const designBody = open ? (
    <div className="flex h-full min-h-0 flex-col">
      <DesignBar
        design={open}
        index={ordered.indexOf(open)}
        count={ordered.length}
        othersWaiting={designs.filter((d) => d.state === 'waiting' && d.id !== open.id).length}
        onBack={() => setOpenId(null)}
        onStep={(to) => {
          const next = ordered[to]
          if (next) openDesign(next.id)
        }}
        onApprove={() => approve(open.id)}
      />
      <DrivePanel copy="chat" url={LIVE_PAGE} frameKey={open.id} onCapture={noop} {...(open.width ? { width: open.width } : {})} />
    </div>
  ) : (
    <DesignList
      designs={designs}
      now={NOW}
      onOpen={openDesign}
      {...(stage === 'legacy' ? { onOpenServer: noop } : {})}
    />
  )

  return (
    <section className="flex min-h-0 flex-1 flex-col overflow-clip rounded-lg border border-border-subtle bg-canvas" aria-label={TITLE}>
      <PageTopbar
        crumbs={[{ label: TITLE }]}
        trail
        status={
          <FeatureStatusLine
            status={{ kind: 'talking', label: designs.some((d) => d.state === 'waiting') ? 'Design to approve' : 'Talking with you' }}
          />
        }
        actions={
          <>
            <IconButton label="More — Merge & ship is here" icon={<IconMore />} />
            <PanelToggle open={view !== null} dot={fresh.length > 0} views={['plan', 'design']} onToggle={() => setView(view ? null : 'design')} />
          </>
        }
      />
      <PanelSplit
        chat={
          <div className="flex min-h-0 flex-1 flex-col">
            <ChatThread items={OPENING} state="idle" tail={cards} footer={<div className="h-4" />} />
          </div>
        }
        panel={
          view && (
            <FeaturePanel
              view={view}
              views={['plan', 'work', 'details', 'design']}
              fresh={fresh}
              label={(v) => PANEL_VIEW_LABEL[v]}
              onSwitch={switchTo}
              onCollapse={() => setView(null)}
              onClose={() => setView(null)}
            >
              {view === 'design' ? (
                designBody
              ) : (
                <div className="px-6 py-6">
                  <DimLine>The {PANEL_VIEW_LABEL[view]} tab, unchanged by this feature.</DimLine>
                </div>
              )}
            </FeaturePanel>
          )
        }
        share={0.5}
        collapsed={false}
        onResize={noop}
        onToggleFull={noop}
      />
    </section>
  )
}

function Page() {
  const [stage, setStage] = useState<Stage>(
    () => STAGES.find((s) => s.key === new URLSearchParams(location.search).get('state'))?.key ?? 'chat',
  )
  const theme = useTheme()
  const chip = (on: boolean) =>
    cx('h-6 shrink-0 cursor-pointer rounded-md px-2', on ? 'bg-surface-selected text-text' : 'hover:bg-surface-hover/50 hover:text-text-secondary')
  const bar = (children: ReactNode) => (
    <div className="flex h-10 shrink-0 items-center gap-1 overflow-x-auto border-b border-border-subtle px-3 text-xs whitespace-nowrap text-text-tertiary">
      {children}
    </div>
  )
  return (
    <div className="flex h-screen flex-col bg-canvas">
      {bar(
        <>
          {STAGES.map((s) => (
            <button key={s.key} type="button" onClick={() => setStage(s.key)} className={chip(s.key === stage)}>
              {s.label}
            </button>
          ))}
          <span className="ml-auto" />
          <button type="button" onClick={theme.toggle} className={chip(false)}>
            {theme.resolved === 'dark' ? 'Light' : 'Dark'}
          </button>
        </>,
      )}
      <div className="flex min-h-0 flex-1 p-3">
        <FeaturePage key={stage} stage={stage} />
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
