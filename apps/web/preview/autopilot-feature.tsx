import { StrictMode, useEffect, useRef, useState, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource-variable/geist'
import '@fontsource-variable/geist-mono'
import '../src/theme.css'
import '../src/styles.css'
import { TooltipProvider } from '../src/ui/tooltip'
import { ToastProvider } from '../src/lib/toast'
import { Button, cx } from '../src/ui'
import { PageTopbar, type Crumb } from '../src/ui/page'
import { ThreadItemView, opensTurn } from '../src/components/chat/thread/ChatThread'
import { Composer } from '../src/components/chat/thread/Composer'
import { OrchestratorNameContext } from '../src/components/chat/thread/FeatureCardItems'
import { FeatureStatusLine } from '../src/components/workspace/FeatureStatusLine'
import { FeatureActionsMenu, type FeatureAction } from '../src/components/FeatureActionsMenu'
import { PanelToggle } from '../src/components/workspace/FeaturePanel'
import { autopilotCrumb, epicCrumb } from '../src/components/SidebarEpics'
import { AutopilotLockNote, EndAutopilotDialog } from '../src/components/autopilot/AutopilotParts'
import { IconGitMerge, IconPlay, ProgressIcon } from '../src/icons'
import { applyStoredTheme } from '../src/lib/theme'
import type { FeatureStatus } from '../src/lib/feature-ui/status-line'
import { installSilentEventSource } from '../../../.runcastle/preview/event-source'
import { useDesignReport } from '../../../.runcastle/preview/design-report'
import { DESIGN_PANEL_CLEARANCE, DesignPanel, makeDeadEnd } from './autopilot-design-panel'
import { EPIC, EPIC_CHAT, FEATURE, LOCKED_FEATURES, STATES, itemsFor, type StateKey } from './autopilot-feature-data'

/**
 * Feature chat on autopilot (docs/features/epics-on-autopilot decisions 3, 8,
 * 16, 20, 22): the chat of "Checkout page" while its epic "Checkout flow" runs
 * it. The header reads "<epic> · Autopilot" where the plain epic crumb was,
 * and carries no Stop, Test drive or Merge; the lock note stands where the
 * message box was, with the way to the epic and "End autopilot"; the epic's
 * messages are signed with its name. The app's own header crumbs, thread rows,
 * composer, lock note and confirm over sample data: this page shows exactly
 * what the app does.
 *
 * States: ?state=locked-working | locked-idle | confirm-end | ended.
 */

applyStoredTheme()
installSilentEventSource()
makeDeadEnd()

const noop = () => {}

const params = new URLSearchParams(location.search)
const pickState = (): StateKey => STATES.find((s) => s.key === params.get('state'))?.key ?? 'locked-working'

const MENU: FeatureAction[] = [
  { key: 'copy-link', label: 'Copy link', onSelect: noop },
  { key: 'copy-branch', label: 'Copy branch name', onSelect: noop },
]

function statusFor(state: StateKey): FeatureStatus {
  return state === 'locked-working' ? { kind: 'working', label: 'Working' } : { kind: 'idle', label: 'Idle' }
}

function FeatureChat({ state, onEnd }: { state: StateKey; onEnd: () => void }) {
  const [draft, setDraft] = useState('')
  const [confirm, setConfirm] = useState(state === 'confirm-end')
  const scroller = useRef<HTMLDivElement>(null)
  const items = itemsFor(state)
  const locked = state !== 'ended'
  const working = state === 'locked-working'
  const chat = { ...EPIC_CHAT, state: working ? ('working' as const) : ('idle' as const) }

  useEffect(() => {
    const el = scroller.current
    if (el) el.scrollTop = el.scrollHeight
  }, [state])

  // Locked: "<epic> · Autopilot"; off autopilot, the plain epic crumb. The app's own crumbs.
  const epic: Crumb = locked ? autopilotCrumb({ epicId: EPIC.id, epicName: EPIC.title }, [chat], noop) : epicCrumb({ chatId: EPIC.id }, [chat], noop)!

  const foot: ReactNode = locked ? (
    <AutopilotLockNote epic={EPIC} working={working} onOpenEpic={noop} onEndAutopilot={() => setConfirm(true)} />
  ) : (
    <Composer value={draft} onChange={setDraft} state="idle" onSend={() => setDraft('')} placeholder="Message the lead" />
  )

  return (
    <section className="flex min-h-0 flex-1 flex-col overflow-clip rounded-lg border border-border-subtle bg-canvas" aria-label={FEATURE}>
      <PageTopbar
        crumbs={[
          epic,
          {
            label: FEATURE,
            shrink: true,
            icon: <ProgressIcon state="active" progress={working ? 0.6 : 1} size={14} label="" />,
          },
        ]}
        status={<FeatureStatusLine status={statusFor(state)} />}
        actions={
          <>
            {/* Locked: no Stop, Test drive or Merge — the epic drives and merges (decision 16). */}
            {!locked && (
              <span className="mr-1 flex gap-1.5">
                <Button size="sm" variant="primary" icon={<IconPlay />}>
                  Test drive
                </Button>
                <Button size="sm" variant="secondary" icon={<IconGitMerge />}>
                  Merge
                </Button>
              </span>
            )}
            <FeatureActionsMenu actions={MENU} size="md" />
            <PanelToggle open={false} views={['work', 'details']} onToggle={noop} />
          </>
        }
      />
      <div className="flex min-h-0 flex-1 flex-col bg-surface">
        <div
          ref={scroller}
          className="relative min-h-0 flex-1 overflow-y-auto px-6 [scrollbar-gutter:stable] [scrollbar-width:thin] [scrollbar-color:var(--color-border-strong)_transparent]"
        >
          {/* The epic's messages are signed with its name (decision 22), as the feature's chat column does. */}
          <OrchestratorNameContext.Provider value={EPIC.title}>
            <div className="mx-auto flex w-full max-w-(--content-max) flex-col pt-8">
              {items.map((item, i) => (
                <div key={item.id} className={cx('flex min-w-0 flex-col', i > 0 && (opensTurn(item) ? 'mt-10' : 'mt-3'))}>
                  <ThreadItemView item={item} locked={locked} />
                </div>
              ))}
              <div className="sticky bottom-0 mt-10 bg-[linear-gradient(to_bottom,transparent,var(--color-surface)_24px)] pt-6 pb-4">{foot}</div>
            </div>
          </OrchestratorNameContext.Provider>
        </div>
      </div>
      <EndAutopilotDialog open={confirm} epic={EPIC.title} features={LOCKED_FEATURES} onEnd={onEnd} onClose={() => setConfirm(false)} />
    </section>
  )
}

function Page() {
  const [state, setState] = useState<StateKey>(pickState)
  useDesignReport(state)
  const go = (k: StateKey) => {
    setState(k)
    history.replaceState(null, '', `?state=${k}`)
  }
  return (
    <div className="flex h-dvh flex-col bg-canvas">
      {/* Below ~1500px the states panel would sit over the lock note's "Open the epic": the page keeps its corner clear. */}
      <div className={cx('flex min-h-0 flex-1 p-3', DESIGN_PANEL_CLEARANCE)}>
        <FeatureChat key={state} state={state} onEnd={() => go('ended')} />
      </div>
      <DesignPanel states={STATES} state={state} onPick={go} />
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
