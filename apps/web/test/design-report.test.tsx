// @vitest-environment happy-dom
import { act, cleanup, render } from '@testing-library/react'
import { useRef } from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import { DESIGN_REPORT_DEBOUNCE_MS, useDesignReport } from '../src/lib/use-design-report'
import { fakeTrpc } from './fake-trpc'

/**
 * The design view's listener (agents-see-the-tweaks-you-picked decision 5): a
 * fake design frame posts reports, and the last of a burst reaches
 * `design.report` once they settle. A message from any other window, or one that
 * is not a report, is ignored. Tier 2: it is window messages from a real frame.
 */

afterEach(cleanup)

function Frame({ designId }: { designId: string | undefined }) {
  const frame = useRef<HTMLIFrameElement>(null)
  useDesignReport(frame, designId)
  return <iframe ref={frame} title="The design" />
}

function setup(designId: string | undefined) {
  const fake = fakeTrpc({ 'design.report': () => ({ ok: true }) })
  const view = render(
    <fake.Wrapper>
      <Frame designId={designId} />
    </fake.Wrapper>,
  )
  const frame = view.container.querySelector('iframe')!
  return { ...fake, view, frameWindow: frame.contentWindow as unknown as Window }
}

/** A window message as the browser delivers it, from `source`. */
function post(data: unknown, source: Window | null) {
  act(() => {
    window.dispatchEvent(new MessageEvent('message', { data, source }))
  })
}

const wait = (ms: number) => act(() => new Promise<void>((resolve) => setTimeout(resolve, ms)))

describe('useDesignReport', () => {
  it('sends the last report of a burst from its frame, once it settles', async () => {
    const { inputs, frameWindow } = setup('design_a')
    expect(frameWindow).toBeTruthy()
    post({ type: 'runcastle:design', state: 'full', tweaks: { accent: 'red' } }, frameWindow)
    post({ type: 'runcastle:design', state: 'full', tweaks: { accent: 'teal' } }, frameWindow)
    await wait(DESIGN_REPORT_DEBOUNCE_MS / 3)
    expect(inputs('design.report')).toEqual([])

    await wait(DESIGN_REPORT_DEBOUNCE_MS + 100)
    expect(inputs('design.report')).toEqual([
      { designId: 'design_a', report: { type: 'runcastle:design', state: 'full', tweaks: { accent: 'teal' } } },
    ])
  })

  it('ignores a post from another window, and a message that is not a report', async () => {
    const { inputs, frameWindow } = setup('design_a')
    post({ type: 'runcastle:design', state: 'full', tweaks: { accent: 'teal' } }, window)
    post({ type: 'runcastle:design', state: 'full', tweaks: { accent: 'teal' } }, null)
    post({ type: 'webpackOk' }, frameWindow)
    post('runcastle:design', frameWindow)
    await wait(DESIGN_REPORT_DEBOUNCE_MS + 100)
    expect(inputs('design.report')).toEqual([])
  })

  it('sends a report still pending when the view goes, and nothing without a recorded design', async () => {
    const shown = setup('design_a')
    post({ type: 'runcastle:design', state: null, tweaks: {} }, shown.frameWindow)
    shown.view.unmount()
    await wait(0)
    expect(shown.inputs('design.report')).toEqual([{ designId: 'design_a', report: { type: 'runcastle:design', state: null, tweaks: {} } }])

    const unrecorded = setup(undefined)
    post({ type: 'runcastle:design', state: null, tweaks: {} }, unrecorded.frameWindow)
    await wait(DESIGN_REPORT_DEBOUNCE_MS + 100)
    expect(unrecorded.inputs('design.report')).toEqual([])
  })
})
