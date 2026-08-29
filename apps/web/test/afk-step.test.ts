import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { AfkStep } from '../src/components/first-run/AfkStep'

/**
 * The wizard's one optional step (decision 4). Unasked, it renders no tRPC of
 * its own — the Enable-AFK card only mounts once the user says yes — so the
 * question and its two answers are tier-1 markup. That the card then appears is
 * a DOM question, and lives in `first-run-wizard.test.tsx`.
 */
const render = () =>
  renderToStaticMarkup(
    createElement(AfkStep, { onBack: () => undefined, onNext: () => undefined }),
  )

describe('AfkStep', () => {
  it('asks a question, explains it in one line, and offers two answers', () => {
    const html = render()
    expect(html).toContain('Run burns unattended?')
    expect(html).toContain('An AFK burn is a burn you walk away from')
    expect(html).toContain('Set up now')
    expect(html).toContain('Skip for now')
  })

  // The old step showed the whole Enable-AFK card — Docker, image, OAuth token
  // — to a user who had not opened a project yet (findings F13/F16).
  it('keeps the setup card out of sight until it is asked for', () => {
    expect(render()).not.toContain('Run features unattended')
  })

  // Two buttons that both meant continue is what decision 4 removes: `Skip for
  // now` is the only one, and it is the solid one.
  it('has exactly one continue affordance, and it is the primary', () => {
    const html = render()
    expect(html).not.toContain('Continue to your first project')
    const skip = html.slice(html.lastIndexOf('<button', html.indexOf('Skip for now')))
    expect(skip).toContain('bg-accent')
  })

  it('can go back, and carries no retired class names', () => {
    const html = render()
    expect(html).toContain('Back')
    expect(html).not.toMatch(/class="[^"]*\b(wizard-|op-)/)
  })
})
