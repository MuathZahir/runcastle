import { StrictMode, useState } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource-variable/geist'
import '@fontsource-variable/geist-mono'
import '../src/theme.css'
import '../src/styles.css'
import type { ReviewPackage } from '@runcastle/core'
import { TooltipProvider } from '../src/ui/tooltip'
import { ToastProvider } from '../src/lib/toast'
import { cx } from '../src/ui'
import { ReviewPackagePage } from '../src/components/review/ReviewPackagePage'
import { applyStoredTheme } from '../src/lib/theme'
import { installSilentEventSource } from '../../../.runcastle/preview/event-source'
import { useDesignReport } from '../../../.runcastle/preview/design-report'
import { STATES as PACKS } from './review-package-data'
import { DESIGN_PANEL_CLEARANCE, DesignPanel, makeDeadEnd } from './autopilot-design-panel'

/**
 * "Decided without you" in a review package (docs/features/how-involved-am-i
 * decisions 2, 3, 6): below "Everything" the lead decides some things itself,
 * and the package lists them, by their number in decisions.md, before the human
 * merges. The real review page over a made-up pass.
 *
 * States: ?state=listed | none.
 */

applyStoredTheme()
installSilentEventSource()
makeDeadEnd()

type StateKey = 'listed' | 'none'

const STATES: { key: StateKey; label: string; hint: string }[] = [
  { key: 'listed', label: 'Decided without you', hint: 'At “Result only” the lead settled three things itself. They are listed under the verdict, by their number in decisions.md.' },
  { key: 'none', label: 'Nothing decided alone', hint: 'At “Everything”, or when nothing was decided alone, the list is not there at all.' },
]

const params = new URLSearchParams(location.search)
const pickState = (): StateKey => STATES.find((s) => s.key === params.get('state'))?.key ?? 'listed'

const DECIDED = [
  { n: 4, title: 'Expired cards stay in the list, greyed out with “Expired”' },
  { n: 6, title: 'The card list matches the checkout page’s rows' },
  { n: 7, title: 'A card is removed with one tap and an Undo toast' },
]

function packFor(state: StateKey): ReviewPackage {
  const base = PACKS.driven.pack
  return { ...base, decidedWithoutYou: state === 'listed' ? DECIDED : [] }
}

function Page() {
  const [state, setState] = useState<StateKey>(pickState)
  useDesignReport(state)
  const go = (k: StateKey) => {
    setState(k)
    history.replaceState(null, '', `?state=${k}`)
  }
  return (
    <div className="flex h-dvh flex-col bg-canvas">
      <div className={cx('flex min-h-0 flex-1 p-3', DESIGN_PANEL_CLEARANCE)}>
        <ReviewPackagePage key={state} pack={packFor(state)} onClose={() => {}} />
      </div>
      <DesignPanel states={STATES} state={state} onPick={go} />
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
