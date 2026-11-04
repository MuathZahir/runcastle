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
import { applyStoredTheme, useTheme } from '../src/lib/theme'
import type { ThreadItem } from '../src/lib/chat-thread'
import { ChatThread } from '../src/components/chat/thread/ChatThread'
import { WorkBlock } from '../src/components/chat/thread/Work'
import { WELL } from '../src/components/chat/thread/surfaces'
import { Markdown } from '../src/components/Markdown'
import {
  FeaturesCard,
  NewsBlock,
  OrchestratorMessage,
  RuncastleNote,
} from '../src/components/chat/thread/FeatureCards'
import * as D from './orchestrator-cards-data'

/**
 * Orchestrator actions show as cards (docs/features/orchestrator-actions-show-as-cards):
 * the Orchestrator's chat with its action cards and runcastle's news, a
 * feature's chat with its kickoff line and the Orchestrator's messages, and
 * the Orchestrator's chat as it reads today. Pick one with `?state=`, or from
 * the bar. Rows open nothing here: a toast says which feature a click opens.
 * A dead end on purpose.
 */

applyStoredTheme()
document.addEventListener(
  'click',
  (e) => {
    if ((e.target as Element | null)?.closest?.('a[href]')) e.preventDefault()
  },
  true,
)

const params = new URLSearchParams(location.search)

type Stage = 'orchestrator' | 'feature' | 'today'
const STAGES: { key: Stage; label: string }[] = [
  { key: 'orchestrator', label: 'Orchestrator chat' },
  { key: 'feature', label: 'A feature’s chat' },
  { key: 'today', label: 'Orchestrator chat today' },
]

// ---- the chat column, spaced as the thread spaces it ----

/** Your message, as the thread draws it. */
function You({ text }: { text: string }) {
  return (
    <div className="flex flex-col items-end gap-1.5">
      <div className={cx(WELL, 'max-w-[85%] px-3.5 py-2.5 text-base break-words whitespace-pre-wrap text-text')}>{text}</div>
    </div>
  )
}

function Words({ text }: { text: string }) {
  return <Markdown source={text} size="base" tone="primary" breaks />
}

/** One piece of the thread: `turn` takes a turn's air above it, the rest sits close. */
type Piece = { turn?: boolean; node: ReactNode }

function Column({ pieces }: { pieces: Piece[] }) {
  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-6 [scrollbar-gutter:stable]">
      <div className="mx-auto flex w-full max-w-(--content-max) flex-col pt-8 pb-24">
        {pieces.map((p, i) => (
          <div key={i} className={cx('flex min-w-0 flex-col', i > 0 && (p.turn ? 'mt-10' : 'mt-3'))}>
            {p.node}
          </div>
        ))}
      </div>
    </div>
  )
}

function OrchestratorChat({ onOpen }: { onOpen: (id: string) => void }) {
  return (
    <Column
      pieces={[
        { turn: true, node: <You text={D.ASK_CUT} /> },
        { node: <WorkBlock steps={D.CUT_WORK} seconds={72} /> },
        { node: <FeaturesCard rows={D.CUT_ROWS} onOpen={onOpen} /> },
        { node: <Words text={D.CUT_ANSWER} /> },
        {
          turn: true,
          node: <NewsBlock rows={D.PLANS_IN_ROWS} when={D.WHEN.plans} agentText={D.PLANS_IN_AGENT_TEXT} onOpen={onOpen} />,
        },
        { node: <WorkBlock steps={[{ kind: 'tools', id: 'r1', calls: [{ id: 'r', kind: 'read', title: 'mcp__runcastle__read_feature_chat', status: 'completed' }] }]} seconds={9} /> },
        { node: <Words text={D.PLANS_IN_ANSWER} /> },
        { turn: true, node: <You text={D.ASK_SEND} /> },
        { node: <WorkBlock steps={D.SEND_WORK} seconds={23} /> },
        { node: <FeaturesCard rows={D.SEND_ROWS} onOpen={onOpen} /> },
        { node: <Words text={D.SEND_ANSWER} /> },
        {
          turn: true,
          node: <NewsBlock rows={D.ROUNDS_ROWS} when={D.WHEN.rounds} agentText={D.ROUNDS_AGENT_TEXT} onOpen={onOpen} />,
        },
        { node: <Words text={D.ROUNDS_ANSWER} /> },
      ]}
    />
  )
}

function FeatureChat({ onOpen }: { onOpen: (id: string) => void }) {
  return (
    <Column
      pieces={[
        { turn: true, node: <RuncastleNote summary={D.KICKOFF_SUMMARY} agentText={D.KICKOFF_AGENT_TEXT} /> },
        { node: <WorkBlock steps={[{ kind: 'narration', id: 'k', text: 'Reading the brief and the composer code.' }]} seconds={23 * 60 + 40} /> },
        { node: <Words text={D.PLAN_WORDS} /> },
        { turn: true, node: <OrchestratorMessage text={D.RELAYED} relayed /> },
        { node: <WorkBlock steps={D.PARK_WORK} seconds={48} /> },
        { node: <FeaturesCard rows={D.PARK_ROWS} onOpen={onOpen} /> },
        { node: <Words text={D.PARK_ANSWER} /> },
        { turn: true, node: <OrchestratorMessage text={D.FROM_ORCHESTRATOR} /> },
        { node: <WorkBlock steps={[{ kind: 'tools', id: 'g', calls: [{ id: 'g1', kind: 'execute', title: 'git merge main', status: 'completed' }] }]} seconds={31} /> },
        { node: <Words text={D.AFTER_ORCHESTRATOR} /> },
      ]}
    />
  )
}

/** The Orchestrator's chat as the thread draws it today, from the same story. */
const TODAY: ThreadItem[] = [
  { kind: 'user', id: 'u1', text: D.ASK_CUT },
  { kind: 'work', id: 'w1', steps: D.CUT_WORK, seconds: 72 },
  {
    kind: 'agent',
    id: 'a1',
    text: `Created four features:\n\n- \`orchestrator-actions-show-as-cards\` (started, planning)\n- \`composer-remembers-the-last-model\` (started, planning)\n- \`empty-states-speak-plainly\` (backlog)\n- \`a-keyboard-map-for-the-chat\` (backlog)\n\n${D.CUT_ANSWER}`,
  },
  { kind: 'user', id: 'u2', from: 'runcastle', text: D.PLANS_IN_AGENT_TEXT },
  { kind: 'agent', id: 'a2', text: D.PLANS_IN_ANSWER },
  { kind: 'user', id: 'u3', text: D.ASK_SEND },
  { kind: 'work', id: 'w2', steps: D.SEND_WORK, seconds: 23 },
  { kind: 'agent', id: 'a3', text: D.SEND_ANSWER },
  { kind: 'user', id: 'u4', from: 'runcastle', text: D.ROUNDS_AGENT_TEXT },
  { kind: 'agent', id: 'a4', text: D.ROUNDS_ANSWER },
]

function Page() {
  const [stage, setStage] = useState<Stage>(() => STAGES.find((s) => s.key === params.get('state'))?.key ?? 'orchestrator')
  const [opened, setOpened] = useState<string | null>(null)
  const theme = useTheme()
  const all = [D.CARDS, D.COMPOSER, D.EMPTY, D.KEYS, D.CHANGELOG, D.PREPARE, D.BLOCKERS, D.PER_PROJECT]
  const onOpen = (id: string) => {
    setOpened(all.find((f) => f.id === id)?.title ?? id)
    window.setTimeout(() => setOpened(null), 1800)
  }
  const chip = (on: boolean) =>
    cx('h-6 shrink-0 cursor-pointer rounded-md px-2', on ? 'bg-surface-selected text-text' : 'hover:bg-surface-hover/50 hover:text-text-secondary')
  return (
    <div className="flex h-screen flex-col bg-canvas">
      <div className="flex h-10 shrink-0 items-center gap-1 overflow-x-auto border-b border-border-subtle px-3 text-xs whitespace-nowrap text-text-tertiary">
        {STAGES.map((s) => (
          <button key={s.key} type="button" onClick={() => setStage(s.key)} className={chip(s.key === stage)}>
            {s.label}
          </button>
        ))}
        <span className="ml-auto" />
        <button type="button" onClick={theme.toggle} className={chip(false)}>
          {theme.resolved === 'dark' ? 'Light' : 'Dark'}
        </button>
      </div>
      <div className="flex min-h-0 flex-1 bg-surface">
        {stage === 'orchestrator' && <OrchestratorChat onOpen={onOpen} />}
        {stage === 'feature' && <FeatureChat onOpen={onOpen} />}
        {stage === 'today' && <ChatThread items={TODAY} state="idle" footer={<div className="h-4" />} />}
      </div>
      {opened && (
        <div className="fixed bottom-4 left-1/2 z-[1001] -translate-x-1/2 rounded-md bg-surface-raised px-3 py-2 text-sm text-text shadow-popover animate-pop-in">
          Opens “{opened}” — navigation is off in this preview
        </div>
      )}
    </div>
  )
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ToastProvider>
      <TooltipProvider>
        <Page />
      </TooltipProvider>
    </ToastProvider>
  </StrictMode>,
)
