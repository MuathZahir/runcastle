import { existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Skills-root resolution (issue #51, workstream G). The server reads the
 * runcastle plugin pack and the burner prompt templates from the
 * `@runcastle/skills` package *as real files* at runtime. In a contributor
 * checkout those live at the workspace `packages/skills`; in a published install
 * they are vendored alongside the bin and `RUNCASTLE_SKILLS_DIR` points straight
 * at them — the same override contract `RUNCASTLE_WEB_DIST` gives the built SPA
 * (see routes/web.ts). Notify, never guess: an unset root surfaces loudly.
 */

/** Env override naming the vendored skills root in a published install. */
export const SKILLS_DIR_ENV = 'RUNCASTLE_SKILLS_DIR'

/** A valid skills root carries the runcastle pack — the ascent/validity marker. */
export const SKILLS_MARKER = join('packs', 'runcastle')

/**
 * Resolve the `@runcastle/skills` root (the dir containing `packs/` and
 * `burner/`). `RUNCASTLE_SKILLS_DIR` wins when set (validated so a bad override
 * throws rather than failing later at launch); otherwise ascend from `fromDir`
 * to the workspace `packages/skills`. Throws — naming every location searched —
 * rather than returning a path that isn't on disk.
 */
export function resolveSkillsRoot(fromDir: string): string {
  const override = process.env[SKILLS_DIR_ENV]
  if (override) {
    const root = resolve(override)
    if (existsSync(join(root, SKILLS_MARKER))) return root
    throw new Error(
      `${SKILLS_DIR_ENV}=${override} is not a runcastle skills root (missing ${SKILLS_MARKER})`,
    )
  }

  const searched: string[] = []
  let dir = fromDir
  for (let i = 0; i < 8; i += 1) {
    const candidate = join(dir, 'packages', 'skills')
    searched.push(candidate)
    if (existsSync(join(candidate, SKILLS_MARKER))) return candidate
    const parent = dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  throw new Error(`runcastle skills root not found; searched:\n  ${searched.join('\n  ')}`)
}

/**
 * Resolve the `runcastle` plugin dir (`packages/skills/packs/runcastle`).
 * Ascends from `fromDir` looking for the marker dir (robust against the server
 * being run from anywhere). If no ancestor contains it, throws an error naming
 * every location searched — never a silent fallback to a path that doesn't
 * exist (a missing pack must surface loudly, not fail later at launch time).
 */
export function resolvePluginDir(
  fromDir: string = dirname(fileURLToPath(import.meta.url)),
): string {
  const rel = join('packages', 'skills', 'packs', 'runcastle')

  // Published install: skills are vendored as real files and RUNCASTLE_SKILLS_DIR
  // names their root — read the pack straight from there (issue #51). A bad
  // override throws loudly rather than silently falling back to a workspace path.
  const override = process.env[SKILLS_DIR_ENV]
  if (override) {
    const dir = join(resolve(override), 'packs', 'runcastle')
    if (existsSync(dir)) return dir
    throw new Error(`${SKILLS_DIR_ENV}=${override} has no plugin dir at ${dir}`)
  }

  const searched: string[] = []
  let dir = fromDir
  for (let i = 0; i < 8; i += 1) {
    const candidate = join(dir, rel)
    searched.push(candidate)
    if (existsSync(candidate)) return candidate
    const parent = dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  throw new Error(
    `runcastle plugin dir (${rel}) not found; searched:\n  ${searched.join('\n  ')}`,
  )
}
