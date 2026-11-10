import { StrictMode, useState } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource-variable/geist'
import '@fontsource-variable/geist-mono'
import '../src/theme.css'
import '../src/styles.css'
import { TooltipProvider } from '../src/ui/tooltip'
import { ToastProvider } from '../src/lib/toast'
import { IconButton } from '../src/ui'
import { SidebarBackdrop } from '../src/components/SidebarParts'
import { IconPlus } from '../src/icons'
import { applyStoredTheme } from '../src/lib/theme'
import { useIsPhone } from '../src/lib/use-phone'
import { installSilentEventSource } from '../../../.runcastle/preview/event-source'
import { DesignPanel, makeDeadEnd, readState } from './project-switching/design-panel'
import { HeadButtons, Lanes, Panel, ProjectOrchestrator, SCROLL, StatusLine } from './project-switching/frame'
import { PhoneStrip, Rail } from './project-switching/rail'
import { useMockProjects } from './project-switching/use-mock'
import type { SampleKey } from './project-switching/data'

/**
 * The project screen with the project rail
 * (docs/features/a-better-way-to-move-between-projects, decisions 2 and 3):
 * the rail and the sidebar inside a project, beside a plain stand-in for the
 * page. Below 768px wide it is the phone's list screen, the rail a strip across
 * its top. The states are the portfolio's. A dead end: links do nothing, and a
 * switch only changes which mock project is in front.
 */

applyStoredTheme()
installSilentEventSource()
makeDeadEnd()

type StateKey = 'busy' | 'quiet' | 'open' | 'many'

const STATES: Array<{ key: StateKey; label: string }> = [
  { key: 'busy', label: 'Busy' },
  { key: 'quiet', label: 'Quiet' },
  { key: 'open', label: 'Mid-switch' },
  { key: 'many', label: '14 projects' },
]

/** The project a "mid-switch" hover rests on. */
const HOVERED = 'proj_janalearn_updated'

function hintFor(state: StateKey, phone: boolean): string {
  if (state === 'busy')
    return 'runcastle in front: 2 need you, 3 running. JanaLearn_Updated waits on you (its dot); clawflow runs, which the rail leaves to All projects.'
  if (state === 'quiet') return 'Nothing needs you and nothing runs anywhere.'
  if (state === 'many') return '14 projects, two more waiting or running among them.'
  if (phone) return 'A phone has no hover: this is the busy screen.'
  return 'Hovering JanaLearn_Updated’s tile: its name, nothing else.'
}

function Screen({ sample, midSwitch, phone }: { sample: SampleKey; midSwitch: boolean; phone: boolean }) {
  const { projects, current, pick } = useMockProjects(sample, 'first')
  // The design page is about one screen: All projects is the other page, so a
  // pick of it here keeps the project in front.
  const onPick = (id: string | null) => id && pick(id)
  const here = current!

  if (phone) {
    return (
      <div className="relative isolate flex h-dvh min-h-0 flex-col bg-canvas p-2">
        <SidebarBackdrop />
        <PhoneStrip projects={projects} currentId={here.id} onPick={onPick} />
        <div className="flex h-11 shrink-0 items-center gap-1 px-1">
          <span className="truncate px-2 text-lg font-medium text-text">{here.name}</span>
          <span className="ml-auto">
            <IconButton label="New" size="lg" icon={<IconPlus />} />
          </span>
        </div>
        <div className="mt-2">
          <ProjectOrchestrator project={here} />
        </div>
        <div className="-mx-2 mt-4 min-h-0 flex-1 overflow-y-auto px-2 pb-2">
          <Lanes features={here.features} />
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-screen min-h-0 bg-canvas">
      {/* One ground for the rail and the sidebar: one halftone behind both. */}
      <div className="relative isolate flex h-full min-h-0 shrink-0">
        <SidebarBackdrop />
        <Rail projects={projects} currentId={here.id} onPick={onPick} hoverFirst={midSwitch ? HOVERED : undefined} />
        <nav aria-label="Project" className="relative isolate flex h-full min-h-0 w-[264px] shrink-0 flex-col p-2">
          <div className="flex h-10 shrink-0 items-center gap-0.5">
            <div className="flex min-w-0 flex-1">
              <span className="truncate px-2 text-sm font-semibold text-text">{here.name}</span>
            </div>
            <HeadButtons />
          </div>
          <div className="mt-3">
            <ProjectOrchestrator project={here} />
          </div>
          <div className={`${SCROLL} mt-4`}>
            <Lanes features={here.features} />
          </div>
          <StatusLine />
        </nav>
      </div>
      <Panel>
        <span>
          <span className="font-medium text-text-secondary">{here.name}</span>: the page beside the sidebar stays as it is.
        </span>
      </Panel>
    </div>
  )
}

function Page() {
  const [state, setState] = useState<StateKey>(() => readState(STATES))
  const phone = useIsPhone()
  const sample: SampleKey = state === 'open' ? 'busy' : state
  return (
    <>
      <Screen key={`${state}-${phone}`} sample={sample} midSwitch={state === 'open'} phone={phone} />
      <DesignPanel states={STATES} state={state} onState={setState} hint={hintFor(state, phone)} />
    </>
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
