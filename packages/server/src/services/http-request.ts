import type { FilledHttpRequest } from '@runcastle/core'

/**
 * An API scenario's request (drive-scenarios decision 10): the sibling `.http`
 * file in the standard request format VS Code REST Client and JetBrains read —
 * a request line, header lines, a blank line, an optional body. One request
 * per file; a `###` separator after the request ends it, one before it is
 * skipped. Pure: no IO, so the drive and Try it
 * share one reading of the text.
 */

/** A parsed `.http` request, placeholders still in place. */
export interface HttpRequestTemplate {
  method: string
  target: string
  headers: Array<[string, string]>
  body?: string
}

export type ParseHttpRequestResult =
  | { ok: true; request: HttpRequestTemplate }
  | { ok: false; error: string }

/** What fills a template: the run's `TOKEN`, its run id, and the drive URL. */
export interface FillHttpRequestValues {
  token?: string
  run?: string
  driveUrl: string
}

const isSeparator = (line: string): boolean => line.startsWith('###')
const isComment = (line: string): boolean =>
  !isSeparator(line) && (line.startsWith('#') || line.startsWith('//'))

/** `METHOD target [HTTP/x.y]`, or a bare target, which means GET. */
const REQUEST_LINE = /^(?:([A-Za-z]+)\s+)?(\S+)(?:\s+HTTP\/\d+(?:\.\d+)?)?$/

export function parseHttpRequest(text: string): ParseHttpRequestResult {
  const lines = text.replace(/\r\n?/g, '\n').split('\n')
  // A leading `### Name` separates nothing — no request precedes it — so it is
  // skipped like a comment; the usual REST Client/JetBrains file opens with one.
  const isPreamble = (line: string): boolean => line === '' || isSeparator(line) || isComment(line)
  let i = 0
  while (i < lines.length && isPreamble(lines[i]?.trim() ?? '')) i++
  const first = lines[i]?.trim()
  if (first === undefined) return { ok: false, error: 'no request line' }
  const m = REQUEST_LINE.exec(first)
  if (!m?.[2]) return { ok: false, error: `not a request line: ${first}` }
  const method = (m[1] ?? 'GET').toUpperCase()
  const target = m[2]
  i++

  const headers: Array<[string, string]> = []
  for (; i < lines.length; i++) {
    const line = lines[i]?.trim() ?? ''
    if (line === '' || isSeparator(line)) break
    if (isComment(line)) continue
    const colon = line.indexOf(':')
    if (colon <= 0) return { ok: false, error: `not a header line: ${line}` }
    headers.push([line.slice(0, colon).trim(), line.slice(colon + 1).trim()])
  }

  const bodyLines: string[] = []
  if (lines[i]?.trim() === '') {
    for (i++; i < lines.length; i++) {
      const line = lines[i] ?? ''
      if (isSeparator(line)) break
      bodyLines.push(line)
    }
  }
  const body = bodyLines.join('\n').trimEnd()
  return { ok: true, request: { method, target, headers, ...(body !== '' ? { body } : {}) } }
}

/**
 * `new URL` percent-encodes `{`, `}` and spaces in a path, which would hide an
 * unfilled `{{foo}}` as `%7B%7Bfoo%7D%7D`; put each such placeholder back as
 * written so the human sees it.
 */
const ENCODED_PLACEHOLDER = /%7B%7B((?:%20)*\w+(?:%20)*)%7D%7D/gi
const unencodePlaceholders = (url: string): string =>
  url.replace(ENCODED_PLACEHOLDER, (_whole, inner: string) => `{{${inner.replace(/%20/g, ' ')}}}`)

/**
 * Fill `{{token}}` and `{{run}}` (whitespace inside the braces allowed) in the
 * target, header values and body, and resolve the target against the drive
 * URL. An unknown placeholder, or `{{token}}` with no token, stays verbatim.
 * Throws when the target cannot resolve to a URL at all.
 */
export function fillHttpRequest(
  tpl: HttpRequestTemplate,
  values: FillHttpRequestValues,
): FilledHttpRequest {
  const fill = (s: string): string =>
    s.replace(/\{\{\s*(\w+)\s*\}\}/g, (whole, name: string) => {
      const value = name === 'token' ? values.token : name === 'run' ? values.run : undefined
      return value ?? whole
    })
  const body = tpl.body === undefined ? undefined : fill(tpl.body)
  return {
    method: tpl.method,
    url: unencodePlaceholders(new URL(fill(tpl.target), values.driveUrl).toString()),
    headers: tpl.headers.map(([name, value]) => [name, fill(value)]),
    ...(body !== undefined ? { body } : {}),
  }
}
