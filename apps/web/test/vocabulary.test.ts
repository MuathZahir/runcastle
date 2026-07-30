import { describe, expect, it } from 'vitest'
import {
  AFK_BURN_EXPLAINER,
  BURN_EXPLAINER,
  GATE_EXPLAINER,
  GRILL_EXPLAINER,
  lapExplainer,
} from '../src/lib/vocabulary'

/**
 * The jargon sweep (finding F16). An explainer earns its place by naming the
 * mechanics the word hides — "burn" that never mentions where the commits land
 * is still jargon, just longer.
 */

describe('the explainers', () => {
  it('says where a burn runs and where its commits land', () => {
    expect(BURN_EXPLAINER).toContain('sandboxed agent')
    expect(BURN_EXPLAINER).toContain('feature branch')
  })

  it('says a grill is a conversation, before any code', () => {
    expect(GRILL_EXPLAINER).toMatch(/conversation/)
    expect(GRILL_EXPLAINER).toMatch(/before any code/)
  })

  it('says a gate is where runcastle waits for the human', () => {
    expect(GATE_EXPLAINER).toMatch(/human/)
    expect(GATE_EXPLAINER).toMatch(/waits/)
  })

  it('defines AFK as unattended', () => {
    expect(AFK_BURN_EXPLAINER).toContain('unattended')
  })

  it('names the lap it is explaining, and what opened it', () => {
    expect(lapExplainer(3)).toMatch(/^Lap 3 —/)
    expect(lapExplainer(3)).toContain('Iterate')
  })

  // A form printing "lap 1" must not be told Iterate sent it back — nothing has.
  it('does not claim a first lap was sent back', () => {
    expect(lapExplainer(1)).toMatch(/^Lap 1 —/)
    expect(lapExplainer(1)).toContain('first pass')
    expect(lapExplainer(1)).not.toContain('sent this feature back')
  })
})
