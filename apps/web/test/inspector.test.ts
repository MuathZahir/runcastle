import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { EventRow, Phase } from '@runcastle/core'
import { CurrentGate } from '../src/components/inspector/GateCard'
import { ActivityRow, LapDivider } from '../src/components/inspector/Activity'
import type { GateState } from '../src/lib/api'
import { GATE_EXPLAINER } from '../src/lib/vocabulary'

/**
 * The Inspector's two panes as they render (decisions 5, 6, 9). Tier-1 static
 * markup (apps/web/STYLE.md): both are pure once the rail's queries have
 * answered, which is exactly what `CurrentGate` and `ActivityRow` take.
 *
 * What is pinned here is what the rail *states*: a gate card that leads with the
 * gate's plain name and offers nothing to click, an explainer that waits to be
 * asked for, and activity rows that read as sentences rather than event slugs.
 */
const BLOCKED: GateState = {
  next: {
    id: 'G1',
    description: 'Decisions captured before writing a spec',
    check: 'decisions-file-exists',
  },
  satisfied: false,
  reason: 'run the ideation session to capture decisions first',
}

function gate(over: { gate?: GateState; phase?: Phase } = {}): string {
  return renderToStaticMarkup(
    createElement(CurrentGate, { gate: BLOCKED, phase: 'ideation', ...over }),
  )
}

const ev = (over: Partial<EventRow>): EventRow =>
  ({ id: 1, projectId: 'p', ts: Date.now(), type: 'docs.scaffolded', message: '', ...over }) as EventRow

describe('gate card', () => {
  it('leads with the gate’s plain name and demotes its code to dim mono', () => {
    const html = gate()
    expect(html).toContain('Decisions captured')
    expect(html).toMatch(/class="[^"]*font-mono[^"]*"[^>]*>G1</)
    // Decision 9 — the code follows the name; it is no longer the headline.
    expect(html.indexOf('Decisions captured')).toBeLessThan(html.indexOf('>G1<'))
  })

  it('states the requirement and what is blocking it', () => {
    const html = gate()
    expect(html).toContain('Decisions captured before writing a spec')
    expect(html).toContain('run the ideation session to capture decisions first')
  })

  it('says a satisfied gate is ready rather than repeating a stale reason', () => {
    const html = gate({ gate: { ...BLOCKED, satisfied: true } })
    expect(html).toContain('Ready to advance')
    expect(html).not.toContain('run the ideation session')
  })

  it('offers nothing to click — the override affordance is gone (decision 6)', () => {
    const html = gate()
    for (const gone of ['Override', 'override', 'Reason for', 'Undo', 'skipped ahead'])
      expect(html).not.toContain(gone)
  })

  it('says the explainer once, on the ⓘ, hidden until it is asked for', () => {
    const html = gate()
    expect(html.split(GATE_EXPLAINER)).toHaveLength(2)
    const tip = html.match(/class="([^"]*)"\s*>Gates are the human/)
    expect(tip?.[1]).toContain('hidden')
    expect(tip?.[1]).toContain('group-hover/info:block')
  })

  it('keeps the explainer in flow so opening it moves the gate card down', () => {
    const html = gate()
    const tip = html.match(/class="([^"]*)"\s*>Gates are the human/)
    expect(html).toContain('group/info flex flex-col items-start')
    expect(tip?.[1]).not.toContain('absolute')
  })

  it('distinguishes a shipped feature from a phase it cannot place', () => {
    expect(gate({ gate: { next: null, satisfied: true } })).toContain('no gates left')
    expect(gate({ phase: 'nonsense' as Phase })).toContain('recognized, so no gate applies')
  })
})

describe('activity row', () => {
  it('reads as a sentence, with the slug demoted to the dim subline', () => {
    const html = renderToStaticMarkup(
      createElement(ActivityRow, {
        event: ev({
          type: 'feature.created',
          message: 'feature.created (feature/x ← main)',
          data: { branch: 'feature/x', baseBranch: 'main', branchReady: true },
        }),
      }),
    )
    expect(html).toContain('Feature created on branch feature/x, from main')
    expect(html).not.toContain('feature.created')
    expect(html).toContain('feature · created')
  })

  it('offers the whole event behind an expander only when there is more to see', () => {
    const short = renderToStaticMarkup(
      createElement(ActivityRow, { event: ev({ message: 'scaffolded brief.md' }) }),
    )
    expect(short).not.toContain('aria-expanded')

    const long = renderToStaticMarkup(
      createElement(ActivityRow, { event: ev({ message: `${'x'.repeat(400)}` }) }),
    )
    expect(long).toContain('aria-expanded="false"')
  })

  it('paints a failed run red however its type reads', () => {
    const html = renderToStaticMarkup(
      createElement(ActivityRow, {
        event: ev({ type: 'run.finished', message: 'run failed: 2 tickets', data: { status: 'failed' } }),
      }),
    )
    expect(html).toContain('bg-danger')
  })

  it('draws a lap boundary across the feed rather than listing it', () => {
    const html = renderToStaticMarkup(
      createElement(LapDivider, { event: ev({ type: 'lap.started', message: 'rethink — lap 2' }) }),
    )
    expect(html).toContain('role="separator"')
    expect(html).toContain('rethink — lap 2')
  })
})
