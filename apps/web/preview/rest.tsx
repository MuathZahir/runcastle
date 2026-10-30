import { MutationCache, QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { StrictMode, useState } from 'react'
import type { ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource-variable/geist'
import '@fontsource-variable/geist-mono'
import '../src/theme.css'
import '../src/styles.css'
import { trpc, trpcLinks } from '../src/trpc'
import { TooltipProvider } from '../src/ui/tooltip'
import { ToastProvider } from '../src/lib/toast'
import { applyStoredTheme } from '../src/lib/theme'
import { wizardSteps } from '../src/lib/first-run'
import { AfkStep } from '../src/components/first-run/AfkStep'
import { SetupFrame } from '../src/components/first-run/StepLayout'
import { WizardRail } from '../src/components/first-run/WizardRail'
import { OpenProject } from '../src/components/OpenProject'
import { Frame, FrameProvider } from '../src/components/Frame'
import { DeleteFeatureDialog } from '../src/components/DeleteFeatureDialog'
import { MergeFeatureDialog } from '../src/components/MergeFeatureDialog'
import type { MergeSummary } from '../src/lib/feature-ui'
import { AppAt } from '../../../.runcastle/preview/app-at'
import { fakeTrpcFetch } from '../../../.runcastle/preview/fake-api'
import type { TrpcFakes } from '../../../.runcastle/preview/fake-api'
import { installSilentEventSource } from '../../../.runcastle/preview/event-source'
import { PROJECT_ID, withShell } from '../../../.runcastle/preview/shell-fakes'
import {
  doctorFresh,
  doctorHalfDone,
  featuresOf,
  imageTarget,
  globalSettings,
  listing,
  prep,
  projects,
  projectSettings,
  roots,
} from './rest-data'

/**
 * The screens seen least, on sample data: the all-projects home, settings, the
 * first-run wizard, the command palette and the dialogs. One page per state,
 * named by `?state=` (docs/features/the-rest-of-the-app-looks-the-part). A state
 * behind clicks is reached by making them. A dead end on purpose: links and
 * navigation do nothing here, and every write is refused.
 */

const params = new URLSearchParams(location.search)
const state = params.get('state') ?? 'home'
const themed = params.get('theme')
const remembered = themed ? localStorage.setItem('runcastle.theme', themed) : undefined

applyStoredTheme()
installSilentEventSource()
document.addEventListener(
  'click',
  (e) => {
    if ((e.target as Element | null)?.closest?.('a[href]')) e.preventDefault()
  },
  true,
)

const settings = {
  get: (input: unknown) => ((input as { projectId?: string } | undefined)?.projectId ? projectSettings : globalSettings),
}
const picker = { roots: () => roots, browse: () => listing }

const inProject: TrpcFakes = {
  project: { prep: () => prep, ...picker },
  setup: { doctor: () => doctorHalfDone, imageBuildTarget: () => imageTarget },
  settings,
  thread: { list: () => [] },
  feature: { list: featuresOf, driveInfo: () => null },
}
const portfolio: TrpcFakes = {
  project: { list: () => projects, ...picker },
  feature: { list: featuresOf, driveInfo: () => null },
}
const wizard: TrpcFakes = {
  project: { list: () => [], ...picker },
  setup: { doctor: () => doctorFresh, imageBuildTarget: () => imageTarget, gitIdentity: () => undefined as never },
}

type Step = () => HTMLElement | null | undefined

const byText = (text: string, scope = 'button') =>
  [...document.querySelectorAll<HTMLElement>(scope)].find((el) => el.textContent?.trim() === text)

/** Clicks are made in order, each once its target is on screen. */
async function play(steps: Step[]) {
  for (const step of steps) {
    for (let tries = 0; tries < 200; tries++) {
      const el = step()
      if (el) {
        el.click()
        break
      }
      await new Promise((r) => setTimeout(r, 25))
    }
    await new Promise((r) => setTimeout(r, 120))
  }
}

const settingsButton: Step = () => document.querySelector<HTMLElement>('[aria-label="Settings"]')
const openSettingsAt = (page: string): Step[] => [settingsButton, () => byText(page, '[role=dialog] button')]
const fill =
  (selector: string, value: string): Step =>
  () => {
    const input = document.querySelector<HTMLInputElement>(selector)
    if (!input) return null
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
    return input
  }

const summary = {
  headline: 'Slack alerts on failed runs',
  rows: [
    { key: 'commits', label: 'Commits', value: '12 commits, 31 files', tone: 'ok' },
    { key: 'review', label: 'Review', value: 'Passed, 2 findings fixed', tone: 'ok' },
  ],
  warnings: ['Ticket #4 was waived, not landed.'],
  next: 'Merges into main, then removes the worktree.',
} as unknown as MergeSummary

type Scene = { path: string; fakes: TrpcFakes; steps?: Step[]; over?: ReactNode; screen?: ReactNode }

const project = `/p/${PROJECT_ID}/conversations`
const noop = () => {}
const mergeProps = {
  title: 'Slack alerts on failed runs',
  branch: 'feature/slack-alerts',
  base: 'main',
  busy: false,
  onConfirm: noop,
  onCancel: noop,
}

/** A wizard step past the hard ones, which the doctor's one answer cannot reach by clicking. */
const lateStep = (step: 'afk' | 'project', body: ReactNode): ReactNode => (
  <FrameProvider notices={null}>
    <div className="h-full bg-canvas">
      <Frame>
        <div className="min-h-0 min-w-0 flex-1 overflow-y-auto">
          {step === 'project' ? (
            body
          ) : (
            <SetupFrame rail={<WizardRail steps={wizardSteps(step, undefined)} />} stepKey={step}>
              {body}
            </SetupFrame>
          )}
        </div>
      </Frame>
    </div>
  </FrameProvider>
)

const quietPortfolio: TrpcFakes = { ...portfolio, feature: { list: () => [], driveInfo: () => null } }

const SCENES: Record<string, Scene> = {
  home: { path: '/', fakes: portfolio },
  'home-quiet': { path: '/', fakes: quietPortfolio },
  'update-notice': {
    path: '/',
    fakes: {
      ...portfolio,
      system: {
        checkUpdate: () => ({
          current: '0.9.0',
          latest: '0.10.0',
          updateAvailable: true,
          command: 'bun add -g runcastle@latest',
        }),
      },
    },
  },
  'open-dialog': { path: '/', fakes: portfolio, steps: [() => byText('Open a project')] },
  'open-failed': {
    path: '/',
    fakes: portfolio,
    steps: [() => byText('Open a project'), fill('#open-repo-path', 'code/runcastle'), () => byText('Open')],
  },
  picker: { path: '/', fakes: portfolio, steps: [() => byText('Open a project'), () => byText('Browse…')] },
  'settings-general': { path: project, fakes: inProject, steps: openSettingsAt('General') },
  'settings-models': { path: project, fakes: inProject, steps: openSettingsAt('Models') },
  'settings-workers': { path: project, fakes: inProject, steps: openSettingsAt('Workers') },
  'settings-project': { path: project, fakes: inProject, steps: openSettingsAt('This project') },
  palette: { path: project, fakes: inProject },
  'palette-empty': { path: project, fakes: inProject },
  backlog: {
    path: project,
    fakes: inProject,
    steps: [
      () => {
        const create = document.querySelector<HTMLElement>('[aria-label="Create"]')
        create?.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, pointerType: 'mouse' }))
        return create
      },
      () => [...document.querySelectorAll<HTMLElement>('[role=menuitem]')].find((el) => el.textContent?.startsWith('Add to backlog')),
    ],
  },
  'wizard-intro': { path: '/', fakes: wizard },
  'wizard-identity': { path: '/', fakes: wizard, steps: [() => byText('Set up runcastle')] },
  'wizard-runtimes': {
    path: '/',
    fakes: wizard,
    steps: [
      () => byText('Set up runcastle'),
      fill('#wiz-name', 'Ada Lovelace'),
      fill('#wiz-email', 'ada@example.com'),
      () => byText('Continue'),
    ],
  },
  'wizard-afk': { path: '/', fakes: wizard, screen: lateStep('afk', <AfkStep onBack={noop} onNext={noop} />) },
  'wizard-afk-setup': {
    path: '/',
    fakes: wizard,
    screen: lateStep('afk', <AfkStep onBack={noop} onNext={noop} />),
    steps: [() => byText('Set up now')],
  },
  'wizard-project': {
    path: '/',
    fakes: wizard,
    screen: lateStep(
      'project',
      <OpenProject firstRun rail={<WizardRail steps={wizardSteps('project', undefined)} />} onOpened={noop} onCancel={noop} />,
    ),
  },
  merge: { path: project, fakes: inProject, over: <MergeFeatureDialog {...mergeProps} summary={summary} /> },
  'merge-conflict': {
    path: project,
    fakes: inProject,
    over: (
      <MergeFeatureDialog
        {...mergeProps}
        summary={{ ...summary, conflictRow: 'This branch conflicts with main in 3 files.' }}
        onResolve={noop}
      />
    ),
  },
  delete: {
    path: project,
    fakes: inProject,
    over: (
      <DeleteFeatureDialog
        title="Slack alerts on failed runs"
        slug="slack-alerts"
        busy={false}
        onConfirm={noop}
        onCancel={noop}
      />
    ),
  },
}
const scene = SCENES[state] ?? SCENES.home!

function Root() {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        mutationCache: new MutationCache(),
        defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
      }),
  )
  const [client] = useState(() =>
    trpc.createClient({ links: trpcLinks('/api/trpc', fakeTrpcFetch('/api/trpc', withShell(scene.fakes))) }),
  )
  return (
    <trpc.Provider client={client} queryClient={queryClient}>
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          <ToastProvider>
            {scene.screen ?? <AppAt path={scene.path} />}
            {scene.over}
          </ToastProvider>
        </TooltipProvider>
      </QueryClientProvider>
    </trpc.Provider>
  )
}

/** Back to this page's own address once the app has read its own, as preview/app.tsx does. */
const previewAddress = location.pathname + location.search
setTimeout(() => window.history.replaceState(null, '', previewAddress), 1000)

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Root />
  </StrictMode>,
)

void remembered
if (scene.steps) void play(scene.steps)
if (state.startsWith('palette'))
  setTimeout(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true })), 800)
if (state === 'palette-empty')
  void play([() => (document.querySelector('[role=dialog] input') ? fill('[role=dialog] input', 'zzz')() : null)])
