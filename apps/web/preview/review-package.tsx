import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { StrictMode, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource-variable/geist'
import '@fontsource-variable/geist-mono'
import '../src/theme.css'
import '../src/styles.css'
import { TooltipProvider } from '../src/ui/tooltip'
import { ToastProvider } from '../src/lib/toast'
import { PageTopbar } from '../src/ui/page'
import { applyStoredTheme } from '../src/lib/theme'
import { ChatThread } from '../src/components/chat/thread/ChatThread'
import { Composer } from '../src/components/chat/thread/Composer'
import { IconOrchestrator } from '../src/icons'
import type { ThreadItem } from '../src/lib/chat-thread'
import { installSilentEventSource } from '../../../.runcastle/preview/event-source'
import { STATES, type StateKey } from './review-package-data'

/**
 * A review package in the orchestrator's chat, and the page it opens. The thread,
 * card, page and call rows are the real components, reading a made-up pass from a
 * faked route. One state per `?state=`; `?open=1` opens the page, `?stop=findings`
 * goes to the findings. A dead end on purpose: there is no video behind the
 * walkthrough, and links and downloads do nothing here.
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

const params = new URLSearchParams(location.search)
const keys = Object.keys(STATES) as StateKey[]
const key = keys.find((k) => k === params.get('state')) ?? 'driven'
const { pack } = STATES[key]

const realFetch = window.fetch.bind(window)
window.fetch = (input, init) => {
  const url = String(input)
  if (url.includes('/package.json')) return Promise.resolve(Response.json(pack))
  if (url.includes('/api/reviews/')) return Promise.resolve(Response.json([]))
  return realFetch(input, init)
}

const THREAD: ThreadItem[] = [
  { kind: 'user', id: 'u1', text: 'Is Export notes as PDF finished? Show me.' },
  {
    kind: 'work',
    id: 'w1',
    seconds: 41,
    steps: [{ kind: 'tools', id: 't1', calls: [{ id: 'c1', kind: 'other', title: 'show_review_package', status: 'completed' }] }],
  },
  { kind: 'review_package', id: 'p1', ticketId: pack.ticketId },
  { kind: 'agent', id: 'a1', text: 'Export notes as PDF is finished and the review looked at this build. It found one defect, on A5 paper. Merge it?', model: 'Opus 5.5' },
]

const client = new QueryClient()

function Page() {
  const [draft, setDraft] = useState('')

  // A state behind clicks is reached the way a person reaches it.
  useEffect(() => {
    if (!params.get('open')) return
    const timer = setTimeout(() => {
      document.querySelector<HTMLElement>('[aria-label="Open the review package"]')?.click()
      const stop = params.get('stop')
      if (stop) {
        setTimeout(() => {
          const row = [...document.querySelectorAll('aside button')].find((b) => b.textContent?.toLowerCase().startsWith(stop))
          ;(row as HTMLElement | undefined)?.click()
        }, 150)
      }
    }, 150)
    return () => clearTimeout(timer)
  }, [])

  return (
    <div className="flex h-dvh flex-col bg-canvas p-2">
      <section className="flex min-h-0 flex-1 flex-col overflow-clip rounded-lg border border-border-subtle bg-canvas" aria-label="Orchestrator">
        <PageTopbar crumbs={[{ label: 'Orchestrator', icon: <IconOrchestrator /> }, { label: 'Export notes as PDF' }]} trail />
        <div className="relative flex min-h-0 flex-1 flex-col bg-surface">
          <ChatThread
            items={THREAD}
            state="idle"
            footer={<Composer value={draft} onChange={setDraft} commands={[]} files={[]} state="idle" onSend={() => setDraft('')} attachments={[]} placeholder="Reply to the orchestrator" />}
          />
        </div>
      </section>
    </div>
  )
}

createRoot(document.getElementById('root')!).render(
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
