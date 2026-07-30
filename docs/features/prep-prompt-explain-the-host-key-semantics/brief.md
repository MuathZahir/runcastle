# Prep prompt: explain the host-key semantics

Extend `renderPreparePrompt` in `packages/server/src/launcher/artifacts.ts` (currently ~line 312) so a preparation agent learns the semantics of the five host-only keys from the briefing itself instead of reverse-engineering the published minified build.

**Evidence this is needed:** a real prep session (helix project, installed runcastle 1.1.1) grepped `index.js` for `createdb` / `CREATE DATABASE` / `perBranch`, found nothing (those words exist only in source comments, stripped from the build), and confidently told the human that runcastle has no per-branch database support and that the branch→dbname derivation would have to be duplicated across `dbResetCommand` and `driveSetupCommand`. Both claims are false.

**What to add** — a compact per-key semantics block in the prep prompt, stating:
- `devCommand` — spawned in a drive-owned PTY pane during a test drive (`packages/server/src/pty/dev-pane.ts`); its localhost URL is sniffed for the "Open app" link.
- `driveSetupCommand` / `driveStopCommand` — run on the host before the dev pane starts / after the drive stops, in the project repo.
- `driveEnv` — `KEY=VALUE` lines whose values are rendered with `{{slug}}`, `{{branch}}`, `{{id}}` (`{{id}}` = identifier-safe slug, legal in a database name) — see `packages/server/src/services/drive-env.ts`. Rendered ONCE per drive; the same rendered environment is shared by the setup hook, the dev pane, and the stop hook (`driveEnvFor` in `packages/server/src/services/git.ts`). This is the intended home for a branch→dbname derivation: put `DB_NAME=myapp_{{id}}` (plus the matching `DATABASE_URL`) in `driveEnv` and have the hooks reference the env var — the derivation lives once, no helper script.
- Include one worked per-branch-database example in exactly that shape (env lines + create/migrate in setup + drop in stop).
- `dbResetCommand` — NOT part of the drive loop. Its only consumer is the post-drive migration-drift banner (`detectDbDrift`, `packages/server/src/services/git.ts` ~1561): when the drive branch and the returned-to branch disagree on migration files, the command is offered as the one-click dev-DB rebuild.

**Constraints:**
- Prompt-content change only — do not touch the drive machinery, schemas, or settings UI.
- Match the existing prep-prompt voice (second person, terse, evidence-minded) and keep the block short enough that it doesn't drown the agenda (`## Still open`).
- If `packages/server/test` has prompt-rendering tests for `renderPreparePrompt`, extend them to pin the new block; otherwise add one alongside the existing artifacts tests.
- Verify with the repo's own commands: `bun run typecheck` and `bun run test`.
