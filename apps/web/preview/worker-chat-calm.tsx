import { StrictMode, useState } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource-variable/geist'
import '@fontsource-variable/geist-mono'
import '../src/theme.css'
import '../src/styles.css'
import { TooltipProvider } from '../src/ui/tooltip'
import { ToastProvider } from '../src/lib/toast'
import { IconButton } from '../src/ui'
import { PageTopbar } from '../src/ui/page'
import { ChatThread } from '../src/components/chat/thread/ChatThread'
import { Composer } from '../src/components/chat/thread/Composer'
import { AssignmentCard, WorkerHeaderActions, WorkerStatusLine } from '../src/components/workers/WorkerParts'
import { IconBranch, IconDoc, IconPanelRight } from '../src/icons'
import { applyStoredTheme } from '../src/lib/theme'
import { installSilentEventSource } from '../../../.runcastle/preview/event-source'
import { useDesignReport, useDesignTweaks } from '../../../.runcastle/preview/design-report'
import { DesignBar, killLinks, type TweakSpec } from './calm-design-bar'
import { ASSIGNMENT, BRANCH, FEATURE, ITEMS, STATES, type StateKey } from './worker-chat-calm-data'

/**
 * A worker's chat, calmer (docs/features/triage-batch-calmer-worker-chats-and-honest-statuses
 * decisions 1, 3, 7, 8, 10, 11): the assignment card pinned atop it folds to
 * one line, and each settled stretch of work says what ran, then its time.
 * The real ChatThread, WorkBlock and AssignmentCard over sample data.
 *
 * States: ?state=folded | assignment-open. Tweak: "Time on rows" (shown | hidden).
 */

applyStoredTheme()
installSilentEventSource()
killLinks()

const noop = () => {}

const TWEAKS: TweakSpec[] = [
  {
    name: 'time',
    label: 'Time on rows',
    options: [
      { value: 'shown', label: 'Shown' },
      { value: 'hidden', label: 'Hidden' },
    ],
  },
]

const params = new URLSearchParams(location.search)
const pickState = (): StateKey => STATES.find((s) => s.key === params.get('state'))?.key ?? 'folded'

function WorkerChat({ state }: { state: StateKey }) {
  const [draft, setDraft] = useState('')
  return (
    <section className="flex min-h-0 flex-1 flex-col overflow-clip rounded-lg border border-border-subtle bg-canvas" aria-label={ASSIGNMENT.label}>
      <PageTopbar
        crumbs={[{ label: FEATURE }, { label: ASSIGNMENT.label }]}
        trail
        status={<WorkerStatusLine status="working" />}
        actions={
          <>
            <WorkerHeaderActions
              onHandBack={noop}
              menu={[
                { key: 'copy-branch', label: 'Copy branch name', icon: <IconBranch />, onSelect: noop },
                { key: 'export', label: 'Export as Markdown', icon: <IconDoc />, onSelect: noop },
              ]}
            />
            <IconButton label="Panel" icon={<IconPanelRight />} />
          </>
        }
      />
      <div className="relative flex min-h-0 flex-1 flex-col bg-surface">
        <ChatThread
          items={ITEMS}
          state="working"
          head={<AssignmentCard key={state} assignment={ASSIGNMENT} defaultOpen={state === 'assignment-open'} />}
          footer={
            <div className="flex flex-col gap-1.5">
              <Composer value={draft} onChange={setDraft} state="working" onSend={() => setDraft('')} placeholder="Message the worker" />
              <span className="px-4 text-xs text-text-tertiary">Sandbox · its own branch off {BRANCH}</span>
            </div>
          }
        />
      </div>
    </section>
  )
}

function Page() {
  const [state, setState] = useState<StateKey>(pickState)
  const [tweaks, setTweak] = useDesignTweaks({ time: 'shown' })
  useDesignReport(state, tweaks)
  const go = (k: StateKey) => {
    setState(k)
    history.replaceState(null, '', `?state=${k}`)
  }
  return (
    <div className="flex h-screen flex-col bg-canvas">
      {tweaks.time === 'hidden' && <style>{'[data-work-time] { display: none; }'}</style>}
      <DesignBar
        states={STATES}
        state={state}
        onPick={go}
        hint={STATES.find((s) => s.key === state)!.hint}
        tweaks={TWEAKS}
        values={tweaks}
        onTweak={(name, value) => setTweak(name as 'time', value)}
      />
      <div className="flex min-h-0 flex-1 p-3">
        <WorkerChat state={state} />
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
