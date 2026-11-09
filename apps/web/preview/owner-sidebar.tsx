import { StrictMode, useState } from 'react'
import type { ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource-variable/geist'
import '@fontsource-variable/geist-mono'
import '../src/theme.css'
import '../src/styles.css'
import { TooltipProvider } from '../src/ui/tooltip'
import { ToastProvider } from '../src/lib/toast'
import { cx } from '../src/ui'
import {
  HoldMark,
  OrchestratorCard,
  SidebarBackdrop,
  SidebarFeatureRow,
  SidebarThreadRow,
  ThreadGlyph,
  WorkingShelf,
} from '../src/components/SidebarParts'
import { sidebarLanes } from '../src/lib/feature-ui'
import { heldFeatures } from '../src/lib/sidebar-threads'
import type { FeatureListItem } from '../src/lib/api'
import type { ThreadEntry, ThreadState } from '../src/lib/chat-thread'
import { applyStoredTheme } from '../src/lib/theme'
import { installSilentEventSource } from '../../../.runcastle/preview/event-source'
import { listItem as fixture } from '../test/fixtures'
import { Switcher, stateFromAddress, stopLinks } from './owner-switcher'

/**
 * Where the yellow dot goes when every feature has one owner
 * (docs/features/every-feature-has-one-owner, decisions 8, 15, 16, 17): the
 * project sidebar's Orchestrator card, open on its two chats, over the
 * feature rows, all real SidebarParts over sample data and the real lanes.
 * The dot sits on the thing you click to answer: the chat row when the chat
 * asks, the feature row only when the feature itself waits on you. States at
 * ?state=. A dead end: nothing navigates.
 *
 * The one piece composed here: a chat row's second line ("Asking about …").
 * The real `SidebarThreadRow` is one line, and the two-line row it would grow
 * from (`TwoLineRow`) is private to SidebarParts, so `AskingThreadRow` below
 * draws the thread row's own columns with a 12px line under the title.
 */

applyStoredTheme()
installSilentEventSource()
stopLinks()

const now = Date.now()
const MIN = 60_000
const NOTES = 'thread_notes'
const LANDING = 'thread_landing'
const OWNED = 'Every feature has one owner'

type Key = 'asking' | 'handed-back' | 'yours' | 'consulting' | 'quiet-hour'

const STATES: { key: Key; label: string }[] = [
  { key: 'asking', label: 'Chat asking' },
  { key: 'handed-back', label: 'Handed back' },
  { key: 'yours', label: 'Yours' },
  { key: 'consulting', label: 'Yours, asking its chat' },
  { key: 'quiet-hour', label: 'Quiet hour' },
]

/** The test fixture keeps only some fields; the rest of a sample row is laid back over it. */
const listItem = (over: Partial<FeatureListItem>): FeatureListItem => ({ ...fixture(over), ...over })

const ticketCounts = (total: number, done: number) => ({ total, pending: total - done, burning: 0, done, failed: 0, cancelled: 0 })

/** The feature the states are about, as each state leaves it. */
function owned(key: Key): FeatureListItem {
  const base = { id: 'f_owned', slug: 'every-feature-has-one-owner', title: OWNED, ticketCounts: ticketCounts(4, 1), lastActivityAt: now - 6 * MIN }
  const need = (kind: 'handback' | 'test' | 'plan', words: string, held: boolean) => ({ kind, words, held, since: now - 6 * MIN })
  switch (key) {
    case 'asking':
      return listItem({ ...base, heldBy: NOTES, need: need('handback', `With Notes triage · asking you`, true) })
    case 'handed-back':
      return listItem({ ...base, heldBy: NOTES, ticketCounts: ticketCounts(4, 4), need: need('test', 'With Notes triage · Ready to test', true) })
    case 'yours':
      return listItem({ ...base, ticketCounts: ticketCounts(0, 0), need: need('plan', 'Plan to approve', false) })
    case 'consulting':
      return listItem({ ...base, need: need('handback', 'Asking Notes triage · Should export share the print styles?', true) })
    case 'quiet-hour':
      return listItem({ ...base, heldBy: NOTES, ticketCounts: ticketCounts(0, 0), lastActivityAt: now - 64 * MIN, need: need('plan', 'Handed back · Plan ready for your yes', false) })
  }
}

/**
 * A second feature Notes triage owns, also handed back, that the chat is not
 * asking about: it keeps "With Notes triage · …" and never reads "asking you"
 * (decision 17: only the feature the chat asks about is marked).
 */
const SIBLING: FeatureListItem = listItem({
  id: 'f_sync',
  slug: 'sync-notes-offline',
  title: 'Sync notes offline',
  heldBy: NOTES,
  ticketCounts: ticketCounts(3, 3),
  lastActivityAt: now - 9 * MIN,
  need: { kind: 'test', words: 'With Notes triage · Ready to test', held: true, since: now - 9 * MIN },
})

/** The rows that stay as they are in every state: work in motion. */
const STEADY: FeatureListItem[] = [
  listItem({ id: 'f_pdf', slug: 'export-notes-as-pdf', title: 'Export notes as PDF', leadInBackground: true, ticketCounts: ticketCounts(3, 1), lastActivityAt: now - 2 * MIN }),
  listItem({
    id: 'f_refresh',
    slug: 'sidebar-refresh',
    title: 'Sidebar refresh',
    heldBy: NOTES,
    workersWorking: 2,
    workerProgress: { counted: 5, landed: 2 },
    lastActivityAt: now - 1 * MIN,
  }),
  listItem({ id: 'f_hero', slug: 'landing-hero-copy', title: 'Landing hero copy', heldBy: LANDING, leadInBackground: true, ticketCounts: ticketCounts(2, 0), lastActivityAt: now - 4 * MIN }),
]

const chatState: Record<Key, ThreadState> = { asking: 'waiting', 'handed-back': 'working', yours: 'idle', consulting: 'working', 'quiet-hour': 'idle' }

function thread(id: string, title: string, state: ThreadState, movedAgo: number): ThreadEntry {
  return { id, title, role: 'project', state, createdAt: now - 3 * 60 * MIN, updatedAt: now - movedAgo, runtime: 'claude-code' }
}

const noop = () => {}

/**
 * A chat row that names what it asks about: the thread row's three columns
 * (glyph, title, mark) and, under the title, one 12px muted line. Drawn here
 * because the real row is one line (see the header comment).
 */
function AskingThreadRow({ thread: t, about, mark }: { thread: ThreadEntry; about: string; mark: ReactNode }) {
  return (
    <div className="group/thread relative shrink-0 rounded-md transition-colors duration-(--dur-1) ease-app hover:bg-surface-hover">
      <button
        type="button"
        title={`${t.title} — ${about}`}
        className="flex w-full cursor-pointer flex-col gap-0.5 rounded-[inherit] px-2.5 py-1.5 text-left"
      >
        <span className="flex h-5 w-full min-w-0 items-center gap-2">
          <ThreadGlyph state={t.state} />
          <span className="min-w-0 flex-1 truncate text-md text-text">{t.title}</span>
          <span className="inline-flex shrink-0 items-center text-xs text-text-tertiary tabular-nums">{mark}</span>
        </span>
        <span className="min-w-0 truncate pl-6 text-xs text-text-tertiary">{about}</span>
      </button>
    </div>
  )
}

function DesignSidebar({ k }: { k: Key }) {
  const features = [owned(k), ...(k === 'asking' ? [SIBLING] : []), ...STEADY]
  const { inbox, lanes } = sidebarLanes(features)
  const working = lanes.find((g) => g.key === 'agentWorking')?.features ?? []
  const inProgress = lanes.find((g) => g.key === 'inProgress')?.features ?? []
  const row = (f: FeatureListItem, nested = false) => (
    <SidebarFeatureRow key={f.id} f={f} active={false} onSelect={noop} actions={[]} nested={nested} />
  )
  const notes = thread(NOTES, 'Notes triage', chatState[k], k === 'quiet-hour' ? 64 * MIN : 3 * MIN)
  const landing = thread(LANDING, 'Landing page copy', 'idle', 25 * MIN)
  const mark = (t: ThreadEntry) => {
    const held = heldFeatures(t.id, features)
    return held.length > 0 ? <HoldMark features={held} /> : null
  }
  const chats = [notes, landing]
  return (
    <nav aria-label="Project" className="relative isolate flex h-full min-h-0 flex-col p-2">
      <SidebarBackdrop />
      <div className="flex h-10 shrink-0 items-center px-2.5 text-md font-medium text-text">runcastle</div>
      <div className="mt-3">
        <OrchestratorCard
          status={chatState[k] === 'waiting' ? 'Waiting for you' : chatState[k] === 'working' ? 'Working' : 'Plan, cut and ask'}
          state={chatState[k]}
          active
          onOpen={noop}
          actions={[]}
          onNewThread={noop}
          onToggleThreads={noop}
          threads={
            <ul aria-label="Chats" className="m-0 flex list-none flex-col gap-px p-0">
              {chats.map((t, i) => (
                <li key={t.id} className="flex flex-col gap-px">
                  {i > 0 && <span aria-hidden className="mr-2.5 ml-[34px] h-px bg-border-subtle" />}
                  {t.state === 'waiting' ? (
                    <AskingThreadRow thread={t} about={`Asking about ${OWNED}`} mark={mark(t)} />
                  ) : (
                    <SidebarThreadRow thread={t} active={false} onOpen={noop} actions={[]} mark={mark(t)} />
                  )}
                </li>
              ))}
            </ul>
          }
        />
      </div>
      <div className="-mx-2 mt-4 flex min-h-0 flex-1 flex-col gap-5 overflow-x-hidden overflow-y-auto px-2 pt-px pb-2">
        {inbox.length + inProgress.length > 0 && (
          <section aria-label="Needs you" className="flex flex-col gap-1">
            {inbox.map((f) => row(f))}
            {inProgress.map((f) => row(f))}
          </section>
        )}
        <WorkingShelf features={working} renderRow={row} />
      </div>
    </nav>
  )
}

const WHAT: Record<Key, string> = {
  asking: 'Notes triage asks you about one feature it owns: the dot is on the chat, which names the feature. That feature row says where the question is, with no dot; the chat\'s other handed-back feature is not marked.',
  'handed-back': 'The feature is ready to test, and its owner chat is working on it: no dot anywhere until the chat asks.',
  yours: 'A feature you own waits on you: the dot is on the feature row, where you answer. The chats are quiet.',
  consulting: 'A feature you own asks the chat it came from about something beyond it. It reads “Asking Notes triage”, never “With”, which means the chat owns it. No dot: the chat answers its lead.',
  'quiet-hour': 'Notes triage went quiet for an hour with a plan waiting: the feature comes to you, dot on its row, under Needs you.',
}

function Page() {
  const [key, setKey] = useState<Key>(() => stateFromAddress(STATES.map((s) => s.key), 'asking'))
  return (
    <div className="flex h-screen bg-canvas">
      <div style={{ width: 280 }} className="flex h-full shrink-0 flex-col">
        <DesignSidebar k={key} />
      </div>
      <section className={cx('my-2 mr-2 flex min-w-0 flex-1 flex-col items-center justify-center rounded-lg border border-border bg-surface px-10')}>
        <p className="m-0 max-w-96 text-center text-sm text-pretty text-text-tertiary">{WHAT[key]}</p>
      </section>
      <Switcher states={STATES} current={key} onPick={setKey} />
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
