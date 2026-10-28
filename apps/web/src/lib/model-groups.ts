import { modelFamily, type Effort, type ModelChoice } from './chat-thread'

/**
 * The composer's model list, arranged (chat-as-web-components decision 13):
 * by family, newest first, the latest of each family in view and every older
 * version folded away. Read from the adapters' own labels — Claude's
 * "Opus 5.5", "Sonnet 4.6 (1M)"; Codex's "5.5", "5.5 Mini" — so it needs no
 * table of model ids.
 */

export interface ModelGroup {
  /** "Opus", "Sonnet"; "GPT-5" on Codex. */
  family: string
  /** The family's newest version (each of its variants, a 1M one beside it). */
  latest: ModelChoice[]
  /** Every earlier version, newest first. */
  older: ModelChoice[]
}

/** Claude's families, most capable first; any other family follows in the order the runtime lists it. */
const FAMILY_ORDER = ['Fable', 'Opus', 'Sonnet', 'Haiku']

/**
 * The effort `model` runs the next message on: the level held, where the model
 * takes it; else the one a session on it starts on; else `default`, the
 * runtime's own level, while nobody has said which that is — never a guessed
 * level the next turn may not run on. None for a model that takes no levels.
 */
export function effortShown(model: ModelChoice | undefined, held: Effort | undefined): Effort | 'default' | undefined {
  const efforts = model?.efforts ?? []
  if (!efforts.length) return undefined
  for (const level of [held, model?.defaultEffort]) if (level && efforts.includes(level)) return level
  return 'default'
}

/** Newer first. */
function byVersion(a: number[], b: number[]): number {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const d = (b[i] ?? 0) - (a[i] ?? 0)
    if (d) return d
  }
  return 0
}

export function groupModels(models: readonly ModelChoice[]): ModelGroup[] {
  const families = new Map<string, { model: ModelChoice; version: number[] }[]>()
  for (const model of models) {
    const { family, version } = modelFamily(model.label)
    families.set(family, [...(families.get(family) ?? []), { model, version }])
  }
  const rank = (family: string) => {
    const known = FAMILY_ORDER.indexOf(family)
    return known < 0 ? FAMILY_ORDER.length : known
  }
  return [...families.entries()]
    .map(([family, members], at) => ({ family, members, at }))
    .sort((a, b) => rank(a.family) - rank(b.family) || a.at - b.at)
    .map(({ family, members }) => {
      // A stable sort keeps the runtime's own order among one version's variants.
      const sorted = [...members].sort((a, b) => byVersion(a.version, b.version))
      const newest = sorted[0].version
      return {
        family,
        latest: sorted.filter((m) => byVersion(m.version, newest) === 0).map((m) => m.model),
        older: sorted.filter((m) => byVersion(m.version, newest) !== 0).map((m) => m.model),
      }
    })
}
