import { StrictMode, useState } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource-variable/geist'
import '@fontsource-variable/geist-mono'
import '../src/theme.css'
import '../src/styles.css'
import { TooltipProvider } from '../src/ui/tooltip'
import { ToastProvider } from '../src/lib/toast'
import { Page, PageTopbar } from '../src/ui/page'
import { SidebarBackdrop } from '../src/components/SidebarParts'
import { IconHome } from '../src/icons'
import { applyStoredTheme } from '../src/lib/theme'
import { useIsPhone } from '../src/lib/use-phone'
import { installSilentEventSource } from '../../../.runcastle/preview/event-source'
import { DesignPanel, makeDeadEnd, readState } from './project-switching/design-panel'
import { CardsHome } from './project-switching/overview'
import { PhoneStrip, Rail } from './project-switching/rail'
import { useMockProjects } from './project-switching/use-mock'
import type { SampleKey } from './project-switching/data'

/**
 * What "All projects" (the portfolio home, route `/`) becomes beside the
 * project rail (docs/features/a-better-way-to-move-between-projects,
 * decisions 2 and 3), on desktop and, below 768px, on a phone. A dead end:
 * links do nothing, and opening a project here is ignored (it would leave for
 * the project screen, the other design page).
 */

applyStoredTheme()
installSilentEventSource()
makeDeadEnd()

type StateKey = SampleKey

const STATES: Array<{ key: StateKey; label: string }> = [
  { key: 'busy', label: 'Busy' },
  { key: 'quiet', label: 'Quiet' },
  { key: 'many', label: '14 projects' },
]

function hintFor(state: StateKey): string {
  const what = 'A card for each project with something going on, needs-you first; the quiet ones as plain rows. The rail stays at the left.'
  if (state === 'quiet') return `${what} Nothing waits or runs.`
  if (state === 'many') return `${what} 14 projects.`
  return what
}

const ignore = () => {}

function Home({ sample, phone }: { sample: SampleKey; phone: boolean }) {
  const { projects } = useMockProjects(sample, 'none')
  const content = <CardsHome projects={projects} onOpen={ignore} phone={phone} />

  if (phone) {
    return (
      <div className="relative isolate flex h-dvh min-h-0 flex-col bg-canvas p-2">
        <SidebarBackdrop />
        <PhoneStrip projects={projects} currentId={null} onPick={ignore} />
        <div className="-mx-2 min-h-0 flex-1 overflow-y-auto px-3 pt-4 pb-6">{content}</div>
      </div>
    )
  }

  return (
    <div className="flex h-screen min-h-0 bg-canvas">
      <div className="relative isolate flex h-full min-h-0 shrink-0">
        <SidebarBackdrop />
        <Rail projects={projects} currentId={null} onPick={ignore} />
      </div>
      <div className="w-2 shrink-0" />
      <section className="my-2 mr-2 flex min-w-0 flex-1 flex-col overflow-hidden rounded-lg border border-border bg-surface">
        <PageTopbar crumbs={[{ label: 'Projects', icon: <IconHome /> }]} />
        <Page routeKey="portfolio" width="wide" className="relative isolate">
          <SidebarBackdrop />
          {content}
        </Page>
      </section>
    </div>
  )
}

function Root() {
  const [state, setState] = useState<StateKey>(() => readState(STATES))
  const phone = useIsPhone()
  return (
    <>
      <Home key={`${state}-${phone}`} sample={state} phone={phone} />
      <DesignPanel states={STATES} state={state} onState={setState} hint={hintFor(state)} />
    </>
  )
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <TooltipProvider>
      <ToastProvider>
        <Root />
      </ToastProvider>
    </TooltipProvider>
  </StrictMode>,
)
