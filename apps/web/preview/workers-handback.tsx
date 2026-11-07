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
import { ThreadItemView, opensTurn } from '../src/components/chat/thread/ChatThread'
import { Composer } from '../src/components/chat/thread/Composer'
import { FeatureStatusLine } from '../src/components/workspace/FeatureStatusLine'
import { HandbackCard, WorkerFailedCard } from '../src/components/workers/WorkerParts'
import { IconMore, IconPanelRight } from '../src/icons'
import { applyStoredTheme, useTheme } from '../src/lib/theme'
import { installSilentEventSource } from '../../../.runcastle/preview/event-source'
import { ENTRIES, FEATURE, type LeadEntry } from './workers-handback-data'

/**
 * Handbacks in the lead's chat (docs/features/interactive-workers decisions 4,
 * 16, 21): each a card — the worker, its summary, its commits, the files it
 * changed (folded), a way to its chat — with what the lead did beneath it
 * (Landed, Sent back, Dropped), and a failed worker's notice, among the lead's
 * own turns. One state, every variant: ?state=all. A dead end: "Open its chat"
 * and links do nothing.
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

/** A worker's card wakes the lead: it opens a turn, as runcastle's own lines do. */
function opens(e: LeadEntry): boolean {
  return e.kind !== 'item' || opensTurn(e.item)
}

function Entry({ entry }: { entry: LeadEntry }) {
  if (entry.kind === 'handback') return <HandbackCard handback={entry.handback} onOpenWorker={noop} />
  if (entry.kind === 'failed')
    return <WorkerFailedCard workerId={entry.workerId} workerLabel={entry.workerLabel} reason={entry.reason} onOpenWorker={noop} />
  return <ThreadItemView item={entry.item} locked={false} />
}

function LeadChat() {
  const [draft, setDraft] = useState('')
  return (
    <section className="flex min-h-0 flex-1 flex-col overflow-clip rounded-lg border border-border-subtle bg-canvas" aria-label={FEATURE}>
      <PageTopbar
        crumbs={[{ label: FEATURE }, { label: 'Lead' }]}
        trail
        status={<FeatureStatusLine status={{ kind: 'talking', label: 'Talking with you' }} />}
        actions={
          <>
            <IconButton label="More" icon={<IconMore />} />
            <IconButton label="Panel" icon={<IconPanelRight />} />
          </>
        }
      />
      <div className="flex min-h-0 flex-1 flex-col bg-surface">
        <div className="min-h-0 flex-1 overflow-y-auto px-6 [scrollbar-gutter:stable] [scrollbar-width:thin] [scrollbar-color:var(--color-border-strong)_transparent]">
          <div className="mx-auto flex w-full max-w-(--content-max) flex-col pt-8">
            {ENTRIES.map((e, i) => (
              <div key={e.kind === 'item' ? e.item.id : e.id} className={cx('flex min-w-0 flex-col', i > 0 && (opens(e) ? 'mt-10' : 'mt-3'))}>
                <Entry entry={e} />
              </div>
            ))}
            {/* The composer at the foot, on the column's edge, as the chat floats it. */}
            <div className="sticky bottom-0 mt-10 bg-[linear-gradient(to_bottom,transparent,var(--color-surface)_24px)] pt-6 pb-4">
              <Composer value={draft} onChange={setDraft} state="idle" onSend={() => setDraft('')} placeholder="Message the lead" />
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}

function Page() {
  const theme = useTheme()
  return (
    <div className="flex h-screen flex-col bg-canvas">
      <div className="flex h-10 shrink-0 items-center gap-1 border-b border-border-subtle px-3 text-xs text-text-tertiary">
        <span className="h-6 rounded-md bg-surface-selected px-2 leading-6 text-text">All variants</span>
        <span className="ml-auto" />
        <button
          type="button"
          onClick={theme.toggle}
          className="h-6 cursor-pointer rounded-md px-2 hover:bg-surface-hover/50 hover:text-text-secondary"
        >
          {theme.resolved === 'dark' ? 'Light' : 'Dark'}
        </button>
      </div>
      <div className="flex min-h-0 flex-1 p-3">
        <LeadChat />
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
