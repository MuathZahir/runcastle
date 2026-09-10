// A side-effect import is what makes this file a MODULE, so the block below is
// a module *augmentation* that merges into sandcastle's own `NoSandboxOptions`.
// Without it the file would be a script, and `declare module` would become an
// ambient declaration that SHADOWS the real module — hiding `noSandbox` itself.
import '@ai-hero/sandcastle/sandboxes/no-sandbox'

/**
 * The type half of `onChildSpawn`, restated so it cannot go missing.
 *
 * `patches/@ai-hero%2Fsandcastle@0.12.0.patch` adds `onChildSpawn` to both the
 * runtime provider and its `.d.ts`, and ADR-0011 makes that patch permanent. But
 * ADR-0011 §2 also records the standing tax: a plain `bun install` does not
 * always re-apply a *changed* patch, so a checkout whose `node_modules` predates
 * the kill-handle hunk keeps a `NoSandboxOptions` with no `onChildSpawn` on it —
 * and every `noSandbox({ onChildSpawn })` call site turns red (TS2353) for a
 * reason that has nothing to do with the code being compiled.
 *
 * Declaring the property here makes `bun run typecheck` a gate on this
 * repository rather than on the freshness of one machine's `node_modules`.
 * It hides nothing: if the patch's RUNTIME hunk is the half that went missing,
 * `test/sandcastle-kill-handles.test.ts` fails loudly — it drives the compiled
 * provider precisely because "a `bun install` silently stops applying it" is the
 * patch's known failure mode — and `scripts/publish-manifest.ts` pins the same
 * hunk by regex so the published bundle cannot ship without it.
 *
 * The declaration is a copy of the patch's, and must stay one; regenerating the
 * patch on a sandcastle bump (ADR-0011 §2) means re-checking this too.
 */
declare module '@ai-hero/sandcastle/sandboxes/no-sandbox' {
  interface NoSandboxOptions {
    /**
     * runcastle patch — called with the PID of every child this provider spawns.
     *
     * The host provider spawns a fresh shell per `exec`, so a callback is the
     * only way a caller can learn what to kill when a run is aborted. Not called
     * when the spawn itself failed and there is no PID. When omitted, nothing
     * changes.
     */
    readonly onChildSpawn?: (pid: number) => void
  }
}
