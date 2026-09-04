import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { WizardRail } from '../src/components/first-run/WizardRail'
import { wizardSteps, type ProbeLike } from '../src/lib/first-run'

/**
 * The rail's promise (finding F13): every setup step is on it, and a step the
 * host satisfied says so out loud rather than being crossed off in silence.
 * Markup is the whole of this component's behaviour, so tier 1 (STYLE.md).
 */

const ok: ProbeLike = { status: 'ok', detail: 'Ada Lovelace <ada@example.com>' }
const unset: ProbeLike = { status: 'unset', detail: 'user.email not set — commits would fail' }

const render = (current: 'identity' | 'runtimes' | 'afk', identity: ProbeLike) =>
  renderToStaticMarkup(createElement(WizardRail, { steps: wizardSteps(current, identity) }))

describe('WizardRail', () => {
  it('names every step, whichever one is showing', () => {
    const html = render('runtimes', unset)
    for (const label of ['Git identity', 'Coding agents', 'AFK burns', 'First project']) {
      expect(html).toContain(label)
    }
  })

  it('paints the current step in the accent and leaves the rest behind it', () => {
    const html = render('runtimes', unset)
    expect(html).toContain('text-accent-hi')
    expect(html).toContain('text-text-2')
    expect(html).toContain('text-text-4')
  })

  it('says what a step the host passed for us actually found', () => {
    const html = render('afk', ok)
    expect(html).toContain('detected from git config: Ada Lovelace')
    expect(html).toContain('text-ok')
  })

  // The detail line is the passed row's whole point — a rail that only went
  // green would be the silent skip this replaced.
  it('adds no detail line when nothing was detected', () => {
    expect(render('afk', unset)).not.toContain('detected from git config')
  })

  // Legacy rules are unlayered and beat utilities (apps/web/STYLE.md), so a
  // leftover class name would silently override the new styling.
  it('carries no retired class names', () => {
    expect(render('afk', ok)).not.toMatch(/class="[^"]*\b(wizard-|op-)/)
  })
})
