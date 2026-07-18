/**
 * Build the published `runcastle` package manifest (issue #51, workstream G).
 *
 * `packages/server` is the source of the published package, but its workspace
 * manifest can't ship as-is: it is `private`, named `@runcastle/server`, and
 * depends on `@runcastle/core` via the `workspace:*` protocol that only resolves
 * inside this monorepo. The prepack build bundles core INTO the output, so the
 * published manifest must (a) take the public name, (b) drop `private`, (c) carry
 * no `workspace:*` / `@runcastle/*` dep, folding core's real runtime deps in, and
 * (d) point `bin`/`files` at the built layout. This is pure — the build script
 * writes what it returns; the test pins every one of those invariants.
 */

/** The subset of package.json fields this builder reads/writes. */
export interface PackageJson {
  name?: string
  version?: string
  private?: boolean
  type?: string
  bin?: Record<string, string>
  engines?: Record<string, string>
  files?: string[]
  scripts?: Record<string, string>
  dependencies?: Record<string, string>
  devDependencies?: Record<string, string>
  [key: string]: unknown
}

/** The published package name, bin name, and update-banner name — all one word. */
export const PUBLISHED_NAME = 'runcastle'

/** Real files/dirs vendored beside the built JS (see build-package.ts). */
export const PUBLISHED_FILES = [
  'index.js',
  'bin',
  'hook-client.ts',
  'pty-host.cjs',
  'drizzle',
  'skills',
  'web',
  'sandcastle-template',
] as const

/** True for a dep that can't ship — the workspace protocol or a private pkg. */
function isUnshippable(name: string, spec: string): boolean {
  return name.startsWith('@runcastle/') || spec.startsWith('workspace:')
}

/**
 * Merge the runtime deps that survive into the tarball: everything from the
 * server and (since core is bundled in) core, minus the unshippable ones. A dep
 * pinned in both must agree — a drifted duplicate is a build error, not a
 * silently-picked winner.
 */
function mergeRuntimeDeps(
  serverDeps: Record<string, string>,
  coreDeps: Record<string, string>,
): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [name, spec] of [...Object.entries(serverDeps), ...Object.entries(coreDeps)]) {
    if (isUnshippable(name, spec)) continue
    if (out[name] !== undefined && out[name] !== spec) {
      throw new Error(`dependency ${name} pinned to both ${out[name]} and ${spec}`)
    }
    out[name] = spec
  }
  return Object.fromEntries(Object.entries(out).sort(([a], [b]) => a.localeCompare(b)))
}

export function buildPublishedManifest(opts: {
  serverPkg: PackageJson
  corePkg: PackageJson
  /** Release version to stamp; defaults to the server manifest's version. */
  version?: string
}): PackageJson {
  const { serverPkg, corePkg } = opts
  const manifest: PackageJson = {
    name: PUBLISHED_NAME,
    version: opts.version ?? serverPkg.version ?? '0.0.0',
    type: serverPkg.type ?? 'module',
    bin: { [PUBLISHED_NAME]: `./bin/${PUBLISHED_NAME}.js` },
    engines: serverPkg.engines,
    files: [...PUBLISHED_FILES],
    dependencies: mergeRuntimeDeps(serverPkg.dependencies ?? {}, corePkg.dependencies ?? {}),
  }
  // `private`, `devDependencies`, and build-time `scripts` (dev/prepack/etc.)
  // must not reach the tarball — omit them entirely.
  return manifest
}
