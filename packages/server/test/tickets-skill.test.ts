import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { resolvePluginDir } from '../src/launcher/skills-root'

/**
 * Skills are content, so the only way a rule in one can be asserted is to read
 * the shipped file and pin its wording — the same thing `prepare-session.test`
 * does for the prepare skill's drive contract. What is pinned here is the pair
 * of rules that are true of a BATCH rather than of any one ticket: it closes
 * with one review ticket, and its parallelism is budgeted before it is emitted.
 * They are pinned together because they are written together, and a lap that
 * loses either one is invisible until the burn is over.
 */
describe('the tickets skill', () => {
  const skill = (): string =>
    readFileSync(join(resolvePluginDir(), 'skills', 'tickets', 'SKILL.md'), 'utf8')

  it('still closes every batch with exactly one review ticket', () => {
    const text = skill()
    expect(text).toContain('<review-ticket>')
    expect(text).toContain('**Every batch closes with one, unconditionally.**')
  })

  /**
   * The failure this rule exists for: a review ticket said "Mode: Gates"
   * because the installed runcastle lacked the branch's code, the agent
   * obeyed, and a UI feature reached review undriven — though the drive boots
   * the branch, not the install.
   */
  it('has the review ticket say what to walk, never prescribe Gates', () => {
    const text = skill()
    const section = text.slice(text.indexOf('<review-ticket>'), text.indexOf('</review-ticket>'))
    expect(section).toContain('**Say what to walk, never which mode.**')
    expect(section).toContain('never directs the agent to Gates')
    expect(section).toContain("isn't deployed or installed yet")
    expect(section).toContain('the drive boots **the branch**')
    expect(section).toContain('say how to produce it inside the drive')
    expect(section).toContain('genuinely no surface a human could operate')
    // The never-both rule stays beside it.
    expect(section).toContain('Do not ask for both')
  })

  /**
   * The measured failure this rule exists for: on a real project at
   * `burnConcurrency: 3`, three laps in a row chained every ticket and burned
   * at 1.09x, 1.16x and 1.00x — a pool of three running one ticket at a time.
   */
  it('budgets the batch parallelism beside that rule, not somewhere else', () => {
    const text = skill()
    expect(text).toContain('<parallelism-budget>')
    // Read together or not at all: the budget follows the review rule directly.
    expect(text.indexOf('<parallelism-budget>')).toBeGreaterThan(text.indexOf('</review-ticket>'))
    expect(text.indexOf('<parallelism-budget>')).toBeLessThan(
      text.indexOf('<wide-refactor-exception>'),
    )
  })

  it('names the critical path, the width against burnConcurrency, and the reslice bar', () => {
    const text = skill()
    expect(text).toContain('critical path')
    expect(text).toContain('burnConcurrency')
    expect(text).toContain('how many tickets can run at once')
    // The bar itself, in the terms the session has to compute it in.
    expect(text).toContain('T / C')
    expect(text).toContain('**When it does not clear the bar, reslice.**')
    // …and the evidence, so the rule is not read as taste.
    expect(text).toContain('1.09x, 1.16x and 1.00x')
  })

  it('forbids chaining by habit — an edge means the later ticket reads the output', () => {
    const text = skill()
    expect(text).toMatch(
      /\*\*A blocking edge is true only when the later ticket reads the earlier one's output\*\*/,
    )
    expect(text).toMatch(/not blocking edges/)
    // The review ticket's own edge is the one chain that is never the problem.
    expect(text).toMatch(/blocked by every implementation ticket by definition/)
  })

  it('repeats the budget in the pre-emit self-check', () => {
    const text = skill()
    const selfCheck = text.slice(text.indexOf('## 3. Self-check, then emit'))
    expect(selfCheck).toContain('critical path')
    expect(selfCheck).toContain('burnConcurrency')
    expect(selfCheck).toContain('total / concurrency')
  })

  it('ships a scenario for hard-to-reach state only in a set-up project', () => {
    const text = skill()
    expect(text).toContain('**Ship a scenario when the state is hard to reach.**')
    expect(text).toContain('`{ setUp, runnerConfigured, scenarios, fixtures }`')
    expect(text).toContain('Ship `.runcastle/scenarios/<group>/<name>.<ext>`')
    expect(text).toContain('sibling `.http` file')
    expect(text).toContain("Name that scenario in the review ticket's `context`")
    expect(text).toContain('Copy changes and settings toggles get none.')
    expect(text).toContain('**When `setUp` is false**, card nothing about scenarios.')
    const selfCheck = text.slice(text.indexOf('## 3. Self-check, then emit'))
    expect(selfCheck).toContain('scenarios.setUp')

    const revisit = readFileSync(join(resolvePluginDir(), 'skills', 'revisit', 'SKILL.md'), 'utf8')
    expect(revisit).toContain('"Ship a scenario when the state is hard to reach"')
  })
})
