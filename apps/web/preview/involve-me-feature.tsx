import { StrictMode, useEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource-variable/geist'
import '@fontsource-variable/geist-mono'
import '../src/theme.css'
import '../src/styles.css'
import type { Involvement } from '@runcastle/core'
import { TooltipProvider } from '../src/ui/tooltip'
import { ToastProvider } from '../src/lib/toast'
import { cx } from '../src/ui'
import { PageTopbar } from '../src/ui/page'
import { ThreadItemView, opensTurn } from '../src/components/chat/thread/ChatThread'
import { Composer } from '../src/components/chat/thread/Composer'
import { FeatureStatusLine } from '../src/components/workspace/FeatureStatusLine'
import { FeatureActionsMenu, type FeatureAction } from '../src/components/FeatureActionsMenu'
import { PanelToggle } from '../src/components/workspace/FeaturePanel'
import { epicCrumb } from '../src/components/SidebarEpics'
import { InvolvementSelect } from '../src/components/involvement/Involvement'
import { ProgressIcon } from '../src/icons'
import { applyStoredTheme } from '../src/lib/theme'
import type { FeatureStatus } from '../src/lib/feature-ui/status-line'
import type { ThreadEntry, ThreadItem, ToolCall } from '../src/lib/chat-thread'
import { installSilentEventSource } from '../../../.runcastle/preview/event-source'
import { useDesignReport } from '../../../.runcastle/preview/design-report'
import { DESIGN_PANEL_CLEARANCE, DesignPanel, makeDeadEnd } from './autopilot-design-panel'

/**
 * "Involve me in" on a feature (docs/features/how-involved-am-i decisions 3,
 * 5): the chat of "Saved cards", its level in the header beside the status,
 * changeable at any time. When it changes while the lead waits on the human's
 * answer, a quiet line says so and the lead decides the question itself,
 * records it, and carries on. The real header, status line, thread rows and
 * picker over sample data.
 *
 * States: ?state=asking | changed.
 */

applyStoredTheme()
installSilentEventSource()
makeDeadEnd()

type StateKey = 'asking' | 'changed'

const STATES: { key: StateKey; label: string; hint: string }[] = [
  {
    key: 'asking',
    label: 'Asking you',
    hint: 'At “Everything” the lead waits on your answer. Pick a lower level in the header to let it decide instead.',
  },
  {
    key: 'changed',
    label: 'Changed while asking',
    hint: 'You picked “Result only”: one line says so, and the lead answered its own question, recorded it, and went on.',
  },
]

const params = new URLSearchParams(location.search)
const pickState = (): StateKey => STATES.find((s) => s.key === params.get('state'))?.key ?? 'asking'

const EPIC_CHAT: ThreadEntry = {
  id: 'chat_checkout',
  title: 'Checkout flow',
  role: 'project',
  state: 'idle',
  createdAt: Date.now() - 7 * 3_600_000,
  updatedAt: Date.now() - 60_000,
  runtime: 'claude-code',
  epicNamed: true,
  need: null,
  color: 'violet',
  icon: 'credit-card',
}
const FEATURE = 'Saved cards'

const MENU: FeatureAction[] = [
  { key: 'copy-link', label: 'Copy link', onSelect: () => {} },
  { key: 'copy-branch', label: 'Copy branch name', onSelect: () => {} },
]

let n = 0
const call = (kind: ToolCall['kind'], title: string, status: ToolCall['status'] = 'completed'): ToolCall => ({ id: `c${++n}`, kind, title, status })
const tools = (...calls: ToolCall[]) => ({ kind: 'tools' as const, id: `s${++n}`, calls })

const QUESTION =
  'One question before I build the card list. When a saved card expires, should it stay in the list greyed out with “Expired”, or disappear?\n\nMy pick: keep it, greyed out, so people see why their usual card is missing and can update it. If wrong: it clutters the list for people with many old cards.'

const SO_FAR: ThreadItem[] = [
  {
    kind: 'work',
    id: 'w1',
    seconds: 188,
    steps: [tools(call('read', 'Read docs/features/saved-cards/brief.md'), call('search', 'Search "PaymentMethod"'), call('read', 'Read src/payments/methods.ts'))],
  },
  { kind: 'agent', id: 'a1', text: QUESTION, turnSeconds: 196 },
]

const CHANGED: ThreadItem[] = [
  { kind: 'notice', id: 'n1', text: 'Involve me in: Result only · the lead decides its open questions itself' },
  {
    kind: 'work',
    id: 'w2',
    seconds: 64,
    steps: [tools(call('edit', 'Edit docs/features/saved-cards/decisions.md'), call('edit', 'Edit src/payments/SavedCardList.tsx'))],
  },
  {
    kind: 'agent',
    id: 'a2',
    text: 'Decided it myself: expired cards stay in the list, greyed out with “Expired”. Recorded as decided without you, so you will see it listed when you try the result. Building the card list now.',
    turnSeconds: 71,
  },
]

function statusFor(state: StateKey): FeatureStatus {
  return state === 'asking' ? { kind: 'needsYou', label: 'Needs you', why: 'Expired cards: keep or hide?', threadId: 'lead' } : { kind: 'working', label: 'Working' }
}

function FeatureChat({ state, onChange }: { state: StateKey; onChange: (level: Involvement) => void }) {
  const [draft, setDraft] = useState('')
  const scroller = useRef<HTMLDivElement>(null)
  const items = state === 'changed' ? [...SO_FAR, ...CHANGED] : SO_FAR
  const level: Involvement = state === 'changed' ? 'resultOnly' : 'everything'

  useEffect(() => {
    const el = scroller.current
    if (el) el.scrollTop = el.scrollHeight
  }, [state])

  return (
    <section className="flex min-h-0 flex-1 flex-col overflow-clip rounded-lg border border-border-subtle bg-canvas" aria-label={FEATURE}>
      <PageTopbar
        crumbs={[
          epicCrumb({ chatId: EPIC_CHAT.id }, [EPIC_CHAT], () => {})!,
          { label: FEATURE, shrink: true, icon: <ProgressIcon state="active" progress={0.3} size={14} label="" /> },
        ]}
        status={<FeatureStatusLine status={statusFor(state)} />}
        actions={
          <>
            <span className="mr-1">
              <InvolvementSelect value={level} onChange={onChange} size="md" />
            </span>
            <FeatureActionsMenu actions={MENU} size="md" />
            <PanelToggle open={false} views={['work', 'details']} onToggle={() => {}} />
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
                <ThreadItemView item={item} locked={false} />
              </div>
            ))}
            <div className="sticky bottom-0 mt-10 bg-[linear-gradient(to_bottom,transparent,var(--color-surface)_24px)] pt-6 pb-4">
              <Composer value={draft} onChange={setDraft} state={state === 'changed' ? 'working' : 'idle'} onSend={() => setDraft('')} placeholder="Message the lead" />
            </div>
          </div>
        </div>
      </div>
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
  // Any lower level answers the question the same way here; "Everything" takes the page back to the question.
  const onChange = (level: Involvement) => go(level === 'everything' ? 'asking' : 'changed')
  return (
    <div className="flex h-dvh flex-col bg-canvas">
      <div className={cx('flex min-h-0 flex-1 p-3', DESIGN_PANEL_CLEARANCE)}>
        <FeatureChat key={state} state={state} onChange={onChange} />
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
