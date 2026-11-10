import { StrictMode, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource-variable/geist'
import '@fontsource-variable/geist-mono'
import '../src/theme.css'
import '../src/styles.css'
import { TooltipProvider } from '../src/ui/tooltip'
import { ToastProvider } from '../src/lib/toast'
import { IconButton } from '../src/ui'
import type { Crumb } from '../src/ui/page'
import { PageTopbar } from '../src/ui/page'
import { FeatureStatusLine } from '../src/components/workspace/FeatureStatusLine'
import { OwnerControl, type FeatureOwner } from '../src/components/workspace/OwnerControl'
import { OwnerStrip } from '../src/components/chat/OwnerStrip'
import { ChatThread } from '../src/components/chat/thread/ChatThread'
import { Composer } from '../src/components/chat/thread/Composer'
import type { ThreadItem } from '../src/lib/chat-thread'
import type { FeatureStatus } from '../src/lib/feature-ui/status-line'
import { IconMore, IconPanelRight, ProgressIcon } from '../src/icons'
import { applyStoredTheme } from '../src/lib/theme'
import { installSilentEventSource } from '../../../.runcastle/preview/event-source'
import { Switcher, stateFromAddress, stopLinks } from './owner-switcher'

/**
 * Every feature has one owner (docs/features/every-feature-has-one-owner,
 * decisions 11, 12, 14, 21, 23): the feature page's top, its header's trail
 * starting with the real owner control, over a short sample chat ending in the
 * lead's composer — with the real owner strip on it while a chat owns the
 * feature. Choosing in the menu, and sending a message, change the owner live.
 * The header says the short words ("Notes triage · you merge"); the menu
 * spells each choice out. With no chat the control reads "Yours", does not
 * open, and says how to get a chat on hover. States at ?state=. A dead end
 * otherwise.
 */

applyStoredTheme()
installSilentEventSource()
stopLinks()

const CHAT = 'Notes triage'
const SHORT = 'Export notes as PDF'
const LONG = 'Every feature has one owner'
/** A long chat name: it truncates in the header, and "· merges it" never does. */
const LONG_CHAT = 'Runcastle orchestrator feature workflow confusion'

interface State {
  key: 'yours' | 'planning' | 'shows' | 'merges' | 'asking' | 'menu' | 'no-chat'
  label: string
  owner: FeatureOwner
  chatName?: string
  hover?: boolean
  planning?: boolean
  asking?: boolean
  menu?: boolean
  title: string
  status: FeatureStatus
}

const STATES: State[] = [
  { key: 'yours', label: 'Yours', owner: { kind: 'you' }, chatName: CHAT, title: SHORT, status: { kind: 'talking', label: 'Talking with you' } },
  {
    key: 'planning',
    label: 'Planning',
    owner: { kind: 'chat', name: CHAT, finish: 'show' },
    planning: true,
    title: SHORT,
    status: { kind: 'talking', label: 'Planning with you' },
  },
  { key: 'shows', label: 'Shows you', owner: { kind: 'chat', name: CHAT, finish: 'show' }, title: SHORT, status: { kind: 'working', label: 'Working', why: '2 workers' } },
  { key: 'merges', label: 'Merges, long name', owner: { kind: 'chat', name: LONG_CHAT, finish: 'merge' }, chatName: LONG_CHAT, title: LONG, status: { kind: 'working', label: 'Working', why: 'Round 2' } },
  {
    key: 'asking',
    label: 'Asking',
    owner: { kind: 'chat', name: CHAT, finish: 'show' },
    asking: true,
    title: SHORT,
    status: { kind: 'waiting', label: `With ${CHAT}`, why: 'asking you', held: true },
  },
  { key: 'menu', label: 'Menu open', owner: { kind: 'chat', name: CHAT, finish: 'show' }, menu: true, title: SHORT, status: { kind: 'working', label: 'Working', why: '2 workers' } },
  { key: 'no-chat', label: 'No chat', owner: { kind: 'you' }, hover: true, title: LONG, status: { kind: 'talking', label: 'Talking with you' } },
]

function items(title: string, by: 'chat' | 'you' | 'planning'): ThreadItem[] {
  if (by !== 'chat')
    return [
      { kind: 'user', id: 'u1', text: `Let's plan ${title}: one button on the note, and the export keeps the headings.` },
      {
        kind: 'agent',
        id: 'a1',
        text:
          by === 'planning'
            ? `Drafting the plan for **${title}** with you. Once you give it a yes, ${CHAT} builds it and shows you before merging.`
            : `Drafting the plan for **${title}**: one round for the export and its button, one for page breaks and images.`,
        turnSeconds: 31,
      },
    ]
  return [
    {
      kind: 'user',
      id: 'u1',
      from: 'runcastle',
      text: `${CHAT}: the plan has its yes. Build it, get it reviewed, then hand it back.`,
    },
    {
      kind: 'agent',
      id: 'a1',
      text: `Building **${title}** in two rounds. Round 1 is the export itself and its button; round 2 is page breaks and images. Two workers are on round 1 now.`,
      turnSeconds: 48,
    },
  ]
}

function Page() {
  const [key, setKey] = useState(() => stateFromAddress(STATES.map((s) => s.key), 'shows'))
  const state = STATES.find((s) => s.key === key)!
  const [owner, setOwner] = useState<FeatureOwner>(state.owner)
  const [draft, setDraft] = useState('')
  const [sent, setSent] = useState<ThreadItem[]>([])

  const pick = (k: State['key']) => {
    const next = STATES.find((s) => s.key === k)!
    setKey(k)
    setOwner(next.owner)
    setSent([])
    setDraft('')
  }

  // A state behind a click: open the owner menu, as the human would.
  useEffect(() => {
    if (!state.menu) return
    const t = setTimeout(() => {
      document
        .querySelector('[data-owner-control]')
        ?.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, button: 0, pointerType: 'mouse' }))
    }, 300)
    return () => clearTimeout(t)
  }, [key, state.menu])

  // The no-chat state: show the control's hover hint, as a pointer resting on it would.
  useEffect(() => {
    if (!state.hover) return
    const t = setTimeout(() => (document.querySelector('[data-owner-control]') as HTMLElement | null)?.focus(), 300)
    return () => clearTimeout(t)
  }, [key, state.hover])

  const chatName = state.key === 'no-chat' ? undefined : (state.chatName ?? CHAT)
  const chatOwns = owner.kind === 'chat'
  const planning = !!state.planning && chatOwns
  const showStrip = chatOwns && !planning

  const crumbs: Crumb[] = [
    {
      label: (
        <OwnerControl
          owner={owner}
          {...(chatName ? { chatName } : {})}
          planning={planning}
          feature={state.title}
          onChoose={(c) => setOwner(c === 'you' ? { kind: 'you' } : { kind: 'chat', name: chatName ?? CHAT, finish: c })}
        />
      ),
    },
    { label: state.title, icon: <ProgressIcon state="active" progress={0.35} size={14} label="" />, shrink: true },
  ]

  return (
    <div className="flex h-screen flex-col bg-canvas p-2">
      <section className="flex min-w-0 flex-1 flex-col overflow-hidden rounded-lg border border-border bg-surface">
        <PageTopbar
          crumbs={crumbs}
          status={<FeatureStatusLine status={chatOwns || owner.kind === state.owner.kind ? state.status : { kind: 'talking', label: 'Talking with you' }} />}
          actions={
            <>
              <IconButton size="md" label="More" icon={<IconMore />} />
              <IconButton size="md" label="Panel" icon={<IconPanelRight />} />
            </>
          }
        />
        <div className="relative flex min-h-0 flex-1 flex-col">
          <ChatThread
            key={key}
            items={[...items(state.title, planning ? 'planning' : state.owner.kind === 'chat' ? 'chat' : 'you'), ...sent]}
            state="idle"
            footer={
              <div className="flex flex-col gap-1.5">
                {showStrip && <OwnerStrip chat={owner.name} asking={!!state.asking} onOpenChat={() => {}} />}
                <Composer
                  value={draft}
                  onChange={setDraft}
                  state="idle"
                  placeholder="Message the feature's agent"
                  onSend={() => {
                    if (!draft.trim()) return
                    setSent((s) => [...s, { kind: 'user', id: `s${s.length}`, text: draft }])
                    setDraft('')
                    // The first message takes the feature (decision 23).
                    setOwner({ kind: 'you' })
                  }}
                />
                <span className="px-4 text-xs text-text-tertiary">Feature worktree · feature/export-notes-as-pdf</span>
              </div>
            }
          />
        </div>
      </section>
      <Switcher
        states={STATES}
        current={key}
        onPick={pick}
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
