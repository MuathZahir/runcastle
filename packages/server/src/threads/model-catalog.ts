import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { modelFamily, type AgentRuntime, type Effort, type ModelChoice, type ModelEntry, type ThreadModels } from '@runcastle/core'
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

/**
 * Two names for one model: compared without case, spaces or punctuation, and
 * whichever way a 1M one spells its context ("(1M)", "(1M context)").
 */
export const labelKey = (label: string) =>
  label
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
    .replace(/context/g, '')

/** Claude Code's 1M-context model-id modifier. */
export const LONG_CONTEXT = /\[1m\]$/i

/** The catalog entry a roster id names: by id, else by the label the adapter gives it. */
function entryFor(models: readonly ModelChoice[], id: string, runtime: AgentRuntime): ModelChoice | undefined {
  const label = labelKey(rosterLabel(id, runtime))
  return models.find((m) => m.id === id) ?? models.find((m) => labelKey(m.label) === label)
}

/**
 * The effort levels each runtime's models take, for a model no session has run
 * on yet nor any of its family: Claude Code's levels, and Codex's that
 * runcastle offers (its `minimal` and `xhigh` are not).
 */
const RUNTIME_EFFORTS: Record<AgentRuntime, Effort[]> = {
  'claude-code': ['low', 'medium', 'high', 'max'],
  codex: ['low', 'medium', 'high'],
}

/**
 * Every model with the effort levels and fast mode it offers, said or not: a
 * session's options describe only the model it runs on, so a model none has
 * run on takes what a session said of its family ("Sonnet 4.6" what one said
 * of "Sonnet 5.5"), else its runtime's levels.
 */
function withKnownControls(models: readonly ModelChoice[], runtime: AgentRuntime): ModelChoice[] {
  const family = (m: ModelChoice) => modelFamily(m.label).family
  const said = new Map<string, ModelChoice>()
  for (const m of models) if (m.efforts && !said.has(family(m))) said.set(family(m), m)
  return models.map((m) => {
    if (m.efforts) return m
    const kin = said.get(family(m))
    return { ...m, efforts: kin?.efforts ?? RUNTIME_EFFORTS[runtime], ...(kin?.fast ? { fast: true } : {}) }
  })
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
 * A roster 1M model (`claude-opus-5-5[1m]`) the adapter lists no entry for, as
 * its own entry right after its model's: "<model> (1M)", the adapter's label
 * for the model with the context named. Claude Code takes 1M as a modifier on
 * the model's own value (`modelValue` in `controls.ts`), so its list may not
 * offer it; the picker still does. A model the adapter does not list at all
 * gets none.
 */
function keepLongContext(models: ModelChoice[], id: string, runtime: AgentRuntime): void {
  if (!LONG_CONTEXT.test(id) || entryFor(models, id, runtime)) return
  const at = models.indexOf(entryFor(models, id.replace(LONG_CONTEXT, ''), runtime) as ModelChoice)
  if (at < 0 || models.some((m) => m.id === `${models[at].id}[1m]`)) return
  const { id: _, label, defaultEffort: __, ...controls } = models[at]
  models.splice(at + 1, 0, { ...controls, id, label: `${label} (1M)` })
}

/**
 * The runtime's catalog: the adapter's as last kept, else the roster mapped to
 * its shape, with the roster's 1M models the adapter lists none for. The
 * operator's note on a roster model is that model's one-line description where
 * they wrote one.
 */
export function modelCatalog(runtime: AgentRuntime, roster: readonly ModelEntry[]): ModelCatalog {
  const kept = readModelCatalog(runtime)
  if (!kept) return rosterCatalog(roster, runtime)
  const models = kept.models.map((m) => ({ ...m }))
  for (const r of roster) if (r.runtime === runtime) keepLongContext(models, r.id, runtime)
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

/**
 * What the composer's model controls offer a thread on `runtime` that is on, or
 * would start on, `named`, with the effort that model starts on where a session
 * has said it: a thread nobody picked an effort in runs its next turn on it.
 */
export function threadModels(runtime: AgentRuntime, roster: readonly ModelEntry[], named: string | null | undefined): ThreadModels {
  const catalog = modelCatalog(runtime, roster)
  const current = catalogModel(catalog, named, runtime)
  const effort = catalog.models.find((m) => m.id === current)?.defaultEffort
  return { runtime, models: withKnownControls(catalog.models, runtime), current, ...(effort ? { effort } : {}) }
}

/** The catalog's entry for the model `named` names (its id, or a roster id), so a thread logs the id and label its picker offers. */
export function catalogEntry(runtime: AgentRuntime, roster: readonly ModelEntry[], named: string): ModelChoice | undefined {
  return entryFor(modelCatalog(runtime, roster).models, named, runtime)
}
