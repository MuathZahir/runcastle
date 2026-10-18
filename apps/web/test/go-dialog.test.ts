import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { GoConfirmation } from '../src/components/GoFeatureDialog'
import { goSummary } from '../src/lib/feature-ui'

/**
 * Go (`the-feature-lead-runs-rounds` decision 8): the human's one click that
 * approves the plan and hands the feature to its agent. What is asserted here
 * is what it SAYS and that nothing behind the warnings — or behind an empty
 * plan — is disabled. Tier 1: the Dialog primitive's own mechanics are covered
 * once in `dialog.test.tsx`.
 */
const NO_SPEC = 'no spec.md on disk — this lap will burn tickets that no written spec backs.'
const UNDISPOSITIONED = '1 defect from an earlier lap is still un-dispositioned: "the pane flickers"'

const summary = (over: Partial<Parameters<typeof goSummary>[0]> = {}) =>
  goSummary({
    branch: 'feature/greetings-pages',
    pendingTickets: [{}, {}],
    defaultModel: 'claude-opus-4',
    ...over,
  })

const render = (props: Partial<Parameters<typeof GoConfirmation>[0]> = {}): string =>
  renderToStaticMarkup(
    createElement(GoConfirmation, {
      title: 'Greetings pages',
      branch: 'feature/greetings-pages',
      summary: summary(),
      busy: false,
      onConfirm: () => undefined,
      onCancel: () => undefined,
      ...props,
    }),
  )

describe('GoFeatureDialog', () => {
  it('is read-to-confirm: one primary that says Go, never Burn', () => {
    const html = render()
    expect(html).toContain('>Go<')
    expect(html).not.toContain('Burn')
    expect(html).not.toContain('<input')
    expect(html).not.toContain('disabled=""')
  })

  it('states the plan and the model — no autonomy to choose', () => {
    const html = render()
    expect(html).toContain('2 tickets')
    expect(html).toContain('claude-opus-4')
    expect(html).not.toMatch(/Run until ready|Ask before each round/)
  })

  it('says the agent runs rounds until it is ready for you, and asks before what the plan did not settle', () => {
    expect(render()).toContain(
      'The agent runs rounds of workers on feature/greetings-pages until it is ready for you to test drive, and asks you before anything the plan did not settle.',
    )
  })

  it('goes with zero tickets — the agent may do it itself', () => {
    const html = render({ summary: summary({ pendingTickets: [] }) })
    expect(html).toContain('No tickets — the agent may do it itself')
    expect(html).not.toContain('disabled=""')
  })

  it('names every model the plan is assigned to, beside the project default', () => {
    const html = render({ summary: summary({ pendingTickets: [{ model: 'claude-sonnet-4' }, {}] }) })
    expect(html).toContain('claude-sonnet-4')
    expect(html).toContain('claude-opus-4')
  })

  describe('the warnings box', () => {
    it('shows nothing at all when the server computed no warnings', () => {
      expect(render()).not.toContain('aria-label="Warnings"')
    })

    it('lists every warning without disabling Go', () => {
      const html = render({ summary: summary({ warnings: [NO_SPEC, UNDISPOSITIONED] }) })
      expect(html).toContain('aria-label="Warnings"')
      expect(html.match(/<li>/g)).toHaveLength(2)
      expect(html).not.toContain('disabled=""')
    })

    it('says the check is still running rather than holding the button back', () => {
      const html = render({ warningsPending: true })
      expect(html).toContain('Still checking for warnings…')
      expect(html).not.toContain('disabled=""')
    })
  })
})
