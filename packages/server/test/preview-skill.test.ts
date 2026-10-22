import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { resolvePluginDir } from '../src/launcher/skills-root'

/**
 * The plan preview is skill content plus one shipped starter file, so the rules
 * are pinned the way `tickets-skill.test` pins the tickets skill: read the
 * shipped files and assert their wording. The starter is also held to the app's
 * theme, because a session in another repo cannot see runcastle's tokens — the
 * starter is the only place it gets them from.
 */
const skillsDir = (): string => join(resolvePluginDir(), 'skills')
const read = (...parts: string[]): string => readFileSync(join(skillsDir(), ...parts), 'utf8')
const starter = (): string => read('ideate', 'references', 'preview-starter.html')

/** The body of the first `{ … }` block after `opener`, braces balanced. */
function blockAfter(text: string, opener: string): string {
  const at = text.indexOf(opener)
  if (at < 0) throw new Error(`no block opened by ${opener}`)
  const open = text.indexOf('{', at + opener.length - 1)
  let depth = 0
  for (let i = open; i < text.length; i++) {
    if (text[i] === '{') depth++
    else if (text[i] === '}' && --depth === 0) return text.slice(open + 1, i)
  }
  throw new Error(`unbalanced block opened by ${opener}`)
}

const normalise = (value: string): string => value.replace(/\s+/g, ' ').trim().toLowerCase()

/** Every `--color-<name>: <value>;` declared in a block, comments stripped. */
function colorTokens(block: string): Map<string, string> {
  const tokens = new Map<string, string>()
  const body = block.replace(/\/\*[\s\S]*?\*\//g, '')
  for (const m of body.matchAll(/--color-([a-z0-9-]+)\s*:\s*([^;]+);/g)) {
    tokens.set(m[1] as string, normalise(m[2] as string))
  }
  return tokens
}

describe('the preview starter', () => {
  it('is a fully inline HTML document', () => {
    const text = starter()
    expect(text.startsWith('<!doctype html>')).toBe(true)
    expect(text).not.toMatch(/https?:\/\//)
    expect(text).not.toContain('<link')
    expect(text).not.toContain('@import')
    expect(text).not.toMatch(/\bsrc\s*=\s*["']?(?!data:)/)
    expect(text).not.toMatch(/url\(\s*["']?(?!data:)/)
  })

  it('carries the app theme’s colour tokens, dark and light, value for value', () => {
    const theme = readFileSync(
      join(import.meta.dirname, '..', '..', '..', 'apps', 'web', 'src', 'theme.css'),
      'utf8',
    )
    const appDark = colorTokens(blockAfter(theme, '@theme static {'))
    const appLight = colorTokens(blockAfter(theme, ':root[data-theme="light"] {'))
    const text = starter()
    const dark = colorTokens(blockAfter(text, ':root{'))
    const light = colorTokens(blockAfter(text, ':root[data-theme="light"]{'))

    // The core grounds are declared, so an empty block cannot pass vacuously.
    for (const tokens of [dark, light]) {
      for (const name of ['canvas', 'surface', 'text', 'accent', 'border', 'phase-spec']) {
        expect(tokens.has(name), name).toBe(true)
      }
    }
    for (const [name, value] of dark) expect([name, value]).toEqual([name, appDark.get(name)])
    for (const [name, value] of light) expect([name, value]).toEqual([name, appLight.get(name)])
  })

  it('falls back to the OS setting with exactly its light block', () => {
    const text = starter()
    const light = blockAfter(text, ':root[data-theme="light"]{')
    const fallback = blockAfter(blockAfter(text, '@media (prefers-color-scheme:light){'), ':root:not([data-theme]){')
    expect(normalise(fallback)).toBe(normalise(light))
  })

  it('holds the four fixed parts around an empty, marked show', () => {
    const text = starter()
    for (const id of ['id="what"', 'id="show"', 'id="decided"', 'id="left-out"', 'id="hood"']) {
      expect(text).toContain(id)
    }
    expect(text).toMatch(/<details class="hood"(?![^>]*\bopen\b)/)
    expect(text).toContain('THE SHOW IS FREE-FORM')
    expect(text).toContain('<!-- screen:example-name -->')
    expect(text).toContain('<!-- /screen:example-name -->')
    expect(text).toContain('scrollIntoView')
    // nothing of the worked example it was derived from
    expect(text).not.toContain('Saved filters')
    expect(text).not.toContain('feature-page-planning')
  })

  it('builds the check-first group from an empty-by-default C list, above the decisions', () => {
    const text = starter()
    expect(text).toContain('var C = []')
    // nothing in the markup: the group exists only when the script draws it
    expect(text).not.toMatch(/<div class="cf"/)
    const build = text.slice(text.indexOf('if (C.length) {'))
    expect(text).toContain('if (C.length) {')
    expect(build).toContain("'<h3>Check first</h3>")
    expect(build).toContain('<dt>Alternative</dt>')
    expect(build).toContain('<dt>Why unsure</dt>')
    expect(build).toContain('list.before(cf)')
  })

  it('tags a decision whose D entry carries a mark', () => {
    const text = starter()
    expect(text).toContain('[title, reason, mark?]')
    expect(text).toMatch(/if \(d\[2\]\) \{[\s\S]*?mark\.className = 'tag'/)
    expect(text).toMatch(/\.tag\{[^}]*var\(--color-/)
  })
})

describe('designed screens in the preview', () => {
  it('wires [data-open-design] buttons to the message the app listens for, still inline', () => {
    const text = starter()
    expect(text).toContain("e.target.closest('[data-open-design]')")
    expect(text).toContain("parent.postMessage({ type: 'runcastle:open-design', path: od.dataset.openDesign }, '*')")
    expect(text).toMatch(/\.designed\{[^}]*var\(--color-/)
  })

  it('describes designed-screen entries and blocks that name the component, not markup', () => {
    const text = read('ideate', 'references', 'preview.md')
    const section = text.slice(text.indexOf('## Designed screens'), text.indexOf('## Inline only'))
    expect(section).toContain('is **not mocked\nagain**')
    expect(section).toContain('**designed-screen entry**')
    expect(section).toContain('**Open in design**')
    expect(section).toContain('data-open-design')
    expect(section).toContain('committed component file and the preview page path')
    expect(section).toContain('Hand mocks remain')
  })
})

describe('the design guide', () => {
  const guide = (): string => read('design', 'SKILL.md')

  it('exists with frontmatter and is not an entry skill', async () => {
    const { ENTRY_SKILLS } = await import('../src/launcher/runtimes/skills')
    expect(guide()).toMatch(/^---\nname: design\ndescription: .+\n/)
    expect((ENTRY_SKILLS as readonly string[]).includes('design')).toBe(false)
  })

  it('covers the loop, the tools, the screenshot line, Tweaks, commit and the limits', () => {
    const text = guide()
    for (const part of [
      'First use in a project',
      'Mount the piece directly with made-up props',
      'Mount the whole screen with the server faked',
      '.runcastle/preview/',
      'start_design_server({ command? })',
      'RUNCASTLE_DESIGN_PORT',
      '.runcastle/design.json',
      "show_panel({ view: 'design', path })",
      '`body`, `preview`, `drive` and `details`',
      '[Screenshot: <absolute png path>] <their words>',
      '**Tweaks.**',
      'delete the Tweaks menu',
      '`design: <what>`',
      'Never commit unapproved work',
      'Go waits while design work is uncommitted',
      'Data loading, API calls and behaviour ride tickets',
      'Next.js server components',
      'Native mobile has no browser',
    ]) {
      expect(text, part).toContain(part)
    }
  })

  it('is pointed to by ideate, revisit and lead, and a self-planned feature never designs', () => {
    for (const entry of ['ideate', 'revisit', 'lead']) expect(read(entry, 'SKILL.md')).toContain('../design/SKILL.md')
    expect(read('ideate', 'SKILL.md')).toContain('A self-planned feature never opens a design')
  })
})

describe('the preview rules (ideate/references/preview.md)', () => {
  const rules = (): string => read('ideate', 'references', 'preview.md')

  it('names the one file and the starter it is copied from', () => {
    const text = rules()
    expect(text).toContain('Exactly one file, `preview.html`, at the root of the feature\'s docs dir')
    expect(text).toContain('`./preview-starter.html`')
    expect(text).toContain('/prototypes/`')
    expect(text).toContain('They are never shown')
  })

  it('states the five parts in order, the hood collapsed by default', () => {
    const text = rules()
    const parts = [
      '1. **What this is.**',
      '2. **The show.**',
      '3. **What was decided.**',
      '4. **What is left out.**',
      '5. **Under the hood.**',
    ].map((part) => text.indexOf(part))
    expect(parts.every((at) => at >= 0)).toBe(true)
    expect([...parts].sort((a, b) => a - b)).toEqual(parts)
    expect(text).toContain('**collapsed by default**')
    expect(text).toContain('**It is free, with\n   no template**')
    expect(text).toMatch(/every decision in `decisions\.md` by its number and\s+title/i)
  })

  it('pins visual first, the theme rule, screen blocks, inline only and sizing', () => {
    const text = rules()
    expect(text).toContain('**A short sentence beside a picture, never paragraphs, detail behind a click.**')
    expect(text).toMatch(/\*\*The page and every diagram and flow are runcastle-themed\*\*/)
    expect(text).toMatch(/\*\*A mocked screen uses the styling of the project it belongs to\*\*/)
    expect(text).toContain('<!-- screen:<name> -->')
    expect(text).toContain('<!-- /screen:<name> -->')
    expect(text).toContain('kebab case and unique in the file')
    expect(text).toContain('**Styles, scripts and images are inline. The file makes no network request**')
    expect(text).toContain('refuses every fetch')
    expect(text).toContain('**There is no minimum.**')
    expect(text).toMatch(/about a\s+minute for a small feature, a few minutes for a large one/)
  })

  it('opens a self-planned feature’s decisions with at most five to check first', () => {
    const text = rules()
    const decided = text.slice(text.indexOf('3. **What was decided.**'), text.indexOf('4. **What is left out.**'))
    expect(decided).toMatch(/\*\*Check first\*\* group of at most five/)
    expect(decided).toMatch(/its alternative, and why it\s+is uncertain/)
    expect(decided).toMatch(/each showing that it was assumed/)
    expect(decided).toContain('**A grilled feature has neither**')
    const selfCheck = text.slice(text.indexOf('## Self-check'))
    expect(selfCheck).toMatch(/\*\*Check first\*\* group holds at most five/)
    expect(selfCheck).toMatch(/shows as assumed/)
    expect(selfCheck).toMatch(/For a grilled feature, `C` is empty/)
  })
})

describe('the ideate skill’s preview step', () => {
  const skill = (): string => read('ideate', 'SKILL.md')

  it('sits between locking decisions and completing ideation', () => {
    const text = skill()
    const lock = text.indexOf('## 2. Lock decisions incrementally')
    const preview = text.indexOf('## 3. Draw the preview, then wait for the human to look')
    const complete = text.indexOf('## 4. Complete ideation')
    expect(lock).toBeGreaterThanOrEqual(0)
    expect(preview).toBeGreaterThan(lock)
    expect(complete).toBeGreaterThan(preview)
  })

  it('draws from the starter, checks every decision, waits, redraws on a correction', () => {
    const step = skill().slice(skill().indexOf('## 3. Draw the preview'), skill().indexOf('## 4. Complete ideation'))
    expect(step).toContain('**The preview is what the human confirms shared understanding on.**')
    expect(step).toContain('`./references/preview.md`')
    expect(step).toContain('`./references/preview-starter.html`')
    expect(step).toContain('Every decision appears by its number and title.')
    expect(step).toContain('**Overview**')
    expect(step).toContain('Then stop and wait for their answer.')
    expect(step).toContain('**A correction is a decision edit plus a redraw.**')
    expect(step).toContain('**Only after the human confirms**, complete ideation')
    expect(step).toContain('**Never skip the preview on your own judgement**')
    expect(step).toContain('**If the human says to skip it**, write no file')
  })

  it('carries the redraw rule, and section 1 hands confirmation to the preview', () => {
    const text = skill()
    expect(text).toMatch(/edit to `decisions\.md`.*updates `preview\.html` in the same move/)
    expect(text).toContain('That confirmation happens on the preview (§3)')
  })
})

describe('the revisit skill and the preview', () => {
  const skill = (): string => read('revisit', 'SKILL.md')

  it('redraws the preview with a decision edit in an ordinary revisit at planning', () => {
    const text = skill()
    const docs = text.slice(text.indexOf('3. **Docs.**'), text.indexOf('4. **Ticket surgery.**'))
    expect(docs).toContain('at `planning`')
    expect(docs).toContain('update `preview.html` in the same move as the decisions edit')
    expect(docs).toContain('`../ideate/references/preview.md`')
  })
})

describe('the tickets skill and the preview', () => {
  const skill = (): string => read('tickets', 'SKILL.md')

  it('points a screen-building ticket at one named screen block, never the file', () => {
    const text = skill()
    const block = text.slice(text.indexOf('<preview-screen-block>'), text.indexOf('</preview-screen-block>'))
    expect(block).toContain('point that ticket at **one named screen block**')
    expect(block).toContain('**read only the lines between them**')
    expect(block).toContain('**is not the implementation**')
    expect(block).toContain('never copy the mock\'s markup')
    expect(block).toContain('**Never tell an agent to read the whole file**')
    expect(block).toContain('A ticket with no screen does not mention the preview.')
    expect(block).toContain('A **designed-screen block** holds no mock')
  })

  it('tells planners to connect designed components and never restyle them', () => {
    const text = skill()
    const rule = text.slice(text.indexOf('<connect-designed-screens>'), text.indexOf('</connect-designed-screens>'))
    expect(rule).toContain('names the committed component and its preview page')
    expect(rule).toContain('**the look is approved**')
    expect(rule).toContain('**connect, never restyle**')
    expect(rule).toContain('swap the sample data for real data')
    expect(rule).toContain('calls it out in its digest')
  })
})
