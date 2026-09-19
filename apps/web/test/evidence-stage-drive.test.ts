import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { DriveState, TestNote } from '@runcastle/core'
import type { ReviewArtifacts } from '../src/lib/reviews'

/**
 * The stage's six drive states (decision 20) — tier 1, because what is asked
 * here is which words and which controls each state puts where the video would
 * be, and all of that is in the emitted markup.
 *
 * The capture chain itself is not tested here: `getDisplayMedia` exists in no
 * test environment, so the arithmetic between the drag and the PNG is extracted
 * into `lib/capture.ts` and pinned in `capture.test.ts`, and the chain around it
 * was proven end to end by the spike (decision 39).
 */
vi.mock('../src/trpc', () => {
  const mutation = () => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false })
  return {
    trpc: {
      useUtils: () => ({
        notes: { list: { invalidate: vi.fn() } },
        feature: { driveInfo: { invalidate: vi.fn() }, get: { invalidate: vi.fn() } },
        events: { invalidate: vi.fn() },
      }),
      notes: { add: { useMutation: mutation } },
      feature: { testDrive: { useMutation: mutation }, fixDrive: { useMutation: mutation } },
    },
  }
})
vi.mock('../src/lib/toast', () => ({ useToast: () => ({ push: vi.fn() }) }))

const { EvidenceStage } = await import('../src/components/review/EvidenceStage')

const RECORDING: ReviewArtifacts = {
  ticketId: 'tkt_1',
  seq: 4,
  lap: 1,
  passKind: 'review',
  reviewMode: null,
  reviewVerdict: null,
  reviewVerdictReason: null,
  reviewedCommit: 'abc1234def',
  completedAt: 1000,
  landedSince: 0,
  hasVideo: true,
  videoUrl: '/api/reviews/ticket/tkt_1/walkthrough.webm',
}

const SERVING = {
  branch: 'feature/x',
  devPaneId: 'pane_1',
  devUrl: 'http://localhost:5173',
  devReady: true,
}

const FAILURE = { command: 'bun setup', outcome: 'exited 3', output: 'port 5432 in use', canFix: true }

const render = (props: Partial<Parameters<typeof EvidenceStage>[0]> = {}): string =>
  renderToStaticMarkup(
    createElement(EvidenceStage, {
      featureId: 'ftr_1',
      branch: 'feature/x',
      recordings: [RECORDING],
      notes: [] as TestNote[],
      readonly: false,
      driveState: 'idle' as DriveState,
      dryRun: false,
      failure: null,
      expand: { expanded: false, set: () => undefined },
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

describe('the stage while the drive is starting', () => {
  it('says the dev server is coming up rather than showing an empty frame', () => {
    const html = render({ driveState: 'starting', drive: { branch: 'feature/x' } })
    expect(html).toContain('starting the dev server…')
    expect(html).not.toContain('walkthrough.webm')
  })

  it('carries the footer, so the boot output is one click away from the first second', () => {
    const html = render({ driveState: 'starting', drive: SERVING })
    expect(html).toContain('Show output')
  })
})

describe('the stage while the dev server is serving', () => {
  it('embeds the app and offers the ways out of it', () => {
    const html = render({ driveState: 'serving', drive: SERVING })
    expect(html).toContain('<iframe')
    expect(html).toContain('src="http://localhost:5173"')
    expect(html).toContain('sandbox="allow-scripts allow-same-origin allow-forms allow-popups"')
    expect(html).toContain('>Open app ↗<')
    expect(html).toContain('>Reload<')
  })

  it('offers Select area on a browser that can capture its own tab', () => {
    asChromium()
    const html = render({ driveState: 'serving', drive: SERVING })
    expect(html).toContain('>Select area<')
    expect(html).not.toContain('paste a screenshot into a note instead')
  })

  it('falls back to Open app and the paste hint where the tab cannot be captured', () => {
    const html = render({ driveState: 'serving', drive: SERVING })
    expect(html).not.toContain('>Select area<')
    expect(html).toContain('paste a screenshot into a note instead')
    expect(html).toContain('>Open app ↗<')
  })

  /** Decision 33a: a history view shows the app and writes nothing. */
  it('drops Select area on a readonly view even where the tab could be captured', () => {
    asChromium()
    const html = render({ driveState: 'serving', drive: SERVING, readonly: true })
    expect(html).toContain('<iframe')
    expect(html).not.toContain('>Select area<')
  })

  it('footers the dev-server chip, the branch and its output', () => {
    const html = render({ driveState: 'serving', drive: SERVING })
    expect(html).toContain('dev server')
    expect(html).toContain('feature/x')
    expect(html).toContain('Show output')
  })
})

describe('the stage over a bare checkout', () => {
  const bare = { driveState: 'bare-checkout' as DriveState, drive: { branch: 'feature/x' } }

  it('says nothing started, points at the setting, and offers the stop', () => {
    const html = render(bare)
    expect(html).toContain('Branch checked out — nothing started.')
    expect(html).toContain('This project has no dev command')
    expect(html).toContain('Set one in Settings')
    expect(html).toContain('>Stop test drive<')
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
    expect(html).toContain('<details>')
    expect(html).toContain('port 5432 in use')
  })

  it('offers Fix drive and the stop beside it', () => {
    const html = render(failed)
    expect(html).toContain('>Fix drive<')
    expect(html).toContain('>Stop test drive<')
  })
})

describe('the stage while the review agent drives', () => {
  const agent = { driveState: 'review-agent-driving' as DriveState, drive: SERVING }

  it('shows the app under a banner naming whose hands are on it', () => {
    const html = render(agent)
    expect(html).toContain('<iframe')
    expect(html).toContain('review agent driving — notes land below as it finds things')
  })

  it('offers the purpose-blind stop, so the human can take the wheel back', () => {
    expect(render(agent)).toContain('>Stop the review drive<')
  })

  it('says so plainly when the agent’s drive printed no address to show', () => {
    const html = render({ ...agent, drive: { branch: 'feature/x' } })
    expect(html).toContain('review agent driving')
    expect(html).toContain('there is nothing to show here')
  })
})

describe('the stage at rest', () => {
  it('gives the recording back when the drive stops', () => {
    expect(render({ driveState: 'idle' })).toContain('walkthrough.webm')
  })

  /**
   * Decision 8 killed the lead sentence and the explainer with it: the page
   * leads with state and one action, and what a drive does is learned by taking
   * one rather than read about beforehand.
   */
  it('explains nothing about test drives — the copy is gone, not demoted', () => {
    const html = render({ driveState: 'idle' })
    expect(html).not.toContain('A test drive checks this branch out')
    expect(html).not.toContain('What a test drive does')
    expect(html).not.toContain('puts you back on the branch you were on')
  })
})
