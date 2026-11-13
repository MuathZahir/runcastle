import { StrictMode, useEffect, useRef, useState, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource-variable/geist'
import '@fontsource-variable/geist-mono'
import '../src/theme.css'
import '../src/styles.css'
import { TooltipProvider } from '../src/ui/tooltip'
import { ToastProvider } from '../src/lib/toast'
import { Button, cx, LINK } from '../src/ui'
import { PageTopbar, type Crumb } from '../src/ui/page'
import { ThreadItemView, opensTurn } from '../src/components/chat/thread/ChatThread'
import { Composer } from '../src/components/chat/thread/Composer'
import { FeatureStatusLine } from '../src/components/workspace/FeatureStatusLine'
import { FeatureActionsMenu, type FeatureAction } from '../src/components/FeatureActionsMenu'
import { PanelToggle } from '../src/components/workspace/FeaturePanel'
import { EpicGlyph } from '../src/components/SidebarEpics'
import { AutopilotLockNote, AutopilotTrail, EndAutopilotDialog } from '../src/components/autopilot/AutopilotParts'
import { IconArrowRight, IconAutopilot, IconGitMerge, IconPlay, ProgressIcon } from '../src/icons'
import { epicStyle } from '../src/lib/epic-look'
import { applyStoredTheme } from '../src/lib/theme'
import type { FeatureStatus } from '../src/lib/feature-ui/status-line'
import { installSilentEventSource } from '../../../.runcastle/preview/event-source'
import { useDesignReport, useDesignTweaks } from '../../../.runcastle/preview/design-report'
import { DesignPanel, makeDeadEnd, type TweakSpec } from './autopilot-design-panel'
import { EPIC, FEATURE, LOCKED_FEATURES, STATES, itemsFor, type StateKey } from './autopilot-feature-data'

/**
 * Feature chat on autopilot (docs/features/epics-on-autopilot decisions 3, 8,
 * 16, 20): the chat of "Checkout page" while its epic "Checkout flow" runs it.
 * The header reads "<epic> · Autopilot" where the owner crumb was, and carries
 * no Stop, Test drive or Merge; the lock note stands where the message box was,
 * with the way to the epic and "End autopilot". The real header, thread rows,
 * composer, lock note and confirm over sample data.
 *
 * States: ?state=locked-working | locked-idle | confirm-end | ended.
 * Tweak: "Lock note" (card | bar).
 */

applyStoredTheme()
installSilentEventSource()
makeDeadEnd()

const noop = () => {}

const TWEAKS: TweakSpec[] = [
  {
    name: 'note',
    label: 'Lock note',
    options: [
      { value: 'card', label: 'Card' },
      { value: 'bar', label: 'Slim bar' },
    ],
  },
]

type Tweaks = { note: string }

const params = new URLSearchParams(location.search)
const pickState = (): StateKey => STATES.find((s) => s.key === params.get('state'))?.key ?? 'locked-working'

const MENU: FeatureAction[] = [
  { key: 'copy-link', label: 'Copy link', onSelect: noop },
  { key: 'copy-branch', label: 'Copy branch name', onSelect: noop },
]

/** The bar the "Slim bar" tweak shows in place of the shared card: one line, the same two ways out. */
function LockBar({ working, onOpenEpic, onEndAutopilot }: { working: boolean; onOpenEpic: () => void; onEndAutopilot: () => void }) {
  return (
    <div
      role="note"
      aria-label={`On autopilot: ${EPIC.title}`}
      style={epicStyle(EPIC.color)}
      className={cx(
        'flex h-11 items-center gap-2.5 rounded-lg pr-1.5 pl-3.5 text-sm',
        'bg-[color-mix(in_oklab,var(--epic)_9%,var(--color-surface-raised))]',
        'shadow-[inset_0_0_0_1px_color-mix(in_oklab,var(--epic)_30%,transparent)]',
      )}
    >
      <span aria-hidden className={cx('inline-flex shrink-0 text-(--epic-text)', working && '[&_[data-orbit]]:animate-[spin_6s_linear_infinite]')}>
        <IconAutopilot size={15} />
      </span>
      <span className="min-w-0 flex-1 truncate text-text-secondary">
        <span className="font-medium text-text">{EPIC.title}</span> runs this feature on autopilot
      </span>
      <button type="button" onClick={onEndAutopilot} className={cx(LINK, 'shrink-0 border-0 bg-transparent p-0')}>
        End autopilot
      </button>
      <Button size="sm" variant="ghost" icon={<IconArrowRight />} onClick={onOpenEpic} className="shrink-0">
        Open the epic
      </Button>
    </div>
  )
}

function statusFor(state: StateKey): FeatureStatus {
  return state === 'locked-working' ? { kind: 'working', label: 'Working' } : { kind: 'idle', label: 'Idle' }
}

function FeatureChat({ state, note, onEnd }: { state: StateKey; note: string; onEnd: () => void }) {
  const [draft, setDraft] = useState('')
  const [confirm, setConfirm] = useState(state === 'confirm-end')
  const scroller = useRef<HTMLDivElement>(null)
  const items = itemsFor(state)
  const locked = state !== 'ended'
  const working = state === 'locked-working'

  useEffect(() => {
    const el = scroller.current
    if (el) el.scrollTop = el.scrollHeight
  }, [state])

  const epicCrumb: Crumb = locked
    ? {
        // "<epic> · Autopilot", where the owner crumb was: the name gives way, the mark never does.
        label: <AutopilotTrail epic={EPIC} working={working} onOpenEpic={noop} />,
        icon: <EpicGlyph small color={EPIC.color} icon={EPIC.icon} />,
        shrink: true,
        floor: 'min-w-44',
      }
    : {
        // Off autopilot: the plain epic crumb, as any feature of an epic wears it.
        label: (
          <span className="block max-w-44 min-w-0 truncate" title={`Epic: ${EPIC.title}`}>
            {EPIC.title}
          </span>
        ),
        icon: <EpicGlyph small color={EPIC.color} icon={EPIC.icon} />,
        onClick: noop,
        shrink: true,
        floor: 'min-w-24',
      }

  let foot: ReactNode
  if (!locked) {
    foot = <Composer value={draft} onChange={setDraft} state="idle" onSend={() => setDraft('')} placeholder="Message the lead" />
  } else if (note === 'bar') {
    foot = <LockBar working={working} onOpenEpic={noop} onEndAutopilot={() => setConfirm(true)} />
  } else {
    foot = <AutopilotLockNote epic={EPIC} working={working} onOpenEpic={noop} onEndAutopilot={() => setConfirm(true)} />
  }

  return (
    <section className="flex min-h-0 flex-1 flex-col overflow-clip rounded-lg border border-border-subtle bg-canvas" aria-label={FEATURE}>
      <PageTopbar
        crumbs={[
          epicCrumb,
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
            <PanelToggle open={false} views={['plan', 'work', 'details']} onToggle={noop} />
          </>
        }
      />
      <div className="flex min-h-0 flex-1 flex-col bg-surface">
        <div
          ref={scroller}
          className="relative min-h-0 flex-1 overflow-y-auto px-6 [scrollbar-gutter:stable] [scrollbar-width:thin] [scrollbar-color:var(--color-border-strong)_transparent]"
        >
          <div className="mx-auto flex w-full max-w-(--content-max) flex-col pt-8">
            {items.map((item, i) => (
              <div key={item.id} className={cx('flex min-w-0 flex-col', i > 0 && (opensTurn(item) ? 'mt-10' : 'mt-3'))}>
                <ThreadItemView item={item} locked={locked} />
              </div>
            ))}
            <div className="sticky bottom-0 mt-10 bg-[linear-gradient(to_bottom,transparent,var(--color-surface)_24px)] pt-6 pb-4">{foot}</div>
          </div>
        </div>
      </div>
      <EndAutopilotDialog open={confirm} epic={EPIC.title} features={LOCKED_FEATURES} onEnd={onEnd} onClose={() => setConfirm(false)} />
    </section>
  )
}

function Page() {
  const [state, setState] = useState<StateKey>(pickState)
  const [tweaks, setTweak] = useDesignTweaks<Tweaks>({ note: 'card' })
  useDesignReport(state, tweaks)
  const go = (k: StateKey) => {
    setState(k)
    history.replaceState(null, '', `?state=${k}`)
  }
  return (
    <div className="flex h-dvh flex-col bg-canvas">
      <div className="flex min-h-0 flex-1 p-3">
        <FeatureChat key={state} state={state} note={tweaks.note} onEnd={() => go('ended')} />
      </div>
      <DesignPanel
        states={STATES}
        state={state}
        onPick={go}
        tweaks={TWEAKS}
        values={tweaks}
        onTweak={(name, value) => setTweak(name as keyof Tweaks, value)}
      />
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
