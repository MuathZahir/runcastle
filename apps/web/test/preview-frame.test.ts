import { describe, expect, it } from 'vitest'
import { PREVIEW_CSP, PREVIEW_SANDBOX, previewDocument } from '../src/lib/preview-frame'

const POLICY =
  "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; font-src data:; media-src data:; base-uri 'none'; form-action 'none'"
const META = `<meta http-equiv="Content-Security-Policy" content="${POLICY}">`
const RELAY = `<script>addEventListener('keydown',function(e){if(e.key==='Escape'&&!e.defaultPrevented)parent.postMessage('runcastle:preview-escape','*')})</script>`
const DARK = `<script>document.documentElement.setAttribute('data-theme','dark')</script>${RELAY}`
const LIGHT = `<script>document.documentElement.setAttribute('data-theme','light')</script>${RELAY}`

describe('previewDocument', () => {
  it('holds the policy from the spec, and the frame runs scripts and nothing else', () => {
    expect(PREVIEW_CSP).toBe(POLICY)
    expect(PREVIEW_SANDBOX).toBe('allow-scripts')
  })

  it('puts the policy and the theme line directly after the doctype', () => {
    const html = '<!DOCTYPE html>\n<html lang="en"><head><title>x</title></head><body>hi</body></html>'
    expect(previewDocument(html, 'dark')).toBe(
      `<!DOCTYPE html>${META}${DARK}\n<html lang="en"><head><title>x</title></head><body>hi</body></html>`,
    )
  })

  it('tolerates a BOM and leading whitespace before the doctype', () => {
    const html = '﻿  \n<!doctype html><p>hi</p>'
    expect(previewDocument(html, 'light')).toBe(`﻿  \n<!doctype html>${META}${LIGHT}<p>hi</p>`)
  })

  it('adds a doctype when the file has none, leaving the file untouched after it', () => {
    const html = '<html><body><p>no doctype</p></body></html>'
    expect(previewDocument(html, 'dark')).toBe(`<!doctype html>${META}${DARK}${html}`)
  })
})
