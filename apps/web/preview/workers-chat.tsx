import { StrictMode, useState } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource-variable/geist'
import '@fontsource-variable/geist-mono'
import '../src/theme.css'
import '../src/styles.css'
import { TooltipProvider } from '../src/ui/tooltip'
import { ToastProvider } from '../src/lib/toast'
import { IconButton, cx } from '../src/ui'
import { PageTopbar } from '../src/ui/page'
import { ChatThread } from '../src/components/chat/thread/ChatThread'
import { Composer } from '../src/components/chat/thread/Composer'
import {
  AssignmentCard,
  HandedBackLine,
  OldSideChatNote,
  WorkerClosedNote,
  WorkerHeaderActions,
  WorkerStatusLine,
} from '../src/components/workers/WorkerParts'
import { IconAlert, IconBranch, IconDoc, IconPanelRight, IconPencil, IconTrash } from '../src/icons'
import type { FeatureAction } from '../src/components/FeatureActionsMenu'
import { applyStoredTheme, useTheme } from '../src/lib/theme'
import { installSilentEventSource } from '../../../.runcastle/preview/event-source'
import { FEATURE, MOMENTS, type WorkerMoment } from './workers-chat-data'

/**
 * A worker's chat (docs/features/interactive-workers decisions 5, 15, 16, 21,
 * 23): the header names the worker and its status, with "Open preview" while
 * its dev server runs and "Hand back"; the assignment card stays atop the
 * conversation. The moments are at ?state=with-you | started-by-you |
 * handed-back | failed | old-side-chat. Hand back on "With you" moves to the
 * handed-back moment; nothing else is wired. A dead end: links do nothing.
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

/** The header's "…": the worker's branch, rename, export; drop while it is not settled. */
function menuFor(m: WorkerMoment): FeatureAction[] {
  if (m.worker.oldSideChat) return [{ key: 'export', label: 'Export as Markdown', icon: <IconDoc />, onSelect: noop }]
  return [
    { key: 'rename', label: 'Rename…', icon: <IconPencil />, onSelect: noop },
    { key: 'copy-branch', label: 'Copy branch name', icon: <IconBranch />, onSelect: noop },
    { key: 'export', label: 'Export as Markdown', icon: <IconDoc />, onSelect: noop },
    { key: 'drop', label: 'Drop worker', icon: <IconTrash />, danger: true, onSelect: noop },
  ]
}

function WorkerChat({ moment, goHandedBack }: { moment: WorkerMoment; goHandedBack: () => void }) {
  const [draft, setDraft] = useState('')
  const w = moment.worker
  const canHandBack = !w.oldSideChat && (w.status === 'needs-you' || w.status === 'working' || w.status === 'queued')
  const foot = w.oldSideChat ? (
    <OldSideChatNote />
  ) : w.status === 'failed' ? (
    <WorkerClosedNote
      icon={<IconAlert className="text-danger" />}
      title="This worker failed"
      hint="Its lead was told once, and retries it, drops it or does the job itself."
    />
  ) : (
    <div className="flex flex-col gap-1.5">
      <Composer
        value={draft}
        onChange={setDraft}
        state={w.status === 'working' ? 'working' : 'idle'}
        onSend={() => setDraft('')}
        placeholder={w.status === 'handed-back' ? 'Message the worker — the lead has its handback' : "Message the worker"}
      />
      <span className="px-4 text-xs text-text-tertiary">Sandbox · its own branch off feature/sidebar-refresh</span>
    </div>
  )
  return (
    <section className="flex min-h-0 flex-1 flex-col overflow-clip rounded-lg border border-border-subtle bg-canvas" aria-label={w.label}>
      <PageTopbar
        crumbs={[{ label: FEATURE }, { label: w.label }]}
        trail
        status={<WorkerStatusLine status={w.status} oldSideChat={w.oldSideChat ?? false} {...(w.failure ? { why: w.failure } : {})} />}
        actions={
          <>
            <WorkerHeaderActions
              {...(moment.previewRunning ? { onOpenPreview: noop } : {})}
              {...(canHandBack ? { onHandBack: moment.key === 'with-you' ? goHandedBack : noop } : {})}
              menu={menuFor(moment)}
            />
            <IconButton label="Panel" icon={<IconPanelRight />} />
          </>
        }
      />
      <div className="relative flex min-h-0 flex-1 flex-col bg-surface">
        <ChatThread
          items={moment.items}
          state={w.status === 'working' ? 'working' : 'idle'}
          {...(w.oldSideChat ? {} : { head: <AssignmentCard assignment={moment.assignment} defaultOpen={moment.items.length <= 5} /> })}
          {...(moment.handedBack ? { tail: <div className="mt-7"><HandedBackLine {...moment.handedBack} /></div> } : {})}
          footer={foot}
        />
      </div>
    </section>
  )
}

function Page() {
  const asked = new URLSearchParams(location.search).get('state')
  const [key, setKey] = useState<WorkerMoment['key']>(MOMENTS.find((m) => m.key === asked)?.key ?? 'with-you')
  const theme = useTheme()
  const moment = MOMENTS.find((m) => m.key === key) ?? MOMENTS[0]!
  const go = (k: WorkerMoment['key']) => {
    setKey(k)
    history.replaceState(null, '', `?state=${k}`)
  }
  const chip = (on: boolean) =>
    cx('h-6 shrink-0 cursor-pointer rounded-md px-2', on ? 'bg-surface-selected text-text' : 'hover:bg-surface-hover/50 hover:text-text-secondary')
  return (
    <div className="flex h-screen flex-col bg-canvas">
      <div className="flex h-10 shrink-0 items-center gap-1 overflow-x-auto border-b border-border-subtle px-3 text-xs whitespace-nowrap text-text-tertiary">
        {MOMENTS.map((m) => (
          <button key={m.key} type="button" onClick={() => go(m.key)} className={chip(m.key === key)}>
            {m.label}
          </button>
        ))}
        <span className="ml-auto" />
        <button type="button" onClick={theme.toggle} className={chip(false)}>
          {theme.resolved === 'dark' ? 'Light' : 'Dark'}
        </button>
      </div>
      <div className="flex min-h-0 flex-1 p-3">
        <WorkerChat key={key} moment={moment} goHandedBack={() => go('handed-back')} />
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
