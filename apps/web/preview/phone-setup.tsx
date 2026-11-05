import { StrictMode, useState } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource-variable/geist'
import '@fontsource-variable/geist-mono'
import '../src/theme.css'
import '../src/styles.css'
import { TooltipProvider } from '../src/ui/tooltip'
import { ToastProvider } from '../src/lib/toast'
import { cx } from '../src/ui'
import { applyStoredTheme, useTheme } from '../src/lib/theme'
import { PhoneLinkBody, type PhoneLinkView } from '../src/components/settings/PhoneLinkSection'
import { installSilentEventSource } from '../../../.runcastle/preview/event-source'

/**
 * Settings → General → "On your phone" (docs/features/ready-to-publish,
 * decisions 7 and 8): every state the section can be in, with sample
 * statuses. The steps on the phone show greyed until the link is on. A dead
 * end on purpose: links do nothing, and Turn on / Try again / Turn off only
 * move between the sample states.
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

const URL = 'https://studio.tail4e2a1.ts.net:4512'
const COMMANDS = ['tailscale serve --bg --https=4512 http://127.0.0.1:4512', 'tailscale serve --bg --https=4514 http://127.0.0.1:4514']

type Stage = 'missing' | 'stopped' | 'off' | 'https' | 'on' | 'failed'
const STAGES: { key: Stage; label: string; link: PhoneLinkView }[] = [
  { key: 'missing', label: 'No Tailscale', link: { tailscale: 'missing', on: false, commands: COMMANDS } },
  { key: 'stopped', label: 'Tailscale stopped', link: { tailscale: 'stopped', on: false, commands: COMMANDS } },
  { key: 'off', label: 'Ready to turn on', link: { tailscale: 'running', on: false, url: URL, commands: COMMANDS } },
  {
    key: 'https',
    label: 'Tailnet needs HTTPS',
    link: {
      tailscale: 'running',
      on: false,
      url: URL,
      commands: COMMANDS,
      httpsNeeded: 'https://login.tailscale.com/f/serve?node=nKx2Q7CNTRL',
    },
  },
  { key: 'on', label: 'On', link: { tailscale: 'running', on: true, url: URL, commands: COMMANDS } },
  {
    key: 'failed',
    label: 'Failed',
    link: {
      tailscale: 'running',
      on: false,
      url: URL,
      commands: ['sudo tailscale set --operator=$USER', ...COMMANDS],
      error: 'Access denied: serve config denied',
    },
  },
]

function Page() {
  const [stage, setStage] = useState<Stage>(
    () => STAGES.find((s) => s.key === new URLSearchParams(location.search).get('state'))?.key ?? 'off',
  )
  const theme = useTheme()
  const chip = (on: boolean) =>
    cx('h-6 shrink-0 cursor-pointer rounded-md px-2', on ? 'bg-surface-selected text-text' : 'hover:bg-surface-hover/50 hover:text-text-secondary')
  const link = STAGES.find((s) => s.key === stage)?.link
  return (
    <div className="flex min-h-screen flex-col bg-canvas">
      <div className="flex h-10 shrink-0 items-center gap-1 overflow-x-auto border-b border-border-subtle px-3 text-xs whitespace-nowrap text-text-tertiary">
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
      <div className="flex flex-1 justify-center p-8">
        {/* The Settings dialog's page column, without the dialog around it. */}
        <div className="w-full max-w-[680px] self-start rounded-lg bg-surface-raised px-8 py-7 shadow-dialog">
          <PhoneLinkBody
            link={link}
            onTurnOn={() => setStage(stage === 'off' ? 'https' : 'on')}
            onTurnOff={() => setStage('off')}
          />
        </div>
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
