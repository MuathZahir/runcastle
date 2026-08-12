# Web typecheck TData erasure + project-session EPERM teardown

Two fixes left over from the `dry-run-fallout-windows-teardown-typecheck-fixes` burn. Both were diagnosed there; neither could be applied, for different reasons. They are independent — land both.

The Windows dev-pane teardown leak from that same burn is NOT here: it is its own feature (`windows-dev-pane-teardown-kill-the-process-the-sidecar-actually-owns`). Do not touch `packages/server/src/pty/**` in this ticket.

---

## 1. `apps/web` typecheck — 3 errors, and the ORIGINAL diagnosis was WRONG

**Read this first, it will save you an hour.** The previously recorded cause — "apps/web/tsconfig.json lacks bun-types, so AppRouter degrades to `{}`" — was **disproven** by the burner. `AppRouter` infers fully. Adding `bun-types` produces the same three errors. The project's `knownFailures` text has since been corrected by the author; if you find any remaining note telling you not to edit these components, it is stale.

**Actual cause:** the two components type their locals off `ReturnType<typeof trpc.<x>.<y>.useQuery>`. That type's `TData` parameter is unconstrained in that position, so it erases to `unknown`, and every property access off the result collapses.

**The errors:**
- `src/components/EnableAfkCard.tsx(64,81)` TS2339: Property 'results' does not exist on type '{}'
- `src/components/SettingsOverlay.tsx(112,36)` TS2741: Property 'fields' is missing
- `src/components/SettingsOverlay.tsx(121,7)` TS2322: Type 'unknown' is not assignable to type 'ReactNode'

**The fix requires editing those two component files** — which the previous ticket explicitly forbade, which is why it stopped. That prohibition is lifted. This ticket authorises editing `EnableAfkCard.tsx` and `SettingsOverlay.tsx`.

**Before you start:** the previous burner left its exact proposed replacements in a `BLOCKED.md`. That file is NOT on `main` and NOT in any commit — it exists only in the worktree of branch `feature/dry-run-fallout-windows-teardown-typecheck-fixes`, if that worktree still exists. Look for it and use it if you find it; if it is gone, re-derive the fix from the diagnosis above — do not block on it.

**Direction:** stop deriving these types from `ReturnType<typeof …useQuery>`. Prefer naming the data type at the source — the router's own inferred output types (tRPC exposes `inferRouterOutputs`-style helpers for exactly this) — so the components state the shape they need rather than reaching through a hook's return type. Do not paper over it with `any`, `as` casts, or `@ts-expect-error`.

**Acceptance:** `bun run --filter '@runcastle/web' typecheck` exits 0. The components' runtime behaviour is unchanged. Report in your result that the project's recorded `knownFailures` baseline can now be cleared for web typecheck — that is a settings action for the author, not repo work.

---

## 2. `project-session.test.ts` EPERM on Windows teardown — 5/5 deterministic

**Where:** `packages/server/test/project-session.test.ts`. Assertions pass; `rmSync` cleanup throws EPERM on a held handle. Reproduces 5/5 on the author's Windows host. It CANNOT reproduce on Linux — the previous burner's "15/15 pass here" was a Linux run and proves nothing about this bug.

**Why the previous fix did not work:** a retry helper (10 x 100ms) was added, but the burner's own analysis identified the handle owner as a **fire-and-forget git child process** spawned via `endSession -> landProjectSession -> landProjectBranch`. That child outlives the retry window, so widening the retry is treating the symptom and will stay flaky.

**Fix direction:** make the test await the landing work it triggers, rather than racing it. Find where `landProjectSession` / `landProjectBranch` spawns without awaiting, and give the test a way to know when it has finished — awaiting a returned promise, or an explicit completion signal the test can wait on. If production genuinely wants that spawn to be fire-and-forget, the handle still needs to be observable for teardown; say so in your result if you conclude the production code must change, and make the minimal change that lets the test wait.

Keep the retry helper as a backstop if it is already there; do not rely on it as the fix.

**Acceptance:** `project-session.test.ts` passes with clean teardown on Windows 5 runs in a row. State plainly in your result which platform you verified on — if you can only run Linux, say so rather than claiming the bug is fixed.

---

## Verification

`bun run typecheck` and `env -u GIT_ASKPASS bun run test` fully green, plus `bun run --filter '@runcastle/web' typecheck` green (that is the point of half this ticket).
