import type * as acp from '@agentclientprotocol/sdk/unstable'
import type { Ask, FormField, FormValues, ThreadEventBody } from '@runcastle/core'

/**
 * An MCP server's own asks (ACP elicitations that are not AskUserQuestion):
 * a form of flat fields, or a page to open. They dock in the composer's place
 * like an approval (capabilities.md, "Answering it").
 */

type Lines = Extract<ThreadEventBody, { type: 'ask_resolved' }>['lines']
type FormAsk = Extract<Ask, { kind: 'form' }>

/** Only what MCP's flat-form subset needs read off a property. */
interface PropertySchema {
  type: string
  title?: string | null
  description?: string | null
  format?: string | null
  default?: unknown
  enum?: string[] | null
  oneOf?: Array<{ const: string; title?: string }> | null
}

const FORMATS = new Set(['email', 'uri', 'date'])

/** A form's fields from its schema, or the key of the first property the dock cannot show (an array, a nested object). */
function formFields(schema: acp.ElicitationSchema): { fields: FormField[] } | { unsupported: string } {
  const required = new Set(schema.required ?? [])
  const fields: FormField[] = []
  for (const [key, raw] of Object.entries(schema.properties ?? {})) {
    const prop = raw as PropertySchema
    const base = {
      key,
      title: prop.title || key,
      ...(prop.description ? { description: prop.description } : {}),
      ...(required.has(key) ? { required: true } : {}),
    }
    const options = prop.oneOf?.map((o) => ({ value: o.const, label: o.title || o.const })) ?? prop.enum?.map((v) => ({ value: v, label: v }))
    if (prop.type === 'string' && options) {
      fields.push({ ...base, type: 'enum', options, ...(typeof prop.default === 'string' ? { default: prop.default } : {}) })
    } else if (prop.type === 'string') {
      const format = prop.format && FORMATS.has(prop.format) ? (prop.format as 'email' | 'uri' | 'date') : undefined
      fields.push({ ...base, type: 'string', ...(format ? { format } : {}), ...(typeof prop.default === 'string' ? { default: prop.default } : {}) })
    } else if (prop.type === 'number' || prop.type === 'integer') {
      fields.push({ ...base, type: 'number', ...(prop.type === 'integer' ? { integer: true } : {}), ...(typeof prop.default === 'number' ? { default: prop.default } : {}) })
    } else if (prop.type === 'boolean') {
      fields.push({ ...base, type: 'boolean', ...(typeof prop.default === 'boolean' ? { default: prop.default } : {}) })
    } else return { unsupported: key }
  }
  return { fields }
}

/**
 * The ask an MCP server's elicitation becomes, or why it cannot be shown: a
 * mode runcastle does not know, or a form whose schema is not flat primitives.
 */
export function elicitationAsk(req: acp.CreateElicitationRequest, id: string): Ask | { unsupported: string } {
  // The union's open `mode: string` member defeats narrowing on `mode`, so each mode is read as its own shape.
  if (req.mode === 'url') return { kind: 'link', id, message: req.message, url: (req as acp.ElicitationUrlMode).url }
  if (req.mode !== 'form') return { unsupported: `a "${req.mode}" request` }
  const form = formFields((req as acp.ElicitationFormMode).requestedSchema)
  if ('unsupported' in form) return { unsupported: `its field "${form.unsupported}" is not a plain value` }
  return { kind: 'form', id, message: req.message, fields: form.fields }
}

/** The line a declined ask leaves in the thread when runcastle could not show it. */
export function unsupportedLine(req: acp.CreateElicitationRequest, why: string): Lines[number] {
  return { what: 'Declined', answer: `${req.message} — runcastle cannot show this form: ${why}`, denied: true }
}

/** The values a form sends back: only its own fields, and only those filled in. */
export function formContent(ask: FormAsk, values: FormValues): Record<string, string | number | boolean> {
  const content: Record<string, string | number | boolean> = {}
  for (const f of ask.fields) {
    const v = values[f.key]
    if (v !== undefined && v !== '') content[f.key] = v
  }
  return content
}

/** What the thread keeps of a submitted form: one line per field filled ("Team: Engineering"). */
export function formLines(ask: FormAsk, values: FormValues): Lines {
  const content = formContent(ask, values)
  const lines = ask.fields
    .filter((f) => f.key in content)
    .map((f) => {
      const v = content[f.key]
      const answer = f.type === 'enum' ? (f.options.find((o) => o.value === v)?.label ?? String(v)) : f.type === 'boolean' ? (v ? 'Yes' : 'No') : String(v)
      return { what: `${f.title}:`, answer }
    })
  return lines.length ? lines : [{ what: 'Submitted', answer: ask.message }]
}
