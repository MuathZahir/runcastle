import { StrictMode, useState } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource-variable/geist'
import '@fontsource-variable/geist-mono'
import '../src/theme.css'
import '../src/styles.css'
import { TooltipProvider } from '../src/ui/tooltip'
import { ToastProvider } from '../src/lib/toast'
import { applyStoredTheme } from '../src/lib/theme'
import type { ThreadItem, ThreadState } from '../src/lib/chat-thread'
import { ChatThread } from '../src/components/chat/thread/ChatThread'
import { Composer } from '../src/components/chat/thread/Composer'
import { installSilentEventSource } from '../../../.runcastle/preview/event-source'
import { LADDER, LIVE, SETTLED } from './turn-words-data'

/**
 * every-word-the-agent-writes-stays-in-view: a turn once every stretch of the
 * agent's words is its own message, in order, and each run of tool calls and
 * thinking between them folds to its own line with its own time. Three states
 * by `?state=`: `settled` (a finished turn), `live` (the same turn still
 * running) and `ladder` (an agent that writes a line before every tool call).
 *
 * A dead end on purpose: links do nothing.
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

const STATES: Record<string, { items: ThreadItem[]; state: ThreadState }> = {
  settled: { items: SETTLED, state: 'idle' },
  live: { items: LIVE, state: 'working' },
  ladder: { items: LADDER, state: 'idle' },
}

function Page() {
  const key = new URLSearchParams(location.search).get('state') ?? 'settled'
  const sample = STATES[key] ?? STATES.settled
  const [draft, setDraft] = useState('')
  return (
    <div id="thread" className="flex h-screen min-h-0 flex-col bg-surface">
      <ChatThread
        items={sample.items}
        state={sample.state}
        actions={{ onEdit: () => {}, onBranch: () => {}, canUndoFiles: true }}
        footer={
          <Composer
            value={draft}
            onChange={setDraft}
            state={sample.state}
            onSend={() => setDraft('')}
            onStop={() => {}}
            {...(sample.state === 'working' ? { workingSince: Date.now() - 158_000 } : {})}
          />
        }
      />
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
