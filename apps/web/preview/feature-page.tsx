import { StrictMode, useState } from 'react'
import type { ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource-variable/geist'
import '@fontsource-variable/geist-mono'
import '../src/theme.css'
import '../src/styles.css'
import { TooltipProvider } from '../src/ui/tooltip'
import { ToastProvider } from '../src/lib/toast'
import { Button, cx, DimLine, IconButton } from '../src/ui'
import { PageTopbar } from '../src/ui/page'
import { FeatureStatusLine } from '../src/components/workspace/FeatureStatusLine'
import { FeaturePanel, PanelSplit, PanelToggle } from '../src/components/workspace/FeaturePanel'
import { TicketLedger } from '../src/components/bodies/tickets/TicketLedger'
import { IconMore, IconPlay, IconStop, ProgressIcon } from '../src/icons'
import { PANEL_VIEW_LABEL, type PanelView } from '../src/lib/feature-ui/panel'
import { applyStoredTheme, useTheme } from '../src/lib/theme'
import { installSilentEventSource } from '../../../.runcastle/preview/event-source'
import { MOMENTS, roster, tickets, TITLE, type Moment, type MomentSample } from './feature-page-data'

/**
 * The feature page once tickets and review are tools, not phases
 * (docs/features/tickets-and-review-are-tools-not-phases): the header's status
 * line with no Go, and the panel's fixed views (Plan, Tickets, Run, Review,
 * Outcome) in place of the one phase-keyed body. Composed from the real header,
 * status line, panel and ticket ledger over sample data. A dead end on purpose:
 * links and navigation do nothing here.
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

/** The glyph left of the title: the landed share of the feature's tickets (decision 9). */
function TitleGlyph({ moment }: { moment: MomentSample }) {
  return (
    <ProgressIcon
      state={moment.status.kind === 'merged' ? 'shipped' : 'active'}
      progress={moment.progress}
      size={14}
      label=""
    />
  )
}

function viewLabel(view: PanelView): string {
  return PANEL_VIEW_LABEL[view]
}

/** What each view holds. Only Tickets is drawn for real: the others are today's bodies, unchanged. */
function ViewBody({ view, moment }: { view: PanelView; moment: MomentSample }) {
  if (view === 'work' && moment.ledger)
    return (
      <div className="px-6 py-6">
        <h2 className="m-0 mb-2 text-lg font-semibold text-text">Work</h2>
        <TicketLedger tickets={tickets(moment.ledger)} rounds={moment.ledger === 'pending' ? [] : [{ round: 1, ticketSeqs: [1, 2, 3] }]} roster={roster} docs={[]} sandbox="docker" defaultModel="claude-sonnet-5-5" onModel={noop} onBulkModel={noop} onCancel={noop} />
        <p className="mt-4 text-sm text-text-tertiary">
          {moment.ledger === 'burning'
            ? 'A running ticket opens its live log here — today’s Run view, folded into Work.'
            : 'No Go here: the agent asks in the chat, and starts the round when you say yes.'}
        </p>
      </div>
    )
  const today: Record<string, string> = {
    plan: 'The plan preview, with the decisions and the spec one click away inside it.',
    work: 'Nothing yet: tickets appear here when the agent makes them.',
    review: 'Ready declarations, the review’s findings and evidence — and what shipped, once merged.',
    drive: 'The test drive, while it runs.',
    design: 'The design server, while it runs.',
    details: 'Timeline, branch, sessions.',
  }
  return (
    <div className="px-6 py-6">
      <DimLine>{today[view] ?? ''}</DimLine>
    </div>
  )
}

function ChatColumn({ moment }: { moment: MomentSample }) {
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 p-4">
      <div className="flex min-h-0 flex-1 flex-col justify-end rounded-md bg-surface p-4 font-mono text-sm text-text-secondary ring-1 ring-inset ring-border-subtle">
        <p className="m-0 text-text-tertiary">● {moment.said}</p>
        <p className="m-0 mt-4 text-text-tertiary">&gt; ▏</p>
      </div>
    </div>
  )
}

function FeaturePage({ moment }: { moment: MomentSample }) {
  const [view, setView] = useState<PanelView | null>(moment.open)
  const shown = view && moment.views.includes(view) ? view : null
  return (
    <section className="flex min-h-0 flex-1 flex-col overflow-clip border border-border-subtle bg-canvas" aria-label={TITLE}>
      <PageTopbar
        crumbs={[{ label: TITLE, icon: <TitleGlyph moment={moment} /> }]}
        status={<FeatureStatusLine status={moment.status} />}
        actions={
          <>
            {moment.action && (
              <span className="mr-1 flex">
                <Button size="sm" variant={moment.action.danger ? 'danger' : 'primary'} icon={moment.action.danger ? <IconStop /> : <IconPlay />}>
                  {moment.action.label}
                </Button>
              </span>
            )}
            <IconButton label="More — Merge & ship is here" icon={<IconMore />} />
            <PanelToggle open={!!shown} views={moment.views} onToggle={() => setView(shown ? null : moment.open)} />
          </>
        }
      />
      <PanelSplit
        chat={<ChatColumn moment={moment} />}
        panel={
          shown && (
            <FeaturePanel view={shown} views={moment.views} label={viewLabel} onSwitch={setView} onCollapse={() => setView(null)} onClose={() => setView(null)}>
              <ViewBody view={shown} moment={moment} />
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
  const [moment, setMoment] = useState<Moment>('asking')
  const theme = useTheme()
  const current = MOMENTS.find((m) => m.key === moment) ?? MOMENTS[0]
  const bar = (children: ReactNode) => (
    <div className="flex h-10 shrink-0 items-center gap-3 border-b border-border-subtle px-3 text-xs text-text-tertiary">{children}</div>
  )
  return (
    <div className="flex h-screen flex-col bg-canvas">
      {bar(
        <>
          <span>Moment</span>
          {MOMENTS.map((m) => (
            <button key={m.key} type="button" onClick={() => setMoment(m.key)} className={cx('h-6 cursor-pointer rounded-md px-2', m.key === moment ? 'bg-surface-selected text-text' : 'hover:bg-surface-hover/50 hover:text-text-secondary')}>
              {m.label}
            </button>
          ))}
          <button type="button" onClick={theme.toggle} className="h-6 cursor-pointer rounded-md px-2 hover:bg-surface-hover/50 hover:text-text-secondary">
            {theme.resolved === 'dark' ? 'Light theme' : 'Dark theme'}
          </button>
          <span className="ml-auto">Open the panel’s view menu to see which views each moment offers</span>
        </>,
      )}
      <div className="flex min-h-0 flex-1 p-4">
        <FeaturePage key={moment} moment={current} />
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
