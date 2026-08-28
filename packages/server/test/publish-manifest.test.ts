import { describe, expect, it } from 'vitest'
import {
  BUNDLED_DEPENDENCIES,
  buildPublishedManifest,
  checkPatchedDependencies,
  findMissingPatchMarkers,
  importsExternally,
  PATCHED_EXTERNAL_DEPENDENCIES,
  patchedDependencyName,
} from '../scripts/publish-manifest'

/**
 * Issue #51 — `packages/server` BECOMES the published `runcastle` package,
 * assembled by the prepack build. The generated manifest is the crux the
 * reviewer flagged: it must carry the public name, drop `private`, and contain
 * NO `workspace:*` / `@runcastle/*` deps (core is bundled in), or `bun add -g
 * runcastle` fails to resolve on a clean machine.
 */

const SERVER_PKG = {
  name: '@runcastle/server',
  version: '0.0.0',
  private: true,
  type: 'module',
  bin: { runcastle: 'src/bin/runcastle.ts' },
  engines: { bun: '>=1.3.14' },
  files: ['src', 'drizzle'],
  scripts: { dev: 'bun --hot src/index.ts', prepack: 'bun run scripts/build-package.ts' },
  dependencies: {
    '@ai-hero/sandcastle': '0.12.0',
    '@runcastle/core': 'workspace:*',
    'drizzle-orm': '0.45.2',
    hono: '4.12.30',
    zod: '4.4.3',
  },
  devDependencies: { 'bun-types': '1.3.14', 'drizzle-kit': '0.31.10' },
}

const CORE_PKG = {
  name: '@runcastle/core',
  version: '0.0.0',
  private: true,
  dependencies: { 'drizzle-orm': '0.45.2', nanoid: '6.0.0', zod: '4.4.3' },
}

/** sandcastle as resolved from node_modules — bundled in, so its deps become ours. */
const SANDCASTLE_PKG = {
  name: '@ai-hero/sandcastle',
  version: '0.12.0',
  dependencies: { '@clack/prompts': '^1.1.0' },
  peerDependencies: { '@daytona/sdk': '^0.164.0' },
}
const BUNDLED = { '@ai-hero/sandcastle': SANDCASTLE_PKG }

function build(overrides?: { version?: string }) {
  return buildPublishedManifest({
    serverPkg: SERVER_PKG,
    corePkg: CORE_PKG,
    bundledPkgs: BUNDLED,
    ...overrides,
  })
}

/** A built bundle that inlined the PATCHED sandcastle (the shapes the patch adds). */
const PATCHED_BUNDLE = `
var resolveUserMounts = (mounts, sandboxHomedir) => mounts.map((m) => {
  if (m.volume !== void 0) {
    return { hostPath: m.volume, sandboxPath: resolveSandboxPath(m.sandboxPath, sandboxHomedir), volume: m.volume };
  }
  const resolvedHostPath = resolveHostPath(m.hostPath);
});
var formatVolumeMount = (mount, selinuxLabel) => {
  const selinux = mount.volume !== void 0 ? void 0 : selinuxLabel || void 0;
};
var docker = (options) => {
  const volumeMounts = allMounts.map((m) => ({ hostPath: m.hostPath, readonly: m.readonly, volume: m.volume }));
};
`

/** The same bundle built from the REGISTRY copy: v1.2.11's output. */
const UNPATCHED_BUNDLE = `
var resolveUserMounts = (mounts, sandboxHomedir) => mounts.map((m) => {
  const resolvedHostPath = resolveHostPath(m.hostPath);
});
var formatVolumeMount = (mount, selinuxLabel) => {
  const options = [mount.readonly ? "ro" : void 0, selinuxLabel || void 0];
};
`

describe('buildPublishedManifest', () => {
  it('names the package `runcastle` and un-privates it', () => {
    const m = build()
    expect(m.name).toBe('runcastle')
    expect('private' in m).toBe(false)
  })

  it('carries NO workspace:* protocol and NO @runcastle/* dep', () => {
    const m = build()
    const deps = m.dependencies ?? {}
    for (const [name, spec] of Object.entries(deps)) {
      expect(name.startsWith('@runcastle/')).toBe(false)
      expect(String(spec).startsWith('workspace:')).toBe(false)
    }
    expect('@runcastle/core' in deps).toBe(false)
  })

  it('drops every bundled dependency and folds ITS runtime deps in', () => {
    const deps = build().dependencies ?? {}
    // sandcastle is inlined (patched) — a registry install of it must not happen.
    expect('@ai-hero/sandcastle' in deps).toBe(false)
    // …but what sandcastle itself imports must now resolve from our node_modules.
    expect(deps['@clack/prompts']).toBe('^1.1.0')
    // peer deps (optional cloud sandboxes) are not runtime deps and stay out.
    expect('@daytona/sdk' in deps).toBe(false)
  })

  it('refuses to build without the manifest of every bundled dependency', () => {
    // Silently dropping sandcastle's deps would ship a package that cannot import @clack/prompts.
    expect(() => buildPublishedManifest({ serverPkg: SERVER_PKG, corePkg: CORE_PKG })).toThrow(
      /@ai-hero\/sandcastle: manifest not supplied/,
    )
  })

  it("folds core's own runtime deps in (core is bundled, its deps become ours)", () => {
    const m = build()
    // nanoid ships only in core; it must survive into the published deps.
    expect(m.dependencies?.nanoid).toBe('6.0.0')
    // deps present in both keep a single, consistent pin.
    expect(m.dependencies?.['drizzle-orm']).toBe('0.45.2')
  })

  it('points the bin at the built JS, not the TS source', () => {
    const m = build()
    expect(m.bin).toEqual({ runcastle: './bin/runcastle.js' })
  })

  it('lists every vendored asset in `files`', () => {
    const files = build().files ?? []
    for (const f of [
      'index.js',
      'bin',
      'hook-client.ts',
      'pty-host.cjs',
      'drizzle',
      'skills',
      'web',
      'sandcastle-template',
    ]) {
      expect(files).toContain(f)
    }
  })

  it('drops build-time scripts and devDependencies from the tarball', () => {
    const m = build()
    expect(m.devDependencies).toBeUndefined()
    expect(m.scripts?.prepack).toBeUndefined()
  })

  it('keeps the Bun engine pin', () => {
    expect(build().engines?.bun).toBe('>=1.3.14')
  })

  it('carries a repository.url that matches the repo (required for provenance)', () => {
    // A provenance publish (E422) fails unless repository.url normalizes to the
    // GitHub repo the OIDC claim came from.
    const repo = build().repository as { type?: string; url?: string } | undefined
    expect(repo?.url).toBe('git+https://github.com/MuathZahir/runcastle.git')
  })

  it('sets license and description so the npm page is not blank', () => {
    const m = build()
    expect(m.license).toBe('FSL-1.1-ALv2')
    expect(m.description).toBeTruthy()
  })

  it('aligns the version to the release when one is given', () => {
    expect(build({ version: '1.4.2' }).version).toBe('1.4.2')
    expect(build().version).toBe('0.0.0')
  })
})

/**
 * The patched-dependency contract (v1.2.11 regression): a workspace patch only
 * applies inside this monorepo, so every patched dep must be bundled (and the
 * patch proven present in the output) or be explicitly, with a reason, external.
 */
describe('patched dependencies', () => {
  const ROOT_PATCHES = {
    '@ai-hero/sandcastle@0.12.0': 'patches/@ai-hero%2Fsandcastle@0.12.0.patch',
    'node-pty@1.1.0': 'patches/node-pty@1.1.0.patch',
  }

  it('strips the version from a patchedDependencies key, scoped or not', () => {
    expect(patchedDependencyName('@ai-hero/sandcastle@0.12.0')).toBe('@ai-hero/sandcastle')
    expect(patchedDependencyName('node-pty@1.1.0')).toBe('node-pty')
    expect(patchedDependencyName('node-pty')).toBe('node-pty')
  })

  it("accepts the workspace's current patches: sandcastle bundled, node-pty external with a reason", () => {
    expect(checkPatchedDependencies(ROOT_PATCHES)).toEqual([])
    expect('@ai-hero/sandcastle' in BUNDLED_DEPENDENCIES).toBe(true)
    expect(PATCHED_EXTERNAL_DEPENDENCIES['node-pty']).toMatch(/native/)
  })

  it('fails the build for a patch that would ship unpatched', () => {
    const errors = checkPatchedDependencies({ ...ROOT_PATCHES, 'simple-git@3.36.0': 'patches/simple-git.patch' })
    expect(errors).toHaveLength(1)
    expect(errors[0]).toMatch(/simple-git@3\.36\.0 is patched/)
    expect(errors[0]).toMatch(/BUNDLED_DEPENDENCIES/)
  })

  it('finds every patch marker in a bundle built from the patched sandcastle', () => {
    expect(findMissingPatchMarkers('@ai-hero/sandcastle', PATCHED_BUNDLE)).toEqual([])
  })

  it("reports the markers a registry (unpatched) sandcastle lacks — v1.2.11's bundle", () => {
    const missing = findMissingPatchMarkers('@ai-hero/sandcastle', UNPATCHED_BUNDLE)
    expect(missing).toHaveLength(BUNDLED_DEPENDENCIES['@ai-hero/sandcastle']!.markers.length)
  })

  it('tolerates the bundler printing `undefined` for `void 0`', () => {
    expect(findMissingPatchMarkers('@ai-hero/sandcastle', PATCHED_BUNDLE.replaceAll('void 0', 'undefined'))).toEqual([])
  })

  it('rejects a marker check for a dependency that is not bundled', () => {
    expect(() => findMissingPatchMarkers('hono', '')).toThrow(/not a bundled dependency/)
  })

  it('detects an entrypoint that still imports the dependency from node_modules', () => {
    const name = '@ai-hero/sandcastle'
    expect(importsExternally(name, `import { run } from "@ai-hero/sandcastle";`)).toBe(true)
    expect(importsExternally(name, `import { docker } from '@ai-hero/sandcastle/sandboxes/docker'`)).toBe(true)
    expect(importsExternally(name, `const m = await import("@ai-hero/sandcastle")`)).toBe(true)
    expect(importsExternally(name, `require("@ai-hero/sandcastle")`)).toBe(true)
    // inlined: only the code remains, plus a same-named string that is not an import.
    expect(importsExternally(name, `${PATCHED_BUNDLE}\nconst label = "@ai-hero/sandcastle"`)).toBe(false)
    // a different package sharing the prefix is not it.
    expect(importsExternally(name, `import x from "@ai-hero/sandcastle-extras"`)).toBe(false)
  })
})
