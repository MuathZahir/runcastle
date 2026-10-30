import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource-variable/geist'
import '@fontsource-variable/geist-mono'
import '../src/theme.css'
import '../src/styles.css'
import { TooltipProvider } from '../src/ui/tooltip'
import { ToastProvider } from '../src/lib/toast'
import { applyStoredTheme } from '../src/lib/theme'
import { IconButton, SplitButton } from '../src/ui'
import { PageTopbar } from '../src/ui/page'
import { IconMore, IconPlay, ProgressIcon } from '../src/icons'
import { FeatureStatusLine } from '../src/components/workspace/FeatureStatusLine'
import { FeatureDriveView } from '../src/components/review/FeatureDriveView'
import { ScenarioPickerContent } from '../src/components/review/ScenarioPicker'
import { scenarioMenu, testDriveLabel } from '../src/lib/feature-ui/scenarios'
import { installSilentEventSource } from '../../../.runcastle/preview/event-source'
import { withShell } from '../../../.runcastle/preview/shell-fakes'
import { full } from '../test/fixtures'
import { BRANCH, DRIVE_MOMENTS, FEATURE_ID, FEATURE_NOTES, SCENARIOS, type DriveMoment } from './drive-data'
import { Api, MomentBar, useClickAfterLoad, useMoment } from './drive-kit'

/**
 * The feature's test drive as the page (docs/features/test-drive-looks-the-part):
 * the real drive page over faked server answers, one moment per drive state, and
 * the header's Test drive button with its scenario picker before a drive. A dead
 * end on purpose: links and navigation do nothing, and every write is refused.
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
const TITLE = 'Checkout coupons'
const feature = full({ id: FEATURE_ID, title: TITLE, branch: BRANCH, projectId: 'proj_1' })

interface Moment extends DriveMoment {
  /** Open this after load: the drive's scenario control, or the header's caret. */
  click?: string
}

const MOMENTS: Moment[] = [
  ...DRIVE_MOMENTS.map((m) => ({ ...m, ...(m.pickerOpen ? { click: '[data-scenario-trigger]' } : {}) })),
  {
    key: 'start',
    label: 'Choosing where to start',
    drive: null,
    scenarios: SCENARIOS,
    click: '[aria-label="Choose a scenario"]',
  },
]

function fakesFor(moment: DriveMoment) {
  return withShell({
    feature: {
      driveInfo: () => moment.drive,
      driveScenarios: () => ({ scenarios: moment.scenarios, runnerConfigured: true }),
    },
    notes: {
      list: () => (moment.noNotes ? [] : FEATURE_NOTES(Date.now())),
      delivery: () => ({ waitingSince: null, lastFailure: null }),
    },
  } as Parameters<typeof withShell>[0])
}

function FeaturePage({ moment }: { moment: Moment }) {
  useClickAfterLoad(moment.click)
  const menu = scenarioMenu(SCENARIOS, { withOwnSection: true, runnerConfigured: true })
  return (
    <section className="flex min-h-0 flex-1 flex-col overflow-clip rounded-lg border border-border bg-surface" aria-label={TITLE}>
      {moment.drive ? (
        <FeatureDriveView full={feature} stopping={false} onBack={noop} onStop={noop} />
      ) : (
        <PageTopbar
          crumbs={[{ label: TITLE, icon: <ProgressIcon state="active" progress={1} size={14} label="" /> }]}
          status={<FeatureStatusLine status={{ kind: 'ready', label: 'Ready for you', why: 'try the expired coupon' }} />}
          actions={
            <>
              <span className="mr-1 flex">
                <SplitButton
                  size="sm"
                  variant="primary"
                  icon={<IconPlay />}
                  onClick={noop}
                  menuLabel="Choose a scenario"
                  picker={<ScenarioPickerContent menu={menu} onPick={noop} align="end" />}
                >
                  {testDriveLabel(menu.defaultScenario, 'Start test drive')}
                </SplitButton>
              </span>
              <IconButton label="More" icon={<IconMore />} />
            </>
          }
        />
      )}
    </section>
  )
}

function Page() {
  const [moment, setMoment] = useMoment(MOMENTS)
  return (
    <div className="flex h-screen flex-col bg-canvas">
      <MomentBar moments={MOMENTS} current={moment.key} onPick={setMoment} />
      <div className="flex min-h-0 flex-1 p-2">
        <Api key={moment.key} fakes={fakesFor(moment)}>
          <FeaturePage moment={moment} />
        </Api>
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
