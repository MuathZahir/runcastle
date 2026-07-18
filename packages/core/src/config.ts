import * as z from 'zod'

/**
 * Runtime configuration schema. This module is PURE — no IO and no `node:`
 * imports — so it is safe to include in the browser-facing core barrel
 * (`index.ts`). The file-reading loader (`loadConfig`) lives in `./config-load`,
 * which pulls in `node:fs` + `./paths` and is therefore node-only; import it
 * directly via `@runcastle/core/config-load`, never through the barrel.
 */

export const RuncastleConfig = z.object({
  serverPort: z.number().default(4512),
  model: z.string().default('claude-opus-4-8'),
  smokeModel: z.string().default('claude-haiku-4-5-20251001'),
  sandbox: z.enum(['docker', 'podman', 'noSandbox']).default('docker'),
  mainBranch: z.string().default('main'),
  /**
   * Docker image name for the sandcastle burner sandbox (B3 / SPEC §8). When
   * unset, sandcastle derives its default (`sandcastle:<repo-dir-name>`). The
   * demo image is tagged `sandcastle:runcastle-demo`. Applies to `docker` and
   * `podman`; ignored for `noSandbox`.
   */
  sandboxImage: z.string().optional(),
})
export type RuncastleConfig = z.infer<typeof RuncastleConfig>
