import { StrictMode, useState } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource-variable/geist'
import '@fontsource-variable/geist-mono'
import '../src/theme.css'
import '../src/styles.css'
import { TooltipProvider } from '../src/ui/tooltip'
import { Button, cx, IconButton, PropertyList } from '../src/ui'
import type { Crumb } from '../src/ui/page'
import { PageTopbar } from '../src/ui/page'
import { FeatureStatusLine } from '../src/components/workspace/FeatureStatusLine'
import { IconBranch, IconMore, IconOrchestrator, IconPanelRight, IconPlay, ProgressIcon } from '../src/icons'
import { applyStoredTheme, useTheme } from '../src/lib/theme'
import { installSilentEventSource } from '../../../.runcastle/preview/event-source'

/**
 * A feature's page names the thread holding it: the header's trail starts with
 * that thread, and a click opens it. Composed from the real header over sample
 * words. States at ?state=held | long | unheld, and the panel open at &panel=1.
 * A dead end: nothing navigates.
 */

applyStoredTheme()
installSilentEventSource()

const STATES = [
  { key: 'held', label: 'Held', holder: 'Project notes triage', thread: undefined },
  { key: 'side', label: 'Held, side thread in front', holder: 'Project notes triage', thread: 'Why does the bay draw square corners?' },
  { key: 'long', label: 'Long names', holder: 'Sidebar design alignment across app and the mobile layout', thread: undefined },
  { key: 'unheld', label: 'No holder', holder: null, thread: undefined },
] as const

const FEATURE = 'The sidebar shows only active threads'

function Page() {
  const params = new URLSearchParams(location.search)
  const [key, setKey] = useState(STATES.find((s) => s.key === params.get('state'))?.key ?? 'held')
  const [panel, setPanel] = useState(params.get('panel') === '1')
  const theme = useTheme()
  const state = STATES.find((s) => s.key === key)!

  const crumbs: Crumb[] = [
    ...(state.holder
      ? [
          {
            label: <span className="block max-w-44 truncate" title={`Held by the thread "${state.holder}"`}>{state.holder}</span>,
            icon: <IconOrchestrator size={14} />,
            onClick: () => {},
          },
        ]
      : []),
    { label: FEATURE, icon: <ProgressIcon state="active" progress={0.4} size={14} label="" /> },
    ...(state.thread ? [{ label: state.thread }] : []),
  ]

  return (
    <div className="flex h-screen flex-col bg-canvas">
      <div className="flex h-10 shrink-0 items-center gap-3 border-b border-border-subtle px-3 text-xs text-text-tertiary">
        <span>Sample</span>
        {STATES.map((s) => (
          <button
            key={s.key}
            type="button"
            onClick={() => setKey(s.key)}
            className={cx('h-6 cursor-pointer rounded-md px-2', s.key === key ? 'bg-surface-selected text-text' : 'hover:bg-surface-hover/50 hover:text-text-secondary')}
          >
            {s.label}
          </button>
        ))}
        <button type="button" onClick={theme.toggle} className="h-6 cursor-pointer rounded-md px-2 hover:bg-surface-hover/50 hover:text-text-secondary">
          {theme.resolved === 'dark' ? 'Light theme' : 'Dark theme'}
        </button>
      </div>
      <section className="m-2 flex min-w-0 flex-1 flex-col overflow-hidden rounded-lg border border-border bg-surface">
        <PageTopbar
          crumbs={crumbs}
          trail={!!state.thread}
          status={<FeatureStatusLine status={{ kind: 'ready', label: 'Ready for you', why: 'Test drive' }} />}
          actions={
            <>
              <Button size="md" icon={<IconPlay />}>Test drive</Button>
              <IconButton size="md" label="More" icon={<IconMore />} />
              <IconButton size="md" label="Panel" icon={<IconPanelRight />} active={panel} onClick={() => setPanel((v) => !v)} />
            </>
          }
        />
        <div className="flex min-h-0 flex-1">
          <div className="flex min-w-0 flex-1 items-center justify-center text-sm text-text-tertiary">The feature's chat</div>
          {panel && (
            <aside className="w-[560px] shrink-0 border-l border-border-subtle p-6">
              <PropertyList
                items={[
                  { label: 'Branch', leading: <IconBranch />, value: 'feature/the-sidebar-shows-only-active-threads', mono: true },
                  { label: 'Started', value: '2h ago' },
                ]}
              />
            </aside>
          )}
        </div>
      </section>
    </div>
  )
}

const rootEl = document.getElementById('root')
if (!rootEl) throw new Error('#root not found')
createRoot(rootEl).render(
  <StrictMode>
    <TooltipProvider>
      <Page />
    </TooltipProvider>
  </StrictMode>,
)
