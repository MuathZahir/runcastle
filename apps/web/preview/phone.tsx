import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { StrictMode, useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource-variable/geist'
import '@fontsource-variable/geist-mono'
import '../src/theme.css'
import '../src/styles.css'
import { TooltipProvider } from '../src/ui/tooltip'
import { ToastProvider } from '../src/lib/toast'
import { cx, IconButton, List, ListRow, StatusDot, StatusLabel, Tabs } from '../src/ui'
import { OrchestratorCard, Shelf, SidebarBackdrop, SidebarFeatureRow, ThreadGlyph, WorkingShelf } from '../src/components/SidebarParts'
import { Markdown } from '../src/components/Markdown'
import { ChatThread } from '../src/components/chat/thread/ChatThread'
import { Composer } from '../src/components/chat/thread/Composer'
import { ContextMeter, ModelControls, PlanStrip } from '../src/components/chat/thread/ComposerParts'
import { ApprovalDock, QuestionDock } from '../src/components/chat/thread/AskDock'
import {
  IconArchive,
  IconArrowLeft,
  IconChevronDown,
  IconClock,
  IconDoc,
  IconGitMerge,
  IconList,
  IconMessage,
  IconMore,
  IconPen,
  IconPencil,
  IconPlus,
} from '../src/icons'
import { sidebarLanes } from '../src/lib/feature-ui'
import type { FeatureListItem } from '../src/lib/api'
import type { Effort, ThreadItem } from '../src/lib/chat-thread'
import { applyStoredTheme, useTheme } from '../src/lib/theme'
import { installSilentEventSource } from '../../../.runcastle/preview/event-source'
import { MODELS, MOMENTS, threads, type Moment, type MomentSample } from './chat-data'
import { STATES } from './review-package-data'
import { busyFeatures } from './sidebar-data'

/**
 * The phone view (docs/features/runcastle-on-your-phone): the list, a chat, and
 * what a chat opens, at a phone's width. The rows, thread, composer and review
 * package are the real components; the top bars, the sheets and the read-only
 * screens are the design. The strip on top is this preview's. A dead end on
 * purpose: nothing is sent, and there is no video behind the walkthrough.
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

const { pack } = STATES.driven
const realFetch = window.fetch.bind(window)
window.fetch = (input, init) => {
  const url = String(input)
  if (url.includes('/package.json')) return Promise.resolve(Response.json(pack))
  if (url.includes('/api/reviews/')) return Promise.resolve(Response.json([]))
  return realFetch(input, init)
}

const noop = () => {}
const params = new URLSearchParams(location.search)

const ORCHESTRATOR_ITEMS: ThreadItem[] = [
  { kind: 'user', id: 'u1', text: 'Is Export notes as PDF finished? Show me.' },
  { kind: 'review_package', id: 'p1', ticketId: pack.ticketId },
  { kind: 'agent', id: 'a1', text: 'Export notes as PDF is finished and the review looked at this build. It found one defect, on A5 paper. Merge it?', model: 'Opus 5.5' },
]

interface Open {
  title: string
  words: string
  moment: Moment
  ready?: boolean
  items?: ThreadItem[]
  /** Which of the chat's own screens this chat offers. */
  menu: Screen[]
  threads?: boolean
}

type Screen = 'plan' | 'tickets' | 'design'

const READY = 'Changelog file per release'
const QUESTION = 'Rounds see blockers outside the round'

function openOf(f: FeatureListItem): Open {
  const moment: Moment = f.title === QUESTION ? 'one-question' : f.workersWorking > 0 || f.liveSession?.status === 'live' ? 'working' : 'idle'
  return {
    title: f.title,
    words: f.title === READY ? 'Ready to test' : moment === 'working' ? 'Working' : moment === 'idle' ? 'In progress' : 'Waiting for you',
    moment,
    ready: f.title === READY,
    menu: f.title === QUESTION ? ['plan', 'tickets', 'design'] : ['plan', 'tickets'],
    threads: f.title === QUESTION,
  }
}

const ORCHESTRATOR: Open = { title: 'Orchestrator', words: 'Waiting for you', moment: 'idle', items: ORCHESTRATOR_ITEMS, menu: [], threads: true }

/** `?open=<words of a title>`, or `orchestrator`: a link straight into a chat. */
function linked(): Open | null {
  const words = params.get('open')?.toLowerCase()
  if (words === 'orchestrator') return ORCHESTRATOR
  const f = words ? busyFeatures.find((x) => x.title.toLowerCase().includes(words)) : undefined
  return f ? openOf(f) : null
}

/** A sheet rising from the foot: the phone's menu. Tapping outside closes it. */
function Sheet({ title, onClose, children }: { title?: string; onClose: () => void; children: ReactNode }) {
  return (
    <div className="absolute inset-0 z-50 flex flex-col justify-end">
      <button type="button" aria-label="Close" onClick={onClose} className="absolute inset-0 animate-backdrop-in cursor-pointer bg-scrim" />
      <div className="relative flex max-h-[70%] animate-rise-in flex-col rounded-t-lg border-t border-border bg-surface-raised pb-3">
        <span aria-hidden className="mx-auto mt-2 mb-1 h-1 w-9 shrink-0 rounded-full bg-border-strong" />
        {title && <div className="px-4 py-2 text-xs font-medium text-text-tertiary">{title}</div>}
        <div className="min-h-0 overflow-y-auto">{children}</div>
      </div>
    </div>
  )
}

/** One choice in a sheet: a whole-width row a thumb can hit. */
function SheetRow({ icon, label, hint, onClick }: { icon: ReactNode; label: string; hint?: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="flex min-h-13 w-full cursor-pointer items-center gap-3 px-4 py-2 text-left active:bg-surface-hover">
      <span className="inline-flex shrink-0 text-icon [&>svg]:size-5">{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-base text-text">{label}</span>
        {hint && <span className="block truncate text-xs text-text-tertiary">{hint}</span>}
      </span>
    </button>
  )
}

/** A full-screen page under the chat: the way back, what it is, its body. */
function ScreenBar({ title, sub, onBack, right }: { title: string; sub?: string; onBack: () => void; right?: ReactNode }) {
  return (
    <header className="flex h-13 shrink-0 items-center gap-1 border-b border-border-subtle bg-surface px-1.5">
      <IconButton label="Back" size="lg" icon={<IconArrowLeft />} onClick={onBack} />
      <div className="flex min-w-0 flex-1 flex-col px-1">
        <span className="truncate text-md font-medium text-text">{title}</span>
        {sub && <span className="truncate text-xs text-text-tertiary">{sub}</span>}
      </div>
      {right}
    </header>
  )
}

const DECISIONS = `## 1. Retries stay inside the round
**Decision:** A blocked ticket waits for its blocker within the round, and the round says so.
**Why:** The landing queue already holds the order.

## 2. A blocker outside the round stops the ticket
**Decision:** The ticket fails with the blocker's name, and the lead decides.
**Why:** Waiting on another round could wait forever.`

function PlanScreen({ open, onBack }: { open: Open; onBack: () => void }) {
  const [tab, setTab] = useState('decisions')
  return (
    <div className="flex h-full min-h-0 flex-col bg-surface">
      <ScreenBar title="Plan" sub={open.title} onBack={onBack} />
      <div className="flex h-11 shrink-0 items-center border-b border-border-subtle px-3">
        <Tabs size="sm" label="Plan" value={tab} onChange={setTab} items={[{ id: 'preview', label: 'Preview' }, { id: 'decisions', label: 'Decisions' }, { id: 'spec', label: 'Spec' }]} />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 text-base text-text">
        <Markdown source={tab === 'decisions' ? DECISIONS : 'The preview and the spec read the same way, the width of the phone.'} />
      </div>
    </div>
  )
}

const TICKETS = [
  { seq: 1, title: 'Rounds read blockers from every round', status: 'Landed', tone: 'success' },
  { seq: 2, title: 'A blocked ticket waits inside its round', status: 'Landed', tone: 'success' },
  { seq: 3, title: 'The round names what it waits on', status: 'Landed', tone: 'success' },
  { seq: 4, title: 'Fail a ticket whose blocker is outside', status: 'Failed', tone: 'danger' },
] as const

function TicketsScreen({ open, onBack }: { open: Open; onBack: () => void }) {
  return (
    <div className="flex h-full min-h-0 flex-col bg-surface">
      <ScreenBar title="Tickets" sub={`${open.title} · Round 1`} onBack={onBack} />
      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        <List divided label="Tickets">
          {TICKETS.map((t) => (
            <ListRow key={t.seq} title={t.title} wrap leading={<span className="text-xs text-text-tertiary tabular-nums">{t.seq}</span>} description={<StatusLabel tone={t.tone}>{t.status}</StatusLabel>} onClick={noop} />
          ))}
        </List>
      </div>
    </div>
  )
}

/** The live page: at the width it was designed for, or the phone's own. */
function DesignScreen({ open, onBack }: { open: Open; onBack: () => void }) {
  const [wide, setWide] = useState(true)
  const [box, setBox] = useState(390)
  const pageW = wide ? 1440 : box
  const scale = box / pageW
  return (
    <div className="flex h-full min-h-0 flex-col bg-surface">
      <ScreenBar
        title="Design"
        sub={open.title}
        onBack={onBack}
        right={
          <button type="button" onClick={() => setWide(!wide)} className="h-8 shrink-0 cursor-pointer rounded-md px-2 text-sm text-text-secondary">
            {wide ? 'Desktop' : 'Phone'}
          </button>
        }
      />
      <div
        className="relative min-h-0 flex-1 overflow-hidden bg-surface-inset"
        ref={(el) => {
          if (el && el.clientWidth !== box) setBox(el.clientWidth)
        }}
      >
        <iframe
          title="Design"
          src="/preview/chat.html"
          className="absolute top-0 left-0 origin-top-left border-0"
          style={{ width: pageW, height: `${100 / scale}%`, transform: `scale(${scale})` }}
        />
      </div>
      <p className="m-0 border-t border-border-subtle bg-surface px-4 py-2.5 text-xs text-text-tertiary">Tap around it. Say what to change in the chat.</p>
    </div>
  )
}

function ThreadsSheet({ onClose, onPick }: { onClose: () => void; onPick: () => void }) {
  return (
    <Sheet title="Threads" onClose={onClose}>
      <SheetRow icon={<IconPlus />} label="New thread" onClick={onClose} />
      {threads('idle')
        .slice(0, 3)
        .map((t) => (
          <button key={t.id} type="button" onClick={onPick} className="flex min-h-13 w-full cursor-pointer items-center gap-3 px-4 py-2 text-left active:bg-surface-hover">
            <ThreadGlyph state={t.state} />
            <span className="min-w-0 flex-1 truncate text-base text-text">{t.title}</span>
          </button>
        ))}
    </Sheet>
  )
}

function ChatScreen({ open, onBack }: { open: Open; onBack: () => void }) {
  const moment = MOMENTS.find((m) => m.key === open.moment) as MomentSample
  const [draft, setDraft] = useState('')
  const [model, setModel] = useState(MODELS[0].id)
  const [effort, setEffort] = useState<Effort>('high')
  const [fast, setFast] = useState(false)
  const [sheet, setSheet] = useState<'menu' | 'threads' | null>(() => (params.get('sheet') as 'menu' | 'threads' | null) ?? null)
  const [screen, setScreen] = useState<Screen | null>(() => (params.get('screen') as Screen | null) ?? null)
  const ask = moment.ask
  const waiting = open.words === 'Waiting for you' || open.ready
  if (screen === 'plan') return <PlanScreen open={open} onBack={() => setScreen(null)} />
  if (screen === 'tickets') return <TicketsScreen open={open} onBack={() => setScreen(null)} />
  if (screen === 'design') return <DesignScreen open={open} onBack={() => setScreen(null)} />
  const titleBody = (
    <>
      <span className="flex min-w-0 items-center gap-1">
        <span className="truncate text-md font-medium text-text">{open.title}</span>
        {open.threads && <IconChevronDown size={14} className="shrink-0 text-icon" />}
      </span>
      <span className="flex items-center gap-1.5 text-xs text-text-tertiary">
        {waiting && <StatusDot tone="warning" />}
        <span className={cx('truncate', open.words === 'Working' && 'text-shimmer')}>{open.words}</span>
      </span>
    </>
  )
  return (
    <div className="relative flex h-full min-h-0 flex-col bg-surface">
      <header className="flex h-13 shrink-0 items-center gap-1 border-b border-border-subtle bg-surface px-1.5">
        <IconButton label="Back to the list" size="lg" icon={<IconArrowLeft />} onClick={onBack} />
        {open.threads ? (
          <button type="button" onClick={() => setSheet('threads')} className="flex min-w-0 flex-1 cursor-pointer flex-col px-1 text-left">
            {titleBody}
          </button>
        ) : (
          <div className="flex min-w-0 flex-1 flex-col px-1">{titleBody}</div>
        )}
        {open.menu.length > 0 && <IconButton label="More" size="lg" icon={<IconMore />} onClick={() => setSheet('menu')} />}
      </header>
      <div className="relative flex min-h-0 flex-1 flex-col">
        <ChatThread
          items={open.items ?? moment.items}
          state={moment.state}
          actions={{ onEdit: noop, onBranch: noop, canUndoFiles: false }}
          emptyHint=""
          footer={
            <div className="flex flex-col gap-1.5">
              {open.ready && <p className="m-0 px-3 text-xs text-text-tertiary">Ready to test. The test drive is on your computer; you can still talk here.</p>}
              {ask?.kind === 'approval' ? (
                <ApprovalDock call={ask.call} onAnswer={noop} />
              ) : ask?.kind === 'question' ? (
                <QuestionDock questions={ask.questions} onAnswer={noop} />
              ) : (
                <Composer
                  value={draft}
                  onChange={setDraft}
                  state={moment.state}
                  onSend={() => setDraft('')}
                  onStop={noop}
                  placeholder="Message the agent"
                  top={<PlanStrip plan={moment.plan ?? []} tasks={[]} onStopTask={noop} />}
                  meter={<ContextMeter context={{ used: 84_000, size: 200_000 }} limits={[]} onCompact={noop} />}
                  footer={moment.state === 'working' ? undefined : <ModelControls runtime="claude-code" models={MODELS} model={model} onModel={setModel} effort={effort} onEffort={setEffort} fast={fast} onFast={setFast} />}
                  workingSince={moment.state === 'working' ? Date.now() - 74_000 : undefined}
                />
              )}
            </div>
          }
        />
      </div>
      {sheet === 'threads' && <ThreadsSheet onClose={() => setSheet(null)} onPick={() => setSheet(null)} />}
      {sheet === 'menu' && (
        <Sheet onClose={() => setSheet(null)}>
          {open.menu.includes('plan') && <SheetRow icon={<IconDoc />} label="Plan" hint="Decisions and spec, to read" onClick={() => setScreen('plan')} />}
          {open.menu.includes('tickets') && <SheetRow icon={<IconList />} label="Tickets" hint="3 of 4 landed" onClick={() => setScreen('tickets')} />}
          {open.menu.includes('design') && <SheetRow icon={<IconPen />} label="Design" hint="Running now" onClick={() => setScreen('design')} />}
        </Sheet>
      )}
    </div>
  )
}

function FeatureList({ onOpen }: { onOpen: (o: Open) => void }) {
  const { inbox, lanes } = sidebarLanes(busyFeatures)
  const pick = (key: string) => lanes.find((g) => g.key === key)?.features ?? []
  const needs = [...inbox, ...pick('inProgress')]
  const row = (f: FeatureListItem, nested = false) => (
    <SidebarFeatureRow key={f.id} f={f} active={false} onSelect={() => onOpen(openOf(f))} actions={[]} nested={nested} />
  )
  return (
    <div className="flex flex-col gap-5">
      <section aria-label="Needs you" className="flex flex-col gap-1">{needs.map((f) => row(f))}</section>
      <WorkingShelf features={pick('agentWorking')} renderRow={row} />
      <div className="flex flex-col divide-y divide-border-subtle">
        <Shelf icon={<IconClock />} label="Up next" features={pick('upNext')} renderRow={(f) => row(f)} defaultOpen />
        <Shelf icon={<IconList />} label="Backlog" features={pick('drafts')} renderRow={(f) => row(f)} />
        <Shelf icon={<IconGitMerge />} label="Shipped" features={pick('shipped')} renderRow={(f) => row(f)} cap={5} />
        <Shelf icon={<IconArchive />} label="Archived" features={busyFeatures.filter((f) => f.status === 'archived')} renderRow={(f) => row(f)} />
      </div>
    </div>
  )
}

function ListScreen({ onOpen, offline }: { onOpen: (o: Open) => void; offline: boolean }) {
  const [create, setCreate] = useState(() => params.get('sheet') === 'create')
  return (
    <div className="relative isolate flex h-full min-h-0 flex-col bg-canvas p-2">
      <SidebarBackdrop />
      <div className="flex h-11 shrink-0 items-center gap-1 px-1">
        <button type="button" className="flex h-9 min-w-0 cursor-pointer items-center gap-1.5 rounded-md px-2 text-lg font-medium text-text">
          <span className="truncate">runcastle</span>
          <IconChevronDown size={14} className="text-icon" />
        </button>
        <span className="ml-auto">
          <IconButton label="New" size="lg" icon={<IconPlus />} onClick={() => setCreate(true)} />
        </span>
      </div>
      {offline && (
        <div role="status" className="mx-1 mt-1 flex items-start gap-2.5 rounded-lg bg-danger-subtle px-3 py-2.5">
          <span className="mt-1.5"><StatusDot tone="danger" /></span>
          <span className="min-w-0 text-sm text-text">
            Can’t reach your computer. It may be asleep, or Tailscale is off on this phone. This list is from 12 minutes ago.
          </span>
        </div>
      )}
      <div className="mt-2">
        <OrchestratorCard status="Waiting for you · 2 notes" state="waiting" active={false} onOpen={() => onOpen(ORCHESTRATOR)} actions={[]} />
      </div>
      <div className="-mx-2 mt-4 min-h-0 flex-1 overflow-y-auto px-2 pb-2">
        <FeatureList onOpen={onOpen} />
      </div>
      {create && (
        <Sheet onClose={() => setCreate(false)}>
          <SheetRow icon={<IconMessage />} label="New chat" hint="Talk to the Orchestrator" onClick={() => setCreate(false)} />
          <SheetRow icon={<IconPencil />} label="Jot a note" hint="What you just noticed — triage it later" onClick={() => setCreate(false)} />
        </Sheet>
      )}
    </div>
  )
}

function Phone({ offline }: { offline: boolean }) {
  const [open, setOpen] = useState<Open | null>(() => linked())
  useEffect(() => {
    if (!params.has('package')) return
    const timer = setTimeout(() => document.querySelector<HTMLElement>('[aria-label="Open the review package"]')?.click(), 1500)
    return () => clearTimeout(timer)
  }, [])
  if (!open) return <ListScreen onOpen={setOpen} offline={offline} />
  return <ChatScreen key={open.title} open={open} onBack={() => setOpen(null)} />
}

const client = new QueryClient()

function Page() {
  const [offline, setOffline] = useState(() => params.has('offline'))
  const theme = useTheme()
  const chip = (on: boolean) => cx('h-6 shrink-0 cursor-pointer rounded-md px-2', on ? 'bg-surface-selected text-text' : 'text-text-tertiary')
  return (
    <div className="flex h-dvh flex-col bg-canvas">
      <div className="flex h-8 shrink-0 items-center gap-1 overflow-x-auto border-b border-border-subtle px-2 text-xs whitespace-nowrap">
        <span className="px-1 text-text-tertiary">Preview</span>
        <button type="button" onClick={() => setOffline(!offline)} className={chip(offline)}>
          Computer unreachable
        </button>
        <button type="button" onClick={theme.toggle} className={cx(chip(false), 'ml-auto')}>
          {theme.resolved === 'dark' ? 'Light' : 'Dark'}
        </button>
      </div>
      <div className="relative min-h-0 flex-1">
        <Phone offline={offline} />
      </div>
    </div>
  )
}

const rootEl = document.getElementById('root')
if (!rootEl) throw new Error('#root not found')
createRoot(rootEl).render(
  <StrictMode>
    <QueryClientProvider client={client}>
      <TooltipProvider>
        <ToastProvider>
          <Page />
        </ToastProvider>
      </TooltipProvider>
    </QueryClientProvider>
  </StrictMode>,
)
