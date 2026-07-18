# runcastle

Burn tickets into shipped features with Claude Code.

```sh
bun add -g runcastle      # install
runcastle                 # boot the server + serve the app on http://localhost:4512
runcastle doctor          # check prerequisites (add --gate for the pre-boot gate)
runcastle --version
```

An update banner appears in-app when a newer version is published; it names the
exact `bun add -g runcastle@latest` command and never installs anything for you.

## How this package is built (issue #51)

This directory is the **source** of the published `runcastle` package, but it is
not shipped as-is — as a workspace member it is `private` and depends on
`@runcastle/core` through the `workspace:*` protocol, neither of which resolves
outside the monorepo. The `prepack` step (`scripts/build-package.ts`) assembles a
self-contained package under `build/`:

- **Core is bundled in.** `Bun.build` bundles the server + bin entrypoints to
  plain JS with `@runcastle/core` resolved into the output (not `--compile`).
  Every real dependency (node-pty, simple-git, hono, drizzle, …) stays external
  so it installs normally and keeps its prebuilds — the tarball's dependency tree
  carries no `workspace:*`.
- **Runtime assets ship as real files.** The drizzle migrations, the hook client
  (spawned by `bun`), the PTY sidecar host (spawned by `node`), the skills pack +
  burner prompts, and the built SPA are copied beside the bin — they can't live
  inside a bundle because separate processes read them by path.
- **One resolver, both layouts.** `src/launcher/asset-paths.ts` resolves every
  such asset via an env override that wins-and-fails-loudly, else the workspace
  source path. The bin points those env vars at the vendored copies when it
  detects the installed layout (`applyInstalledAssetEnv`); a contributor checkout
  finds none beside the bin and falls back to `packages/*` unchanged.
- **The published manifest** (`scripts/publish-manifest.ts`) takes the public
  name `runcastle`, drops `private`, folds core's runtime deps in, and points
  `bin`/`files` at the built layout.

```sh
bun run build:pkg           # assemble build/
cd build && bun pm pack     # produce the tarball
```

The contributor clone path is unaffected: `bun install` at the repo root and
`bun run dev` still run from source.
