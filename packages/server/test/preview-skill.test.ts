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
})
