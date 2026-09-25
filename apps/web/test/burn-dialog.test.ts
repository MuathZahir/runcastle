import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { BurnConfirmation } from '../src/components/BurnFeatureDialog'
import { burnLap, burnSummary } from '../src/lib/feature-ui'

/**
 * The first of the two human clicks (decisions §5). Every refusal the old gates
 * made at this door is a warning inside this dialog now, so what is asserted
 * here is what it SAYS and that nothing behind the warnings is disabled. Tier 1:
 * the Dialog primitive's own mechanics are covered once in `dialog.test.tsx`.
 */
const NO_REVIEW_TICKET =
  'no review ticket in this batch — every lap closes with one (kind: "review").'
const UNDISPOSITIONED = '1 defect from an earlier lap is still un-dispositioned: "the pane flickers"'
const NO_SPEC = 'no spec.md on disk — this lap will burn tickets that no written spec backs.'

const summary = (over: Partial<Parameters<typeof burnSummary>[0]> = {}) =>
  burnSummary({
    branch: 'feature/greetings-pages',
    pendingTickets: [{ lap: 2 }, { lap: 2 }],
    lap: 2,
    defaultModel: 'claude-opus-4',
    ...over,
  })

const render = (props: Partial<Parameters<typeof BurnConfirmation>[0]> = {}): string =>
  renderToStaticMarkup(
    createElement(BurnConfirmation, {
      title: 'Greetings pages',
      branch: 'feature/greetings-pages',
      summary: summary(),
      busy: false,
      onConfirm: () => undefined,
      onCancel: () => undefined,
      ...props,
    }),
  )

describe('BurnFeatureDialog', () => {
  describe('the summary', () => {
    it('is read-to-confirm: no typing to arm, one primary that burns', () => {
      const html = render()
      expect(html).toContain('Burn')
      expect(html).not.toContain('<input')
      expect(html).not.toContain('disabled=""')
    })

    it('states what burns, the lap it stamps and the model', () => {
      const html = render()
      expect(html).toContain('What burns')
      expect(html).toContain('2 tickets')
      expect(html).toContain('lap 2 — stamped by this click')
      expect(html).toContain('claude-opus-4')
    })

    it('names the tickets a burn drags along from an earlier lap', () => {
      const html = render({
        summary: summary({ pendingTickets: [{ lap: 2 }, { lap: 1 }], lap: 2 }),
      })
      expect(html).toContain('2 tickets · 1 carried from earlier laps')
    })

    it('names every model the batch is assigned to, beside the project default', () => {
      const html = render({
        summary: summary({
          pendingTickets: [{ lap: 2, model: 'claude-sonnet-4' }, { lap: 2 }],
        }),
      })
      expect(html).toContain('claude-sonnet-4')
      expect(html).toContain('claude-opus-4')
    })

    it('says what the button will actually do', () => {
      expect(render()).toContain(
        'Burns 2 tickets in parallel sandboxes, each committing to feature/greetings-pages, and moves the feature to Building.',
      )
    })
  })

  /**
   * The three ex-refusals (decision 5). They arrive computed — `burnSummary`
   * never re-derives one — and the button behind them stays enabled, because
   * the friction at Burn is reading.
   */
  describe('the warnings box', () => {
    it('shows nothing at all when the server computed no warnings', () => {
      const html = render()
      expect(html).not.toContain('aria-label="Warnings"')
    })

    it('renders each warning the query returned', () => {
      for (const warning of [NO_REVIEW_TICKET, UNDISPOSITIONED, NO_SPEC]) {
        const html = render({ summary: summary({ warnings: [warning] }) })
        expect(html).toContain('aria-label="Warnings"')
        expect(html).toContain(warning.slice(0, 40))
      }
    })

    it('lists all three at once without disabling the burn', () => {
      const html = render({
        summary: summary({ warnings: [NO_REVIEW_TICKET, UNDISPOSITIONED, NO_SPEC] }),
      })
      expect(html.match(/<li>/g)).toHaveLength(3)
      expect(html).not.toContain('disabled=""')
    })

    it('says the check is still running rather than holding the button back', () => {
      const html = render({ warningsPending: true })
      expect(html).toContain('Still checking for warnings…')
      expect(html).not.toContain('disabled=""')
    })
  })

  /** The lap is derived from the runs, so nobody manages it (decision 4). */
  describe('the lap this click stamps', () => {
    it('is the first lap before anything has burned', () => {
      expect(burnLap([])).toBe(1)
    })

    it('counts burns, not every run the feature ever started', () => {
      expect(
        burnLap([
          { workflow: 'ticket-burner' },
          { workflow: 'research' },
          { workflow: 'ticket-burner' },
        ]),
      ).toBe(3)
    })
  })
})
