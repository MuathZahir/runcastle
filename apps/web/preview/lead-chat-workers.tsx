import { StrictMode, useEffect, useRef, useState } from 'react'
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
import { HandbackCard } from '../src/components/workers/WorkerParts'
import { WorkersStartedCard } from '../src/components/workers/WorkersStartedCard'
import { IconMore, IconPanelRight } from '../src/icons'
import { applyStoredTheme } from '../src/lib/theme'
import { installSilentEventSource } from '../../../.runcastle/preview/event-source'
import { useDesignReport, useDesignTweaks } from '../../../.runcastle/preview/design-report'
import { DesignBar, killLinks, type TweakSpec } from './calm-design-bar'
import { FEATURE, STATES, entriesFor, type LeadEntry, type StateKey } from './lead-chat-workers-data'

/**
 * A lead's chat with the workers it starts (docs/features/triage-batch-calmer-worker-chats-and-honest-statuses
 * decisions 2, 6, 10, 12): a turn that starts workers ends with one card of
 * them, each row saying where its worker is now, and a worker's handback shows
 * its first paragraph with the rest a click away in a capped box.
 * The real WorkersStartedCard, HandbackCard and thread rows over sample data.
 *
 * States: ?state=started | handed-back | report-open. Tweak: "Report box" (short | tall).
 */

applyStoredTheme()
installSilentEventSource()
killLinks()

const noop = () => {}

const TWEAKS: TweakSpec[] = [
  {
    name: 'box',
    label: 'Report box',
    options: [
      { value: 'short', label: 'Short (16rem)' },
      { value: 'tall', label: 'Tall (24rem)' },
    ],
  },
]

const params = new URLSearchParams(location.search)
const pickState = (): StateKey => STATES.find((s) => s.key === params.get('state'))?.key ?? 'started'

/** A worker's card wakes the lead: it opens a turn, as runcastle's own lines do. A workers card ends the lead's own turn. */
function opens(e: LeadEntry): boolean {
  if (e.kind === 'handback') return true
  if (e.kind === 'workers') return false
  return opensTurn(e.item)
}

function Entry({ entry }: { entry: LeadEntry }) {
  if (entry.kind === 'handback') return <HandbackCard handback={entry.handback} onOpenWorker={noop} />
  if (entry.kind === 'workers') return <WorkersStartedCard rows={entry.rows} onOpenWorker={noop} />
  return <ThreadItemView item={entry.item} locked={false} />
}

function LeadChat({ state }: { state: StateKey }) {
  const [draft, setDraft] = useState('')
  const scroller = useRef<HTMLDivElement>(null)
  const opened = useRef(false)
  const entries = entriesFor(state)

  // Each state lands where its story is: the handback in view, its report opened for report-open.
  useEffect(() => {
    const el = scroller.current
    if (!el) return
    const card = el.querySelector<HTMLElement>('article[aria-label^="Handback"]')
    if (!card) {
      el.scrollTop = el.scrollHeight
      return
    }
    if (state === 'report-open' && !opened.current) {
      opened.current = true
      card.querySelector<HTMLButtonElement>('button[aria-expanded="false"]')?.click()
    }
    // handed-back: to the foot, where the Review worker's card is; report-open: the handback at the top.
    requestAnimationFrame(() => {
      el.scrollTop =
        state === 'report-open' ? el.scrollTop + card.getBoundingClientRect().top - el.getBoundingClientRect().top - 24 : el.scrollHeight
    })
  }, [state])

  return (
    <section className="flex min-h-0 flex-1 flex-col overflow-clip rounded-lg border border-border-subtle bg-canvas" aria-label={FEATURE}>
      <PageTopbar
        crumbs={[{ label: FEATURE }, { label: 'Lead' }]}
        trail
        status={
          <FeatureStatusLine
            status={
              state === 'started'
                ? { kind: 'working', label: 'Working', why: '2 workers at work' }
                : { kind: 'talking', label: 'Talking with you' }
            }
          />
        }
        actions={
          <>
            <IconButton label="More" icon={<IconMore />} />
            <IconButton label="Panel" icon={<IconPanelRight />} />
          </>
        }
      />
      <div className="flex min-h-0 flex-1 flex-col bg-surface">
        <div
          ref={scroller}
          className="relative min-h-0 flex-1 overflow-y-auto px-6 [scrollbar-gutter:stable] [scrollbar-width:thin] [scrollbar-color:var(--color-border-strong)_transparent]"
        >
          <div className="mx-auto flex w-full max-w-(--content-max) flex-col pt-8">
            {entries.map((e, i) => (
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
  const [state, setState] = useState<StateKey>(pickState)
  const [tweaks, setTweak] = useDesignTweaks({ box: 'tall' })
  useDesignReport(state, tweaks)
  const go = (k: StateKey) => {
    setState(k)
    history.replaceState(null, '', `?state=${k}`)
  }
  return (
    <div className="flex h-screen flex-col bg-canvas">
      {tweaks.box === 'short' && <style>{'[data-report-box] { max-height: 16rem; }'}</style>}
      <DesignBar
        states={STATES}
        state={state}
        onPick={go}
        hint={STATES.find((s) => s.key === state)!.hint}
        tweaks={TWEAKS}
        values={tweaks}
        onTweak={(name, value) => setTweak(name as 'box', value)}
      />
      <div className="flex min-h-0 flex-1 p-3">
        <LeadChat key={state} state={state} />
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
