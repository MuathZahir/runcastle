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
import { installSilentEventSource } from '../../../.runcastle/preview/event-source'
import { STATES, type StateKey } from './shown-files-data'

/**
 * Files an agent showed, in the orchestrator's chat: pictures inline, cards for
 * the rest, and the viewer they open. One state per `?state=`; the thread, the
 * composer, the cards and the viewer are the real components, the files are made
 * up. A dead end on purpose: links and downloads do nothing here.
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
window.open = () => null

const keys = Object.keys(STATES) as StateKey[]

function Page() {
  const params = new URLSearchParams(location.search)
  const key = keys.find((k) => k === params.get('state')) ?? 'screenshots'
  const state: { label: string; items: (typeof STATES)[StateKey]['items']; open?: string } = STATES[key]
  const [draft, setDraft] = useState('')

  // A viewer state is reached the way a person reaches it: by clicking the file.
  useEffect(() => {
    if (!state.open) return
    const target = [...document.querySelectorAll('button')].find((b) => b.getAttribute('aria-label')?.endsWith(state.open!))
    target?.click()
  }, [state.open])

  return (
    <div className="flex h-dvh flex-col bg-canvas p-2">
      <section className="flex min-h-0 flex-1 flex-col overflow-clip rounded-lg border border-border-subtle bg-canvas" aria-label="Orchestrator">
        <PageTopbar crumbs={[{ label: 'Orchestrator', icon: <IconOrchestrator /> }, { label: 'Export notes as PDF' }]} trail />
        <div className="relative flex min-h-0 flex-1 flex-col bg-surface">
          <ChatThread
            items={state.items}
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
    <TooltipProvider>
      <ToastProvider>
        <Page />
      </ToastProvider>
    </TooltipProvider>
  </StrictMode>,
)
