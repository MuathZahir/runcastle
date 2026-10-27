import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import type { AgentRuntime, ModelChoice, ModelEntry, ThreadModels } from '@runcastle/core'
import { modelCatalogPath } from '@runcastle/core/paths'
import type { ModelCatalog } from './controls'

/**
 * Each runtime's one model catalog (chat-as-web-components decision 13): the
 * models its adapter offers, as a session last reported them, kept on disk so
 * the composer's picker reads the same list, ids and labels before a thread's
 * agent starts, while it runs and after it stops. Before any session has
 * reported, runcastle's roster stands in, mapped to the adapter's shape and
 * labels ("Opus 5.5", not `claude-opus-5-5`).
 */

export function readModelCatalog(runtime: AgentRuntime): ModelCatalog | null {
  try {
    const raw = JSON.parse(readFileSync(modelCatalogPath(runtime), 'utf8')) as ModelCatalog
    return Array.isArray(raw?.models) && raw.models.length ? raw : null
  } catch {
    return null
  }
}

/** Keep `catalog` as the runtime's; the file is written only when it changed. */
export function writeModelCatalog(runtime: AgentRuntime, catalog: ModelCatalog): void {
  const path = modelCatalogPath(runtime)
  const text = `${JSON.stringify(catalog, null, 2)}\n`
  try {
    if (readFileSync(path, 'utf8') === text) return
  } catch {
    // Not written yet.
  }
  try {
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, text)
  } catch (err) {
    console.error(`could not keep the ${runtime} model catalog`, err)
  }
}

const capitalize = (word: string) => word.charAt(0).toUpperCase() + word.slice(1)

/**
 * A roster id as its adapter would name the model: Claude's
 * `claude-opus-4-8` → "Opus 4.8" (a dated snapshot without its date, a `[1m]`
 * id as "(1M)"); Codex's `gpt-5.6-sol` → "5.6 Sol", as codex-acp writes them.
 */
export function rosterLabel(id: string, runtime: AgentRuntime): string {
  if (runtime === 'codex') {
    if (!/^gpt-/i.test(id)) return id
    return id.replace(/^gpt-/i, '').split(/[-/]+/).filter(Boolean).map(capitalize).join(' ')
  }
  const claude = /^claude-([a-z]+)-(\d+(?:-\d{1,2})*)(?:-\d{8})?(\[1m\])?$/i.exec(id)
  if (!claude) return id
  const [, family, version, long] = claude
  return `${capitalize(family.toLowerCase())} ${version.replaceAll('-', '.')}${long ? ' (1M)' : ''}`
}

/** Two names for one model: compared without case, spaces or punctuation. */
const key = (label: string) => label.toLowerCase().replace(/[^a-z0-9]/g, '')

/** The catalog entry a roster id names: by id, else by the label the adapter gives it. */
function entryFor(models: readonly ModelChoice[], id: string, runtime: AgentRuntime): ModelChoice | undefined {
  const label = key(rosterLabel(id, runtime))
  return models.find((m) => m.id === id) ?? models.find((m) => key(m.label) === label)
}

/** The roster's models for a runtime in the catalog's shape: adapter-style labels, one entry per model. */
function rosterCatalog(roster: readonly ModelEntry[], runtime: AgentRuntime): ModelCatalog {
  const models: ModelChoice[] = []
  for (const m of roster) {
    if (m.runtime !== runtime) continue
    const same = entryFor(models, m.id, runtime)
    if (same) {
      if (!same.note && m.note) same.note = m.note
      continue
    }
    models.push({ id: m.id, label: rosterLabel(m.id, runtime), ...(m.note ? { note: m.note } : {}) })
  }
  return { models }
}

/**
 * The runtime's catalog: the adapter's as last kept, else the roster mapped to
 * its shape. The operator's note on a roster model is that model's one-line
 * description where they wrote one.
 */
export function modelCatalog(runtime: AgentRuntime, roster: readonly ModelEntry[]): ModelCatalog {
  const kept = readModelCatalog(runtime)
  if (!kept) return rosterCatalog(roster, runtime)
  const models = kept.models.map((m) => ({ ...m }))
  for (const r of roster) {
    if (r.runtime !== runtime || !r.note) continue
    const entry = entryFor(models, r.id, runtime)
    if (entry) entry.note = r.note
  }
  return { ...kept, models }
}

/**
 * The catalog id of the model a thread is on or would start on, given the
 * model it names (a logged model, or its row's roster id): that entry, else the
 * runtime's default, else the first model offered.
 */
function catalogModel(catalog: ModelCatalog, named: string | null | undefined, runtime: AgentRuntime): string | null {
  const entry = named ? entryFor(catalog.models, named, runtime) : undefined
  return entry?.id ?? catalog.defaultId ?? catalog.models[0]?.id ?? null
}

/** What the composer's model controls offer a thread on `runtime` that is on, or would start on, `named`. */
export function threadModels(runtime: AgentRuntime, roster: readonly ModelEntry[], named: string | null | undefined): ThreadModels {
  const catalog = modelCatalog(runtime, roster)
  return { runtime, models: catalog.models, current: catalogModel(catalog, named, runtime) }
}
