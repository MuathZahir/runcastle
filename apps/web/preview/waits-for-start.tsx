import { StrictMode, useEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource-variable/geist'
import '@fontsource-variable/geist-mono'
import '../src/theme.css'
import '../src/styles.css'
import { TooltipProvider } from '../src/ui/tooltip'
import { ToastProvider } from '../src/lib/toast'
import { IconButton, cx } from '../src/ui'
import { PageTopbar } from '../src/ui/page'
import { IconMore } from '../src/icons'
import { applyStoredTheme, useTheme } from '../src/lib/theme'
import { useIsPhone } from '../src/lib/use-phone'
import type { ContextUsage, Effort, ThreadItem, ThreadState } from '../src/lib/chat-thread'
import { ChatThread } from '../src/components/chat/thread/ChatThread'
import { Composer } from '../src/components/chat/thread/Composer'
import { ContextMeter, ModelControls } from '../src/components/chat/thread/ComposerParts'
import { FeatureStatusLine } from '../src/components/workspace/FeatureStatusLine'
import { StartAgent, type StartAgentPress } from '../src/components/workspace/StartAgent'
import { installSilentEventSource } from '../../../.runcastle/preview/event-source'
import { LIMITS, MODELS } from './chat-data'
import { AFTER_FIRST, BRANCH, FIRST_WORDS, FRESH, REFUSAL, TITLE, firstWork } from './waits-for-start-data'

/**
 * A new feature waits for Start (docs/features/a-new-feature-waits-for-start,
 * decisions 3, 6, 7, 8): a never-run feature's main chat, opened. Nothing has
 * started; the empty chat offers Start (the agent reads its brief, explores and
 * speaks first) and a quiet Plan it yourself beside it, and the composer waits
 * locked under them.
 *
 * States: ?state=waiting | starting | refused | started. Pressing Start goes
 * waiting → starting → started on canned data. A dead end: links do nothing.
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

type Key = 'waiting' | 'starting' | 'refused' | 'started'

const STATES: { key: Key; label: string }[] = [
  { key: 'waiting', label: 'Waiting' },
  { key: 'starting', label: 'Starting' },
  { key: 'refused', label: 'Refused' },
  { key: 'started', label: 'Started' },
]

const params = new URLSearchParams(location.search)
const pick = <T extends string>(name: string, of: readonly T[], fallback: T): T => {
  const v = params.get(name)
  return of.find((x) => x === v) ?? fallback
}

/** Where the page stands: what the chat shows, and which button is in flight. */
interface View {
  key: Key
  items: ThreadItem[]
  state: ThreadState
  context: ContextUsage
  pressed?: StartAgentPress
  refusal?: string
  since?: number
}

function viewOf(key: Key): View {
  if (key === 'starting') return { key, items: [], state: 'idle', context: FRESH, pressed: 'start' }
  if (key === 'refused') return { key, items: [], state: 'idle', context: FRESH, refusal: REFUSAL }
  if (key === 'started') return { key, items: [firstWork(5, false, 41), FIRST_WORDS], state: 'idle', context: AFTER_FIRST }
  return { key, items: [], state: 'idle', context: FRESH }
}

function ChatColumn({ view, setView }: { view: View; setView: (v: View) => void }) {
  const [draft, setDraft] = useState('')
  const [model, setModel] = useState(MODELS[0].id)
  const [effort, setEffort] = useState<Effort>('high')
  const [fast, setFast] = useState(false)
  const timers = useRef<number[]>([])
  useEffect(() => () => timers.current.forEach(clearTimeout), [])
  const later = (ms: number, f: () => void) => timers.current.push(window.setTimeout(f, ms))

  const waiting = view.key !== 'started'

  /** Start, felt: busy for a moment, then the agent's first turn arrives step by step. */
  const start = () => {
    setView({ ...viewOf('starting') })
    history.replaceState(null, '', address('starting'))
    later(1500, () => {
      const since = Date.now()
      setView({ key: 'started', items: [firstWork(0, true)], state: 'working', context: FRESH, since })
      history.replaceState(null, '', address('started'))
      for (let i = 1; i <= 4; i++) later(i * 550, () => setView({ key: 'started', items: [firstWork(i, true)], state: 'working', context: FRESH, since }))
      later(5 * 550 + 300, () => setView({ ...viewOf('started'), items: [firstWork(5, false, 4), FIRST_WORDS] }))
    })
  }
  /** Plan it yourself, felt: it shows busy; what the run does next is not this page's. */
  const planAlone = () => setView({ ...viewOf('waiting'), key: 'starting', pressed: 'selfPlan' })

  const meter = <ContextMeter context={view.context} limits={LIMITS} plan="Claude Max" onCompact={() => {}} />
  const pickers = (
    <ModelControls runtime="claude-code" models={MODELS} model={model} onModel={setModel} effort={effort} onEffort={setEffort} fast={fast} onFast={setFast} />
  )

  const empty = <StartAgent onStart={start} onPlanItYourself={planAlone} starting={view.pressed} refusal={view.refusal} />

  const composer = (
    <Composer
      value={draft}
      onChange={setDraft}
      state={view.state}
      locked={waiting}
      onSend={() => {
        setView({ ...view, items: [...view.items, { kind: 'user', id: `u${Date.now()}`, text: draft.trim() }] })
        setDraft('')
      }}
      onStop={() => {}}
      autoFocus={!waiting}
      meter={meter}
      footer={pickers}
      {...(view.since ? { workingSince: view.since } : {})}
    />
  )

  return (
    <div className="relative flex min-h-0 flex-1 flex-col bg-surface">
      <ChatThread
        items={view.items}
        state={view.state}
        actions={{ canUndoFiles: true }}
        empty={empty}
        footer={
          <div className="flex flex-col gap-1.5">
            {composer}
            <span className="px-4 text-xs text-text-tertiary">Feature worktree · {BRANCH}</span>
          </div>
        }
      />
    </div>
  )
}

function address(key: Key): string {
  return `?state=${key}`
}

/** The design page's own controls: the states and the theme. Not part of the app. */
function DesignPanel({ value, onPick }: { value: Key; onPick: (k: Key) => void }) {
  const theme = useTheme()
  const [open, setOpen] = useState(params.get('panel') !== 'folded')
  const pill = (on: boolean) =>
    on
      ? 'h-6 cursor-pointer rounded-md bg-surface-selected px-2 text-text'
      : 'h-6 cursor-pointer rounded-md px-2 hover:bg-surface-hover hover:text-text-secondary'
  return (
    <div
      style={{ position: 'fixed', right: 12, top: 64, width: open ? 248 : undefined, zIndex: 1000 }}
      className="flex flex-col gap-1 rounded-lg bg-surface-raised p-1 text-xs text-text-tertiary shadow-popover"
    >
      <button type="button" onClick={() => setOpen(!open)} className={cx(pill(false), 'text-left')}>
        Design · states {open ? '–' : '+'}
      </button>
      {open && (
        <>
          <div className="flex flex-wrap items-center gap-1">
            {STATES.map((s) => (
              <button key={s.key} type="button" aria-pressed={s.key === value} onClick={() => onPick(s.key)} className={pill(s.key === value)}>
                {s.label}
              </button>
            ))}
            <button type="button" onClick={theme.toggle} className={pill(false)}>
              {theme.resolved === 'dark' ? 'Light theme' : 'Dark theme'}
            </button>
          </div>
        </>
      )}
    </div>
  )
}

function Page() {
  const [view, setView] = useState<View>(() => viewOf(pick('state', STATES.map((s) => s.key), 'waiting')))
  const [run, setRun] = useState(0)
  const phone = useIsPhone()
  const go = (k: Key) => {
    setView(viewOf(k))
    setRun((r) => r + 1)
    history.replaceState(null, '', address(k))
  }
  return (
    <div className={cx('flex h-dvh flex-col bg-canvas', !phone && 'p-3')}>
      <section
        className={cx('flex min-h-0 flex-1 flex-col overflow-clip bg-surface', !phone && 'rounded-lg border border-border-subtle')}
        aria-label={TITLE}
      >
        <PageTopbar
          crumbs={[{ label: TITLE }, { label: 'Lead' }]}
          trail
          status={<FeatureStatusLine status={{ kind: 'talking', label: 'Talking with you' }} />}
          actions={<IconButton label="More — Merge & ship is here" icon={<IconMore />} />}
        />
        <ChatColumn key={run} view={view} setView={setView} />
      </section>
      <DesignPanel value={view.key} onPick={go} />
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
