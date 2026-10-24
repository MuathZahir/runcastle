import { describe, expect, it } from 'vitest'
import { terminalTheme } from '../src/lib/terminal'
import { resolveColour, type ThemeName } from './theme-tokens'

/** Reads each token straight from `theme.css`, as a loaded stylesheet would. */
const fromThemeCss = (theme: ThemeName) => (name: string) =>
  resolveColour(theme, name.replace(/^--color-/, ''))

describe('the terminal wears the theme tokens', () => {
  // No stylesheet is loaded here, so the no-argument call paints from the
  // fallbacks — which must restate `theme.css` exactly.
  it.each(['dark', 'light'] as const)('its %s fallbacks match theme.css', (theme) => {
    expect(terminalTheme(theme)).toEqual(terminalTheme(theme, fromThemeCss(theme)))
  })

  it('paints program output in the word peers and keeps the cursor on the accent hue', () => {
    const t = terminalTheme('light', fromThemeCss('light'))
    expect(t.red).toBe(resolveColour('light', 'danger-text'))
    expect(t.green).toBe(resolveColour('light', 'success-text'))
    expect(t.yellow).toBe(resolveColour('light', 'warning-text'))
    expect(t.blue).toBe(resolveColour('light', 'accent-text'))
    expect(t.cursor).toBe(resolveColour('light', 'accent'))
  })

  it('renders dark exactly as before the word peers', () => {
    expect(terminalTheme('dark')).toMatchObject({
      cursor: '#4f8ef7',
      red: '#f06363',
      green: '#46b67a',
      yellow: '#e2a53b',
      blue: '#4f8ef7',
      brightBlue: '#7aaafa',
    })
  })
})
