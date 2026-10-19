/** Marks the banner, so a second failure in the same frame replaces it. */
const BANNER_ATTRIBUTE = 'data-failed-step'

/**
 * A page story's `play`, made to fail where the human looks: the frame itself
 * (docs/features/the-map-shows-every-page-and-its-states, decision 5 — a failed
 * scripted step never shows the starting screen under another state's name).
 *
 * Storybook reports a failed play in its own panels, which a map frame never
 * shows, so the frame kept the screen the step stalled on: "5 First project"
 * framed the git identity screen. Wrapped, any error first lays a fixed,
 * full-width banner over the page ("This state's scripted step failed: …"),
 * then rethrows, so Storybook still marks the play failed.
 *
 * Wrap every page story's `play`:
 *
 * ```tsx
 * export const Settings: Story = {
 *   name: 'Open',
 *   play: failLoudly(async ({ canvasElement }) => { … }),
 * }
 * ```
 */
export function failLoudly<Context>(play: (context: Context) => Promise<void>): (context: Context) => Promise<void> {
  return async (context) => {
    try {
      await play(context)
    } catch (error) {
      showBanner(error instanceof Error ? error.message : String(error))
      throw error
    }
  }
}

function showBanner(message: string) {
  document.querySelector(`[${BANNER_ATTRIBUTE}]`)?.remove()
  const banner = document.createElement('div')
  banner.setAttribute(BANNER_ATTRIBUTE, '')
  banner.setAttribute('role', 'alert')
  banner.textContent = `This state's scripted step failed: ${message}`
  // Inline and fixed, so it shows over any page, in either theme, at any scale.
  Object.assign(banner.style, {
    position: 'fixed',
    top: '0',
    left: '0',
    right: '0',
    zIndex: '2147483647',
    padding: '24px 32px',
    background: '#b00020',
    color: '#ffffff',
    font: '600 24px/1.4 system-ui, sans-serif',
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-word',
    maxHeight: '100vh',
    overflow: 'auto',
  })
  document.body.append(banner)
}
