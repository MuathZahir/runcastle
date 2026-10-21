/**
 * The plan preview's frame document (plan-preview decision 7). The preview is
 * agent-written HTML with scripts, shown inside an app whose local server has
 * no login and can start burns and merges — so it renders as an opaque origin
 * (`sandbox="allow-scripts"` and nothing else) and carries a content policy
 * that refuses every network request, runcastle's own server included. That is
 * what makes "fully inline" enforced rather than promised.
 *
 * Pure: the file's text and the app's theme in, the frame's `srcdoc` out.
 */

/** The frame's sandbox: scripts run; no same-origin, popups, forms or top navigation. */
export const PREVIEW_SANDBOX = 'allow-scripts'

/** Inline styles, scripts and data: media only — no request leaves the frame. */
export const PREVIEW_CSP =
  "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; " +
  "img-src data:; font-src data:; media-src data:; base-uri 'none'; form-action 'none'"

/**
 * What the frame posts to its parent on an Escape the preview left alone. Focus
 * inside the frame is a separate origin, so the app never hears the key itself;
 * the panel accepts this only from its own frame's window.
 */
export const PREVIEW_ESCAPE_MESSAGE = 'runcastle:preview-escape'

/** What a designed-screen entry's Open in design button posts (design-mode decision 7). */
export const PREVIEW_OPEN_DESIGN_MESSAGE = 'runcastle:open-design'

/**
 * The design-server path a frame message asks to open, or null for any other
 * message. Only `{ type: 'runcastle:open-design', path: '/…' }` counts: the path
 * is appended to the design server's URL, so it must be one.
 */
export function openDesignPath(data: unknown): string | null {
  if (typeof data !== 'object' || data === null) return null
  const { type, path } = data as { type?: unknown; path?: unknown }
  if (type !== PREVIEW_OPEN_DESIGN_MESSAGE || typeof path !== 'string' || !path.startsWith('/')) return null
  return path
}

/** A leading doctype, after an optional BOM and whitespace. */
const LEADING_DOCTYPE = /^﻿?\s*<!doctype[^>]*>/i

/**
 * The document the frame renders: `html` with the content policy, a line
 * setting `data-theme` and the Escape relay inserted directly after its
 * doctype — a doctype is
 * prepended first when the file has none, so the page never falls into quirks
 * mode. Every other byte of `html` is left as it was. A `<meta>` before
 * `<html>` is legal: the parser opens the head implicitly and the file's own
 * `<html>` attributes still apply.
 */
export function previewDocument(html: string, theme: 'dark' | 'light'): string {
  const head =
    `<meta http-equiv="Content-Security-Policy" content="${PREVIEW_CSP}">` +
    `<script>document.documentElement.setAttribute('data-theme','${theme}')</script>` +
    `<script>addEventListener('keydown',function(e){if(e.key==='Escape'&&!e.defaultPrevented)parent.postMessage('${PREVIEW_ESCAPE_MESSAGE}','*')})</script>`
  const doctype = LEADING_DOCTYPE.exec(html)
  if (!doctype) return `<!doctype html>${head}${html}`
  const end = doctype[0].length
  return html.slice(0, end) + head + html.slice(end)
}
