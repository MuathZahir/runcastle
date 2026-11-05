import { StrictMode, useEffect, useState } from 'react'
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
import { GlossaryDialog, GlossaryProvider, useOpenGlossary } from '../src/components/GlossaryDialog'
import { Term } from '../src/components/Term'
import { SidebarStatusLine } from '../src/components/SidebarParts'
import { installSilentEventSource } from '../../../.runcastle/preview/event-source'

/**
 * The Glossary (docs/features/ready-to-publish, decisions 9, 16, 17, 20): the
 * dialog, the dialog opened at one word from a hint, a word's dotted-underline
 * hint where a newcomer first meets it, and the help menu in the sidebar's
 * bottom row. Pick the state with `?state=` or the bar at the top. Type in the
 * filter box to filter (an old word such as "burn" finds its new one). A dead
 * end on purpose: links and navigation do nothing.
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

type Stage = 'dialog' | 'at-term' | 'hints' | 'menu'
const STAGES: { key: Stage; label: string }[] = [
  { key: 'dialog', label: 'Glossary' },
  { key: 'at-term', label: 'Opened at “held by”' },
  { key: 'hints', label: 'Hints where a word first appears' },
  { key: 'menu', label: 'Help menu' },
]

/** Sample places a newcomer first meets the words: the plan, the drive button, a held feature. */
function Hints() {
  const openGlossary = useOpenGlossary()
  // Show one hint open, as a hover would: focus the first term once mounted.
  useEffect(() => {
    const t = setTimeout(() => (document.querySelector('[data-first-term] button') as HTMLElement | null)?.focus(), 300)
    return () => clearTimeout(t)
  }, [])
  const row = (label: string, body: ReactNode) => (
    <div className="grid grid-cols-[8rem_1fr] items-baseline gap-4 border-b border-border-subtle py-3 last:border-b-0">
      <span className="text-xs text-text-tertiary">{label}</span>
      <span className="text-sm text-text">{body}</span>
    </div>
  )
  return (
    <div className="mx-auto w-full max-w-[640px] rounded-lg border border-border bg-surface p-6">
      <h2 className="m-0 mb-1 text-lg font-semibold text-text">Weekly digest email</h2>
      <p className="m-0 mb-4 text-sm text-text-secondary">Sample feature page lines, each with the word it introduces.</p>
      {row(
        'The plan',
        <span data-first-term>
          6 tickets in 2 <Term id="round">rounds</Term>, then a <Term id="review-round">review round</Term>
        </span>,
      )}
      {row('Next step', <>Ready for a <Term id="test-drive">test drive</Term> of this feature</>)}
      {row('Review', <>The <Term id="review-package">review package</Term> is in the chat</>)}
      {row('Holder', <><Term id="held-by">Held by</Term> “Publish prep”, an <Term id="orchestrator">orchestrator</Term> chat</>)}
      {row('Drive from', <>Choose a <Term id="scenario">scenario</Term></>)}
      <p className="m-0 mt-4 text-xs text-text-tertiary">
        Hover, focus, click or tap a dotted word.{' '}
        {openGlossary && (
          <button type="button" className="cursor-pointer border-0 bg-transparent p-0 text-xs text-accent-text" onClick={() => openGlossary()}>
            Open the glossary
          </button>
        )}
      </p>
    </div>
  )
}

/** The sidebar's bottom row with the help menu open, at the sidebar's width. */
function Menu() {
  const theme = useTheme()
  const openGlossary = useOpenGlossary()
  useEffect(() => {
    const t = setTimeout(() => {
      const trigger = document.querySelector('[aria-label="Help"]') as HTMLElement | null
      trigger?.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, pointerType: 'mouse' }))
    }, 300)
    return () => clearTimeout(t)
  }, [])
  return (
    <div className="flex h-full w-[248px] flex-col justify-end rounded-lg border border-border bg-canvas px-2 pb-2">
      <p className="m-0 mb-auto pt-4 text-xs text-text-tertiary">The sidebar, cut down to its bottom row.</p>
      <SidebarStatusLine
        healthTone="success"
        healthTip="Server healthy"
        sandbox="docker"
        notify={{ state: 'on', title: 'Notifications', onToggle: () => {} }}
        theme={theme.resolved}
        onToggleTheme={theme.toggle}
        onOpenSettings={() => {}}
        onOpenGlossary={() => openGlossary?.()}
        onOpenPhoneSetup={() => {}}
      />
    </div>
  )
}

function Stage({ stage }: { stage: Stage }) {
  if (stage === 'dialog') return <GlossaryDialog open onClose={() => {}} />
  if (stage === 'at-term') return <GlossaryDialog open focus="held-by" onClose={() => {}} />
  if (stage === 'hints') return <Hints />
  return <Menu />
}

function Page() {
  const [stage, setStage] = useState<Stage>(
    () => STAGES.find((s) => s.key === new URLSearchParams(location.search).get('state'))?.key ?? 'dialog',
  )
  const theme = useTheme()
  const chip = (on: boolean) =>
    cx('h-6 shrink-0 cursor-pointer rounded-md px-2', on ? 'bg-surface-selected text-text' : 'hover:bg-surface-hover/50 hover:text-text-secondary')
  return (
    <div className="flex h-screen flex-col bg-canvas">
      <div className="relative z-[300] flex h-10 shrink-0 items-center gap-1 overflow-x-auto border-b border-border-subtle bg-canvas px-3 text-xs whitespace-nowrap text-text-tertiary">
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
      <div className="flex min-h-0 flex-1 items-start p-6">
        <GlossaryProvider>
          <Stage key={stage} stage={stage} />
        </GlossaryProvider>
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
