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
 *
 * Patched dependencies are the second crux. The workspace fixes third-party
 * packages through root `patchedDependencies`, and that mechanism reaches ONLY
 * this monorepo's node_modules: a user's `bun add -g runcastle` resolves every
 * external dep straight from the registry, unpatched. v1.2.11 shipped that way
 * and every burn died in sandcastle's mount code, which the patch had taught
 * about named volumes. So a patched dependency has exactly two legal fates —
 * bundled INTO the published JS ({@link BUNDLED_DEPENDENCIES}, verified after
 * the build by {@link findMissingPatchMarkers}), or left external with a written
 * reason the patch is not needed there ({@link PATCHED_EXTERNAL_DEPENDENCIES}).
 * {@link checkPatchedDependencies} fails the build on any third fate.
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

/** One-line npm description (mirrors packages/server/README.md). */
export const PUBLISHED_DESCRIPTION = 'Burn tickets into shipped features with Claude Code.'

/** SPDX license (matches the workspace root; the source server manifest omits it). */
export const PUBLISHED_LICENSE = 'FSL-1.1-ALv2'

/**
 * Source-repo metadata. `repository.url` is REQUIRED for a provenance publish:
 * npm's Trusted Publishing verifier (E422 otherwise) checks that it normalizes to
 * the same repo the OIDC/provenance claim came from — https://github.com/MuathZahir/runcastle.
 */
export const REPOSITORY_URL = 'git+https://github.com/MuathZahir/runcastle.git'
export const HOMEPAGE_URL = 'https://github.com/MuathZahir/runcastle#readme'
export const BUGS_URL = 'https://github.com/MuathZahir/runcastle/issues'

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

/**
 * Dependencies bundled INTO the published `index.js` instead of installed from
 * the registry. Each carries the regexes the built output must match — code
 * the workspace patch introduces — so a build that resolved an unpatched copy
 * (or dropped the dep from the bundle) fails at build time, not on a user's
 * first burn. Match code, never comments: the bundler may strip those.
 */
export const BUNDLED_DEPENDENCIES: Readonly<
  Record<string, { readonly why: string; readonly markers: readonly RegExp[] }>
> = {
  '@ai-hero/sandcastle': {
    why: 'patched to mount Docker/Podman named volumes (patches/@ai-hero%2Fsandcastle@0.12.0.patch); the patch only applies inside this workspace',
    markers: [
      // resolveUserMounts: a `{ volume }` mount is carried through, not stat'ed.
      /if\s*\(\s*m\.volume\s*!==\s*(?:void 0|undefined)\s*\)/,
      // formatVolumeMount: no SELinux relabel on a named volume.
      /mount\.volume\s*!==\s*(?:void 0|undefined)/,
      // docker sandbox: the marker survives the mount map.
      /volume:\s*m\.volume/,
    ],
  },
}

/**
 * Patched dependencies that stay external ANYWAY, each with the reason the
 * published package is correct without its patch. Anything patched that is
 * neither here nor bundled is a build error.
 */
export const PATCHED_EXTERNAL_DEPENDENCIES: Readonly<Record<string, string>> = {
  'node-pty':
    'native CJS module — cannot be bundled. Its patch (a) no-ops the compile-from-source install hook, which bun never runs for a dependency anyway, and (b) quietens the ConPTY console-list agent on headless kills (a 5s delay, not a failure).',
}

/** The bare package name of a `patchedDependencies` key (`name@version` → `name`). */
export function patchedDependencyName(key: string): string {
  const at = key.lastIndexOf('@')
  return at > 0 ? key.slice(0, at) : key
}

/**
 * Every patched dependency must be accounted for: bundled (with markers to
 * verify) or explicitly external with a reason. Returns the build errors —
 * empty when every patch has a legal fate.
 */
export function checkPatchedDependencies(patchedDependencies: Record<string, string>): string[] {
  const errors: string[] = []
  for (const key of Object.keys(patchedDependencies)) {
    const name = patchedDependencyName(key)
    if (name in BUNDLED_DEPENDENCIES || name in PATCHED_EXTERNAL_DEPENDENCIES) continue
    errors.push(
      `${key} is patched in the workspace but would ship unpatched: add it to BUNDLED_DEPENDENCIES (and bundle it) or to PATCHED_EXTERNAL_DEPENDENCIES with the reason the patch is unnecessary in the published package`,
    )
  }
  return errors
}

/** The markers of `name`'s patch that `source` (a built bundle) does NOT contain. */
export function findMissingPatchMarkers(name: string, source: string): RegExp[] {
  const bundled = BUNDLED_DEPENDENCIES[name]
  if (!bundled) throw new Error(`${name} is not a bundled dependency`)
  return bundled.markers.filter((marker) => !marker.test(source))
}

/** True when `source` still imports `name` from node_modules instead of inlining it. */
export function importsExternally(name: string, source: string): boolean {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`\\b(?:from|import|require)\\s*\\(?\\s*["']${escaped}(?:/[^"']*)?["']`).test(source)
}

/** True for a dep that can't ship — the workspace protocol or a private pkg. */
function isUnshippable(name: string, spec: string): boolean {
  return name.startsWith('@runcastle/') || spec.startsWith('workspace:') || name in BUNDLED_DEPENDENCIES
}

/**
 * Merge the runtime deps that survive into the tarball: everything from the
 * server, core (bundled in) and every bundled dependency's own runtime deps
 * (bundled in too, so what THEY import must now resolve from our node_modules),
 * minus the unshippable ones. A dep pinned in two places must agree — a drifted
 * duplicate is a build error, not a silently-picked winner.
 */
function mergeRuntimeDeps(...depSets: Record<string, string>[]): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [name, spec] of depSets.flatMap((deps) => Object.entries(deps))) {
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
  /**
   * The manifests of every {@link BUNDLED_DEPENDENCIES} entry, keyed by name.
   * Required in full: a bundled dep whose manifest is missing would silently
   * lose its own runtime deps from the published package.
   */
  bundledPkgs?: Record<string, PackageJson>
}): PackageJson {
  const { serverPkg, corePkg } = opts
  const bundledPkgs = opts.bundledPkgs ?? {}
  for (const name of Object.keys(BUNDLED_DEPENDENCIES)) {
    if (!(name in bundledPkgs)) throw new Error(`bundled dependency ${name}: manifest not supplied`)
  }
  const manifest: PackageJson = {
    name: PUBLISHED_NAME,
    version: opts.version ?? serverPkg.version ?? '0.0.0',
    description: PUBLISHED_DESCRIPTION,
    license: PUBLISHED_LICENSE,
    type: serverPkg.type ?? 'module',
    bin: { [PUBLISHED_NAME]: `./bin/${PUBLISHED_NAME}.js` },
    engines: serverPkg.engines,
    // repository is required for provenance verification (see REPOSITORY_URL).
    repository: { type: 'git', url: REPOSITORY_URL },
    homepage: HOMEPAGE_URL,
    bugs: { url: BUGS_URL },
    files: [...PUBLISHED_FILES],
    dependencies: mergeRuntimeDeps(
      serverPkg.dependencies ?? {},
      corePkg.dependencies ?? {},
      ...Object.values(bundledPkgs).map((pkg) => pkg.dependencies ?? {}),
    ),
  }
  // `private`, `devDependencies`, and build-time `scripts` (dev/prepack/etc.)
  // must not reach the tarball — omit them entirely.
  return manifest
}
