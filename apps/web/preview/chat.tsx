import { StrictMode, useEffect, useRef, useState } from 'react'
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
import { IconMore } from '../src/icons'
import { PANEL_VIEW_LABEL } from '../src/lib/feature-ui/panel'
import { applyStoredTheme, useTheme } from '../src/lib/theme'
import type { Ask, Attachment, BackgroundTask, ContextUsage, Effort, PlanEntry, ThreadItem, ThreadState } from '../src/lib/chat-thread'
import { ChatThread } from '../src/components/chat/thread/ChatThread'
import { Composer } from '../src/components/chat/thread/Composer'
import { ContextMeter, ModelControls, PlanStrip } from '../src/components/chat/thread/ComposerParts'
import { ApprovalDock, FormDock, LinkDock, QuestionDock } from '../src/components/chat/thread/AskDock'
import { FeatureStatusLine } from '../src/components/workspace/FeatureStatusLine'
import { NoticeStrip } from '../src/components/chat/NoticeStrip'
import type { ChatNotice } from '../src/lib/chat-notices'
import { installSilentEventSource } from '../../../.runcastle/preview/event-source'
import { CODEX_MODELS, COMMANDS, FILES, LIMITS, MODELS, MOMENTS, PLAN, TITLE, threads, type Moment, type MomentSample } from './chat-data'

/**
 * The chat column once it is web components, not a terminal
 * (docs/features/chat-as-web-components): one thread at each moment it has to
 * show, in the feature page's real header and panel split. Sending, steering,
 * Stop, answering, editing and the model picker all work here on canned
 * replies, so they can be felt, not just seen. A dead end on purpose: links do
 * nothing.
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
let seq = 0
const nextId = () => `live${++seq}`

/** One thread, live on canned replies. */
function useThread(moment: MomentSample, goNew: () => void) {
  const [items, setItems] = useState<ThreadItem[]>(moment.items)
  const [state, setState] = useState<ThreadState>(moment.state)
  const [ask, setAsk] = useState<Ask | undefined>(moment.ask)
  const [plan, setPlan] = useState<PlanEntry[]>(moment.plan ?? [])
  const [tasks, setTasks] = useState<BackgroundTask[]>(moment.tasks ?? [])
  const [context, setContext] = useState<ContextUsage>(moment.context)
  const [since, setSince] = useState<number | undefined>(moment.state === 'working' ? Date.now() - 74_000 : undefined)
  const [draft, setDraft] = useState(moment.draft ?? '')
  const [attachments, setAttachments] = useState<Attachment[]>(moment.attachments ?? [])
  const [suggestion, setSuggestion] = useState(moment.suggestion)
  const models = moment.runtime === 'codex' ? CODEX_MODELS : MODELS
  const [model, setModel] = useState(() => {
    const said = [...moment.items].reverse().find((x): x is Extract<ThreadItem, { kind: 'agent' }> => x.kind === 'agent' && !!x.model)?.model
    return models.find((m) => m.label === said)?.id ?? models[0].id
  })
  const [effort, setEffort] = useState<Effort>('high')
  const [fast, setFast] = useState(false)
  const lastModel = useRef(model)
  const timers = useRef<number[]>([])
  useEffect(() => () => timers.current.forEach(clearTimeout), [])
  const later = (ms: number, f: () => void) => timers.current.push(window.setTimeout(f, ms))
  const label = models.find((m) => m.id === model)?.label

  const reply = (text: string) => {
    setState('working')
    const started = Date.now()
    setSince(started)
    const workId = nextId()
    setPlan(PLAN.map((p, i) => ({ ...p, status: i === 0 ? 'in_progress' : 'pending' })))
    later(700, () =>
      setItems((xs) => [
        ...xs,
        {
          kind: 'work',
          id: workId,
          seconds: 0,
          live: true,
          steps: [{ kind: 'tools', id: nextId(), calls: [{ id: 'r1', kind: 'read', title: 'src/app/NoteToolbar.tsx', status: 'in_progress' }] }],
        },
      ]),
    )
    later(1700, () => {
      setPlan(PLAN.map((p, i) => ({ ...p, status: i < 1 ? 'completed' : i === 1 ? 'in_progress' : 'pending' })))
      setItems((xs) =>
        xs.map((x) =>
          x.id === workId && x.kind === 'work'
            ? {
                ...x,
                steps: [
                  {
                    kind: 'tools',
                    id: 'rt',
                    calls: [
                      { id: 'r1', kind: 'read', title: 'src/app/NoteToolbar.tsx', status: 'completed' },
                      { id: 'r2', kind: 'edit', title: 'src/app/NoteToolbar.tsx', status: 'in_progress' },
                    ],
                  },
                ],
              }
            : x,
        ),
      )
    })
    later(3000, () => {
      setItems((xs) => [
        ...xs.map((x) =>
          x.id === workId && x.kind === 'work'
            ? {
                ...x,
                live: false,
                seconds: Math.round((Date.now() - started) / 1000),
                steps: x.steps.map((s) => (s.kind === 'tools' ? { ...s, calls: s.calls.map((c) => ({ ...c, status: 'completed' as const })) } : s)),
              }
            : x,
        ),
        { kind: 'agent', id: nextId(), text, model: label },
      ])
      setPlan([])
      setState('idle')
      setSince(undefined)
      setContext((c) => ({ ...c, used: c.used + 9_000, costUsd: (c.costUsd ?? 0) + 0.21 }))
      setSuggestion('Looks good — commit it')
    })
  }

  const send = () => {
    const id = nextId()
    const text = draft.trim()
    const cold = state === 'idle'
    const changed = lastModel.current !== model
    lastModel.current = model
    setItems((xs) => [
      ...xs,
      ...(changed ? [{ kind: 'model' as const, id: nextId(), model: label ?? model }] : []),
      { kind: 'user', id, text, images: attachments, starting: cold, steered: state === 'working' },
    ])
    setDraft('')
    setAttachments([])
    setSuggestion(undefined)
    const answer = text.startsWith('/compact')
      ? 'Compacted. The earlier turns are summarised; the decisions and spec are on disk either way.'
      : 'The Export button had its own `mt-1` from before the toolbar used `items-center`. I removed it, so it lines up with the others now.'
    if (text.startsWith('/compact')) {
      setItems((xs) => [...xs, { kind: 'compacted', id: nextId() }])
      setContext((c) => ({ ...c, used: Math.round(c.size * 0.08) }))
    }
    if (cold) {
      later(1400, () => {
        setItems((xs) => xs.map((x) => (x.id === id && x.kind === 'user' ? { ...x, starting: false } : x)))
        reply(answer)
      })
    }
  }

  const stop = () => {
    timers.current.forEach(clearTimeout)
    setItems((xs) => [
      ...xs.map((x) =>
        x.kind === 'work'
          ? {
              ...x,
              live: false,
              seconds: x.seconds || 74,
              steps: x.steps.map((s) =>
                s.kind === 'tools' ? { ...s, calls: s.calls.map((c) => (c.status === 'in_progress' ? { ...c, status: 'failed' as const } : c)) } : s,
              ),
            }
          : x,
      ),
      { kind: 'stopped', id: nextId() },
    ])
    setPlan([])
    setState('idle')
    setSince(undefined)
  }

  const approve = (answer: 'allow' | 'always' | 'deny', instead?: string) => {
    if (ask?.kind !== 'approval') return
    setAsk(undefined)
    setItems((xs) => [
      ...xs,
      {
        kind: 'answered',
        id: nextId(),
        what: answer === 'deny' ? 'Denied' : answer === 'always' ? 'Always allowed' : 'Allowed',
        answer: ask.call.title,
        denied: answer === 'deny',
      },
      ...(instead ? [{ kind: 'user' as const, id: nextId(), text: instead }] : []),
    ])
    reply(
      answer === 'deny'
        ? 'Understood — no new dependency. I will walk the tree of the parser the app already has instead.'
        : 'Installed. Mapping the Markdown blocks to PDF blocks now.',
    )
  }

  const answer = (answers: Record<string, string>) => {
    if (ask?.kind !== 'question') return
    setAsk(undefined)
    setItems((xs) => [
      ...xs,
      ...ask.questions.map((q) => ({ kind: 'answered' as const, id: nextId(), what: `${q.header}:`, answer: answers[q.question] })),
    ])
    reply(`Recorded: ${Object.values(answers).join('; ')}. I added them to the spec.`)
  }

  /** An MCP server's form or link, answered (or declined) with one line. */
  const settleMcp = (what: string, denied = false) => {
    if (ask?.kind !== 'form' && ask?.kind !== 'link') return
    setAsk(undefined)
    setItems((xs) => [...xs, { kind: 'answered', id: nextId(), what, answer: ask.message, ...(denied ? { denied } : {}) }])
    reply(denied ? 'Fine — I will leave Linear alone and note the bug in the spec instead.' : 'Filed. The issue links back to this thread.')
  }

  const edit = (id: string, text: string) => {
    setItems((xs) => [...xs.slice(0, xs.findIndex((x) => x.id === id)), { kind: 'user', id: nextId(), text }])
    reply('Starting over from your edited message: the export now keeps headings, lists and code blocks.')
  }

  const attach = (files: File[]) =>
    setAttachments((as) => [...as, ...files.map((f) => ({ id: nextId(), name: f.name, src: URL.createObjectURL(f) }))])

  const lastSent = () => [...items].reverse().find((x): x is Extract<ThreadItem, { kind: 'user' }> => x.kind === 'user' && !x.from)?.text

  return {
    items, state, ask, plan, tasks, setTasks, context, since, draft, setDraft, attachments, setAttachments, suggestion,
    models, model, setModel, effort, setEffort, fast, setFast, send, stop, approve, answer, settleMcp, edit, attach, lastSent, branch: goNew,
    compact: () => {
      setDraft('/compact')
    },
  }
}

function ChatColumn({ moment, goNew, notices }: { moment: MomentSample; goNew: () => void; notices: boolean }) {
  const t = useThread(moment, goNew)
  const footer = t.ask ? (
    t.ask.kind === 'approval' ? (
      <ApprovalDock key={t.ask.id} call={t.ask.call} onAnswer={t.approve} />
    ) : t.ask.kind === 'question' ? (
      <QuestionDock key={t.ask.id} questions={t.ask.questions} onAnswer={t.answer} />
    ) : t.ask.kind === 'form' ? (
      <FormDock
        key={t.ask.id}
        {...(t.ask.server ? { server: t.ask.server } : {})}
        message={t.ask.message}
        fields={t.ask.fields}
        onSubmit={() => t.settleMcp('Submitted')}
        onDecline={() => t.settleMcp('Declined', true)}
      />
    ) : (
      <LinkDock
        key={t.ask.id}
        {...(t.ask.server ? { server: t.ask.server } : {})}
        message={t.ask.message}
        url={t.ask.url}
        onDone={() => t.settleMcp('Done')}
        onDecline={() => t.settleMcp('Declined', true)}
      />
    )
  ) : (
    <Composer
      value={t.draft}
      onChange={t.setDraft}
      attachments={t.attachments}
      onAttach={t.attach}
      onRemoveAttachment={(id) => t.setAttachments((as) => as.filter((a) => a.id !== id))}
      commands={COMMANDS}
      files={FILES}
      state={t.state}
      onSend={t.send}
      onStop={t.stop}
      onRecall={t.lastSent}
      suggestion={t.suggestion}
      autoFocus={['composing', 'mention', 'new', 'idle'].includes(moment.key)}
      top={<PlanStrip plan={t.plan} tasks={t.tasks} onStopTask={(id) => t.setTasks((ts) => ts.filter((x) => x.id !== id))} />}
      meter={<ContextMeter context={t.context} limits={LIMITS} plan="Claude Max" onCompact={t.compact} />}
      workingSince={t.since}
      footer={
        <ModelControls
          runtime={moment.runtime ?? 'claude-code'}
          models={t.models}
          model={t.model}
          onModel={t.setModel}
          effort={t.effort}
          onEffort={t.setEffort}
          fast={t.fast}
          onFast={t.setFast}
        />
      }
    />
  )
  return (
    <div className="relative flex min-h-0 flex-1 flex-col bg-surface">
      <ChatThread
        items={t.items}
        state={t.state}
        actions={{ onEdit: t.edit, onBranch: t.branch, canUndoFiles: true }}
        onDropImages={t.attach}
        emptyHint="A fresh conversation on this feature, beside the feature chat. It knows the feature, its docs and its tickets."
        footer={
          <div className="flex flex-col gap-1.5">
            {notices && <Notices />}
            {footer}
            {!t.ask && <span className="px-4 text-xs text-text-tertiary">Feature worktree · feature/export-notes-as-pdf</span>}
          </div>
        }
      />
    </div>
  )
}

/** Sample notices, as the feature raises them on the composer's top edge (decision 18). */
const NOTICES: ChatNotice[] = [
  { kind: 'ticket-failed', hue: 'danger', title: 'Ticket 3 failed', subtitle: 'typecheck failed in src/server/export.ts', actionLabel: 'Open the work', target: 'work', count: 2, eventId: 3 },
  { kind: 'run', hue: 'building', title: 'Round 1 finished', subtitle: '3 of 3 tickets landed, checks green', actionLabel: 'See the round', target: 'work', count: 1, eventId: 2 },
  { kind: 'preview', hue: 'planning', title: 'The plan is ready', subtitle: 'Decisions, spec and the preview to look at', actionLabel: 'Open the plan', target: 'plan', count: 1, eventId: 1 },
]

/** The strip on the foot's top edge, as ThreadColumn places its children. */
function Notices() {
  const [notices, setNotices] = useState(NOTICES)
  return <NoticeStrip notices={notices} onAct={noop} onDismiss={(k) => setNotices((ns) => ns.filter((n) => n.kind !== k))} />
}

function FeaturePage({
  moment,
  panel,
  setMoment,
  notices,
}: {
  moment: MomentSample
  panel: boolean
  setMoment: (m: Moment) => void
  notices: boolean
}) {
  const [open, setOpen] = useState(panel)
  useEffect(() => setOpen(panel), [panel])
  const inFront = threads(moment.key).find((t) => t.id === moment.thread)
  return (
    <section className="flex min-h-0 flex-1 flex-col overflow-clip rounded-lg border border-border-subtle bg-canvas" aria-label={TITLE}>
      <PageTopbar
        crumbs={[{ label: TITLE }, ...(inFront ? [{ label: inFront.title }] : [])]}
        trail
        status={<FeatureStatusLine status={{ kind: 'talking', label: 'Talking with you' }} />}
        actions={
          <>
            <IconButton label="More — Merge & ship is here" icon={<IconMore />} />
            <PanelToggle open={open} views={['work']} onToggle={() => setOpen(!open)} />
          </>
        }
      />
      <PanelSplit
        chat={<ChatColumn key={moment.key} moment={moment} goNew={() => setMoment('new')} notices={notices} />}
        panel={
          open && (
            <FeaturePanel view="work" views={['work', 'design']} label={(v) => PANEL_VIEW_LABEL[v]} onSwitch={noop} onCollapse={() => setOpen(false)} onClose={() => setOpen(false)}>
              <div className="px-6 py-6">
                <DimLine>The panel, unchanged: tickets, design, drive.</DimLine>
              </div>
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
  const [moment, setMoment] = useState<Moment>(
    () => MOMENTS.find((m) => m.key === new URLSearchParams(location.search).get('moment'))?.key ?? 'working',
  )
  const [panel, setPanel] = useState(false)
  const [notices, setNotices] = useState(() => new URLSearchParams(location.search).has('notices'))
  const theme = useTheme()
  const current = MOMENTS.find((m) => m.key === moment) ?? MOMENTS[0]
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
          {MOMENTS.map((m) => (
            <button key={m.key} type="button" onClick={() => setMoment(m.key)} className={chip(m.key === moment)}>
              {m.label}
            </button>
          ))}
          <span className="ml-auto" />
          <button type="button" onClick={() => setNotices(!notices)} className={chip(notices)}>
            Notices
          </button>
          <button type="button" onClick={() => setPanel(!panel)} className={chip(panel)}>
            Panel open
          </button>
          <button type="button" onClick={theme.toggle} className={chip(false)}>
            {theme.resolved === 'dark' ? 'Light' : 'Dark'}
          </button>
        </>,
      )}
      <div className="flex min-h-0 flex-1 p-3">
        <FeaturePage key={moment} moment={current} panel={panel} setMoment={setMoment} notices={notices} />
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
