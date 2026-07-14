import { defineConfig } from 'drizzle-kit'

/**
 * Dev-time only. Generates SQL migrations from the core drizzle schema into
 * `./drizzle`, which are bundled and applied at boot by `db/migrate.ts`
 * (`runMigrations`) — no manual `drizzle-kit push`/`migrate` step is ever run
 * by a user. Regenerate after a core schema change with `bun run db:generate`.
 */
export default defineConfig({
  dialect: 'sqlite',
  schema: '../core/src/db-schema.ts',
  out: './drizzle',
})
