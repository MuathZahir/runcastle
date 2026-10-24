import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { NextStep } from '../src/lib/feature-ui'
import { featureStatus, headerActions } from '../src/lib/feature-ui/status-line'
import { ToastProvider } from '../src/lib/toast'
import { FeatureHeader } from '../src/components/workspace/FeatureHeader'
import { FeatureStatusLine } from '../src/components/workspace/FeatureStatusLine'
import { HeaderAction } from '../src/components/workspace/HeaderAction'
import { PageTopbar } from '../src/ui'
import { full } from './fixtures'

/**
 * The feature page's header as `Workspace` composes it (`the-feature-lead-runs-
 * rounds` decision 24, design-mode decision 12): the one header row — title,
 * status line and at most one action — over the title and one meta line;
 * nothing else above the content.
 *
 * Reproduced first on a review-phase feature in the shape the human drove in
 * lap 1: before this change the same composition rendered the phase stepper,
 * the "Run until ready / Ask before each round" switch, "1.7M tokens" and an
 * "Agent" button beside the status, and this test failed on the stepper.
 */
const review = full().feature

/** The review resolver's row, with everything the lap-1 header used to show. */
const ns: NextStep = {
  kick: '',
  busy: false,
  primary: { label: 'Start test drive', kind: 'testDriveStart' },
  secondary: [
    { label: 'Chat', kind: 'chat' },
    { label: 'Merge & ship', kind: 'merge' },
    { label: 'Resolve conflict', kind: 'resolveConflict' },
  ],
}

function header(over: { driving?: boolean; running?: boolean } = {}): string {
  const status = featureStatus({
    feature: review,
    rounds: [{ round: 1, status: over.running ? 'running' : 'succeeded', startedAt: 10 }],
    declarations: [{ scenario: 'Checkout', createdAt: 20 }],
    agentWorking: false,
    driving: over.driving ?? false,
    selfPlanning: false,
    now: 0,
  })
  const row = headerActions(ns, status)
  // The header row's left and its one action, as `Workspace` composes them
  // (design-mode decision 12), over the body's title and meta line.
  return renderToStaticMarkup(
    createElement(
      ToastProvider,
      null,
      createElement(PageTopbar, {
        crumbs: [{ label: review.title }],
        status: createElement(FeatureStatusLine, { status }),
        actions: row.action && createElement(HeaderAction, { action: row.action, busy: false, onAction: () => undefined }),
      }),
      createElement(FeatureHeader, { feature: review, isDraft: false, facts: [{ text: 'Started 15m ago' }] }),
      createElement('div', { 'data-overflow': row.overflow.map((a) => a.label).join('|') }),
    ),
  )
}

/** The visible label of every button in the row (icons render as SVG, not text). */
const buttons = (html: string): string[] =>
  [...html.matchAll(/<button[^>]*>([\s\S]*?)<\/button>/g)].map((m) => m[1]!.replace(/<[^>]*>/g, '').trim())

describe('the feature page header', () => {
  it('is the title, one meta line and the status line — no stepper, switch, token figure or Agent button', () => {
    const html = header()
    expect(html).toContain(review.title)
    expect(html).toContain('Started 15m ago')
    expect(html).toContain('Ready for you')
    expect(html).toContain('Test drive ▸ Checkout')
    expect(html).not.toContain('aria-label="Pipeline"')
    expect(html).not.toContain('Autonomy')
    expect(html).not.toMatch(/Run until ready|Ask before each round/)
    expect(html).not.toContain('tokens')
    expect(buttons(html)).not.toContain('Agent')
    expect(html).not.toContain('Agent live')
  })

  it('has exactly one action — Start test drive when ready — Merge & ship and the rest in ⋯', () => {
    const html = header()
    expect(html.match(/<button[^>]*class="[^"]*\bbg-primary\b/g) ?? []).toHaveLength(1)
    const labels = buttons(html)
    expect(labels).toContain('Start test drive')
    expect(labels).not.toContain('Merge &amp; ship')
    expect(html).toContain('data-overflow="Merge &amp; ship|Resolve conflict"')
    expect(labels.some((l) => /burn/i.test(l))).toBe(false)
  })

  it('swaps the primary for Stop drive while driving, and Stop while a round runs', () => {
    expect(buttons(header({ driving: true }))).toContain('Stop drive')
    expect(buttons(header({ driving: true }))).not.toContain('Start test drive')
    expect(buttons(header({ running: true }))).toContain('Stop')
  })

  it('says nothing of what to test — the agent says it in the chat', () => {
    expect(header()).not.toContain('What to test')
  })
})
