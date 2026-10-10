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

/** A leading doctype, after an optional BOM and whitespace. */
const LEADING_DOCTYPE = /^﻿?\s*<!doctype[^>]*>/i

/**
 * The document the frame renders: `html` with the content policy and a line
 * setting `data-theme` inserted directly after its doctype — a doctype is
 * prepended first when the file has none, so the page never falls into quirks
 * mode. Every other byte of `html` is left as it was. A `<meta>` before
 * `<html>` is legal: the parser opens the head implicitly and the file's own
 * `<html>` attributes still apply.
 */
export function previewDocument(html: string, theme: 'dark' | 'light'): string {
  const head =
    `<meta http-equiv="Content-Security-Policy" content="${PREVIEW_CSP}">` +
    `<script>document.documentElement.setAttribute('data-theme','${theme}')</script>`
  const doctype = LEADING_DOCTYPE.exec(html)
  if (!doctype) return `<!doctype html>${head}${html}`
  const end = doctype[0].length
  return html.slice(0, end) + head + html.slice(end)
}
