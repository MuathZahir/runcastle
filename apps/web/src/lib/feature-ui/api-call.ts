import type { FilledHttpRequest } from '@runcastle/core'
import type { StatusTone } from '../../ui'
import type { ScenarioMenu } from './scenarios'

/**
 * Try it, in the drive's API view (drive-scenarios decisions 10, 11): the calls
 * a drive lists, the request form a landed call fills, and how a response reads.
 */

/** The calls: the scenarios with a `.http` sibling, in the Scenario menu's sections and order. */
export function callMenu(menu: ScenarioMenu): ScenarioMenu {
  const own = menu.own.filter((s) => s.hasCall)
  return { ...menu, own, others: menu.others.filter((s) => s.hasCall), defaultScenario: own[0] ?? null }
}

/** Whether a drive has any call to try — what shows the App | API toggle. */
export function hasCalls(menu: ScenarioMenu): boolean {
  return [...menu.own, ...menu.others].some((s) => s.hasCall)
}

/** The request as the form edits it: headers as rows, the body as plain text. */
export interface CallForm {
  method: string
  url: string
  headers: Array<{ name: string; value: string }>
  body: string
}

/** The methods the form offers; a call's own method is added when it is none of these. */
export const CALL_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'] as const

export function callMethods(method: string): string[] {
  return (CALL_METHODS as readonly string[]).includes(method) ? [...CALL_METHODS] : [...CALL_METHODS, method]
}

/** A landed call's filled request, as the form starts. */
export function callForm(call: FilledHttpRequest): CallForm {
  return {
    method: call.method,
    url: call.url,
    headers: call.headers.map(([name, value]) => ({ name, value })),
    body: call.body ?? '',
  }
}

/** What Try it sends: the form back as a request, with nameless header rows and an empty body dropped. */
export function callRequest(form: CallForm): FilledHttpRequest {
  return {
    method: form.method,
    url: form.url.trim(),
    headers: form.headers.filter((h) => h.name.trim() !== '').map((h) => [h.name.trim(), h.value]),
    ...(form.body !== '' ? { body: form.body } : {}),
  }
}

/** A response status's colour by class: 2xx success, 4xx warning, 5xx danger. */
export function statusTone(status: number): StatusTone {
  if (status >= 200 && status < 300) return 'success'
  if (status >= 400 && status < 500) return 'warning'
  if (status >= 500) return 'danger'
  return 'neutral'
}

/** A response body as shown: pretty-printed when it parses as JSON, else as it came. */
export function prettyBody(body: string): string {
  try {
    return JSON.stringify(JSON.parse(body), null, 2)
  } catch {
    return body
  }
}
