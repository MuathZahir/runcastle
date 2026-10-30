import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { DriveState } from '@runcastle/core'

/**
 * The drive's states (decision 20), one stage for a feature's drive and the
 * Orchestrator's (test-drive-looks-the-part decision 3) — tier 1, because what
 * is asked here is which words and which controls each state puts where the app
 * will be, and all of that is in the emitted markup.
 *
 * The capture chain itself is not tested here: `getDisplayMedia` exists in no
 * test environment, so the arithmetic between the drag and the PNG is extracted
 * into `lib/capture.ts` and pinned in `capture.test.ts`.
 */
vi.mock('../src/trpc', () => {
  const mutation = () => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false })
  return {
    trpc: {
      useUtils: () => ({
        feature: { driveInfo: { invalidate: vi.fn() }, get: { invalidate: vi.fn() } },
        events: { invalidate: vi.fn() },
      }),
      feature: {
        fixDrive: { useMutation: mutation },
        runScenario: { useMutation: mutation },
        openScenarioChat: { useMutation: mutation },
        driveScenarios: { useQuery: () => ({ data: { runnerConfigured: true, scenarios: [] } }) },
      },
    },
  }
})
vi.mock('../src/lib/toast', () => ({ useToast: () => ({ push: vi.fn() }) }))
vi.mock('../src/lib/land-on-chat', () => ({ useLandOnChat: () => () => undefined }))

const { DriveStage } = await import('../src/components/review/DriveStage')

const SERVING = {
  branch: 'feature/x',
  devPaneId: 'pane_1',
  devUrl: 'http://localhost:5173',
  devReady: true,
}

const FAILURE = { command: 'bun setup', outcome: 'exited 3', output: 'port 5432 in use', canFix: true }

const render = (props: Partial<Parameters<typeof DriveStage>[0]> = {}): string =>
  renderToStaticMarkup(
    createElement(DriveStage, {
      projectId: 'proj_1',
      featureId: 'ftr_1',
      branch: 'feature/x',
      driveState: 'serving' as DriveState,
      drive: SERVING,
      failure: null,
      leading: createElement('i', null, 'the way back'),
      trailing: createElement('i', null, 'stop and toggle'),
      onCapture: () => undefined,
      ...props,
    }),
  )

afterEach(() => vi.unstubAllGlobals())

/** A browser that can capture its own tab — Chromium, with the API present. */
const asChromium = (): void => {
  vi.stubGlobal('navigator', {
    mediaDevices: { getDisplayMedia: () => undefined },
    userAgentData: {},
  })
}

describe('before the server has answered', () => {
  it('says the drive is starting, in the same head', () => {
    const html = render({ driveState: 'idle', drive: undefined })
    expect(html).toContain('Starting the test drive')
    expect(html).toContain('the way back')
    expect(html).toContain('stop and toggle')
  })

  it('says a preparation dry run is holding the drive rather than offering one', () => {
    expect(render({ driveState: 'idle', drive: undefined, dryRun: true })).toContain(
      'A preparation dry run is holding the drive',
    )
  })
})

describe('the stage while the drive is starting', () => {
  it('says the dev server is coming up rather than showing an empty frame', () => {
    const html = render({ driveState: 'starting', drive: { branch: 'feature/x' } })
    expect(html).toContain('Starting the dev server')
    expect(html).not.toContain('<iframe')
  })

  it('carries the status line, so the boot output is one click away from the first second', () => {
    expect(render({ driveState: 'starting' })).toContain('>Output<')
  })
})

describe('the stage while the dev server is serving', () => {
  it('embeds the app, under a head with the page’s two ends', () => {
    const html = render()
    expect(html).toContain('<iframe')
    expect(html).toContain('src="http://localhost:5173"')
    expect(html).toContain('sandbox="allow-scripts allow-same-origin allow-forms allow-popups"')
    expect(html).toContain('aria-label="Open app"')
    expect(html).toContain('aria-label="Reload"')
    expect(html).toContain('the way back')
    expect(html).toContain('stop and toggle')
  })

  it('offers Select area on a browser that can capture its own tab', () => {
    asChromium()
    const html = render()
    expect(html).toContain('aria-label="Select area"')
    expect(html).not.toContain('paste a screenshot into a note instead')
  })

  it('falls back to Open app and the paste hint where the tab cannot be captured', () => {
    const html = render()
    expect(html).not.toContain('aria-label="Select area"')
    expect(html).toContain('paste a screenshot into a note instead')
    expect(html).toContain('aria-label="Open app"')
  })

  it('puts the dev server, the branch and the output in the status line', () => {
    const html = render()
    expect(html).toMatch(/dev server/i)
    expect(html).toContain('feature/x')
    expect(html).toContain('>Output<')
  })

  it('adds the checkout on a project drive', () => {
    const html = render({ featureId: undefined, where: { text: '/repo @ abc', title: '/repo @ abc · runs as project-drive' } })
    expect(html).toContain('/repo @ abc')
  })

  it('says it is waiting when the server has printed no address yet', () => {
    expect(render({ drive: { branch: 'feature/x' } })).toContain('Waiting for an address')
  })
})

describe('the stage over a bare checkout', () => {
  const bare = { driveState: 'bare-checkout' as DriveState, drive: { branch: 'feature/x' } }

  it('says nothing started and points at the setting', () => {
    const html = render(bare)
    expect(html).toContain('Branch checked out, nothing started')
    expect(html).toContain('This project has no dev command')
    expect(html).toContain('Set one in Settings')
  })

  it('never claims a server it did not start', () => {
    expect(render(bare)).not.toContain('<iframe')
  })
})

describe('the stage over a failed setup', () => {
  const failed = {
    driveState: 'setup-failed' as DriveState,
    drive: { branch: 'feature/x' },
    failure: FAILURE,
  }

  it('names the command, how it ended, and puts its output behind a disclosure', () => {
    const html = render(failed)
    expect(html).toContain('Drive setup failed')
    expect(html).toContain('bun setup')
    expect(html).toContain('exited 3')
    expect(html).toContain('<details')
    expect(html).toContain('port 5432 in use')
  })

  it('offers Fix drive on a feature, and never a second Stop', () => {
    const html = render(failed)
    expect(html).toContain('>Fix drive<')
    expect(html).not.toContain('Stop test drive')
  })

  it('offers the project drive’s own way out in its place', () => {
    const html = render({ ...failed, featureId: undefined, failureExit: () => createElement('b', null, 'Open preparation') })
    expect(html).toContain('Open preparation')
    expect(html).not.toContain('>Fix drive<')
  })
})

describe('the stage while the review agent drives', () => {
  const agent = { driveState: 'review-agent-driving' as DriveState, drive: SERVING }

  it('keeps the app in view, and the head says whose hands are on it', () => {
    const html = render(agent)
    expect(html).toContain('<iframe')
    expect(html).toContain('Review agent driving')
    expect(html).toContain('stop and toggle')
  })

  it('says so plainly when the agent’s drive printed no address to show', () => {
    const html = render({ ...agent, drive: { branch: 'feature/x' } })
    expect(html).toMatch(/review agent driving/i)
    expect(html).toContain('No dev server answered')
  })
})
