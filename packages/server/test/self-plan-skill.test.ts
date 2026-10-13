import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { resolvePluginDir } from '../src/launcher/skills-root'

/**
 * Planning without a human is skill text, so its rules are pinned the way
 * `tickets-skill.test` pins the tickets skill: read the shipped files and assert
 * their wording. The launch briefing names the section by its heading phrase,
 * so that phrase is load-bearing; the grill path beside it must keep its own
 * rules, one question at a time and confirmation on the preview.
 */
const read = (...parts: string[]): string =>
  readFileSync(join(resolvePluginDir(), 'skills', ...parts), 'utf8')

describe('the ideate skill, planning without a human', () => {
  const skill = (): string => read('ideate', 'SKILL.md')
  const section = (): string => {
    const text = skill()
    const at = text.search(/^## .*Planning without a human/m)
    expect(at).toBeGreaterThanOrEqual(0)
    return text.slice(at, text.indexOf('\n## ', at + 1))
  }

  it('has its own section after the grill, applying only when no human is present', () => {
    const text = skill()
    expect(text.search(/^## .*Planning without a human/m)).toBeGreaterThan(text.indexOf('## 1. Grill relentlessly'))
    expect(text.search(/^## .*Planning without a human/m)).toBeLessThan(text.indexOf('## 2. Lock decisions incrementally'))
    expect(section()).toContain('only when your briefing says no human is present')
  })

  it('works in one turn, in frontier rounds written as decided, under the depth rule', () => {
    const text = section()
    expect(text).toContain('**One turn.**')
    expect(text).toContain('Never end the turn to ask a question or to report progress')
    expect(text).toContain('**Frontier rounds.**')
    expect(text).toContain('every open question that does not depend on an unanswered one')
    expect(text).toContain('your recommended answer and the main alternative')
    expect(text).toContain('accept your own recommendations')
    expect(text).toContain('Write each round to `decisions.md` as it is decided')
    expect(text).toContain('**Depth rule.**')
    expect(text).toContain('changes what the feature is or does for its users, or the human might reasonably overturn it')
    expect(text).toContain('**A refused tool is not a wait.**')
  })

  it('runs exactly one challenger, given only the brief and the decisions', () => {
    const text = section()
    expect(text).toContain('**Exactly one challenger.**')
    expect(text).toContain('the Agent tool in Claude Code, `spawn_agent` in Codex')
    expect(text).toContain('Give it only the brief and `decisions.md`')
    expect(text).toContain('Do not tell it what you expect to hear.')
    expect(text).toContain('There is no second pass')
    expect(text).toContain('marked challenged with its reason')
    expect(text).toContain('write in `decisions.md` that the challenge was not independent')
  })

  it('picks at most five to check first, by the three criteria', () => {
    const text = section()
    expect(text).toContain('Pick at most five decisions')
    expect(text).toContain('guesses about the human\'s intent that the brief did not settle')
    expect(text).toContain('decisions that force several others')
    expect(text).toContain('decisions the challenger disagreed with')
  })

  it('goes from the preview to spec and tickets without waiting, then closes once', () => {
    const text = section()
    expect(text).toContain('do not tell the human to look and do not wait')
    const order = ['complete ideation', '`/runcastle:spec`', '`/runcastle:tickets`', 'one closing message'].map((s) =>
      text.indexOf(s),
    )
    expect(order.every((at) => at >= 0)).toBe(true)
    expect([...order].sort((a, b) => a - b)).toEqual(order)
    expect(text).toContain('the plan was made without the human, how many decisions it holds, and which are to check first')
  })

  it('closes on the plan only, leaving out tools and connectors the plan did not need', () => {
    expect(section()).toContain('one closing message (§6) that covers the plan only')
    expect(section()).toContain('anything that stopped you doing the job (a refused or failed tool the plan needed)')
    expect(section()).toContain('Leave out the state of tools and connectors the plan did not need.')
    const close = skill().slice(skill().indexOf('## 6. Close'))
    expect(close).toContain('It covers the plan only.')
    expect(close).toContain('a tool the plan needed that was refused or failed')
    expect(close).toContain('Do not report the state of tools and connectors the plan did not need')
  })

  it('keeps the grill path one question at a time, confirmed on the preview', () => {
    const text = skill()
    const grill = text.slice(text.indexOf('## 1. Grill relentlessly'), text.search(/^## .*Planning without a human/m))
    expect(grill).toContain('This is the **grill path**')
    expect(grill).toContain('**One question at a time.** Wait for the answer before the next.')
    expect(grill).toContain('On the grill path, do not move on until the human confirms')
    const preview = text.slice(text.indexOf('## 3. Draw the preview'), text.indexOf('## 4. Complete ideation'))
    expect(preview).toContain('Steps 3 to 5 are the grill path.')
    expect(preview).toContain('**Only after the human confirms**, complete ideation')
    expect(text).toContain('On the grill path, when the human confirms shared understanding on the preview')
  })

  it('documents the assumed and challenged lines with an example', () => {
    const lock = skill().slice(skill().indexOf('## 2. Lock decisions incrementally'), skill().indexOf('## 3. Draw the preview'))
    expect(lock).toContain('**Assumed.** Alternative: <the main alternative>.')
    expect(lock).toContain('**Challenged:** <the challenger\'s reason>.')
    expect(lock).toContain('**Assumed.** Alternative: a small footer with tags and the last-edited date.')
  })
})

describe('the revisit skill and an assumed decision', () => {
  it('clears the assumed and challenged lines only from decisions the human touched', () => {
    const text = read('revisit', 'SKILL.md')
    const docs = text.slice(text.indexOf('3. **Docs.**'), text.indexOf('4. **Ticket surgery.**'))
    expect(docs).toContain('When the human confirms or changes such a decision, remove both lines from it in the same edit.')
    expect(docs).toContain('`**Assumed.**`')
    expect(docs).toContain('`**Challenged:**`')
    expect(docs).toContain('Decisions the human did not touch keep theirs.')
    expect(docs).toContain('check-first group included')
  })
})
