/**
 * One-off live-state repair (batched-bugfix item 2).
 *
 * Feature `feat_Oq7SVoUpPTvf` was advanced PAST gate G3 into `implementation`
 * by an ideation session's `complete_phase({ phase: 'tickets' })` — a G3
 * violation (only the human Burn click may cross G3; see docs/research/
 * CORRECTIONS.md C3). The code fix stops this happening again; this script
 * repairs the one feature already stranded there.
 *
 * It sets the feature's phase back to `tickets` and emits a `phase.corrected`
 * timeline event referencing the fix, using the real server services against the
 * live db (`~/.runcastle/runcastle.db`, WAL — safe alongside the running dev
 * server). It is idempotent: a feature already at `tickets` is left untouched.
 *
 * Run: `bun run scripts/fix-feature-phase.ts [featureId]`
 */

import { dbPath } from '../packages/core/src/paths.ts'
import { loadConfig } from '../packages/core/src/config-load.ts'
import { createDb } from '../packages/server/src/db/client.ts'
import type { AppCtx } from '../packages/server/src/db/types.ts'
import { getFeatureRow, setPhase } from '../packages/server/src/services/repo.ts'
import { listByFeature } from '../packages/server/src/services/tickets.ts'

const FEATURE_ID = process.argv[2] ?? 'feat_Oq7SVoUpPTvf'

const db = createDb(dbPath())
const ctx: AppCtx = { db, config: loadConfig() }

function log(msg: string): void {
  process.stdout.write(`${msg}\n`)
}

log(`repair: db = ${dbPath()}`)
log(`repair: feature = ${FEATURE_ID}`)

const before = getFeatureRow(ctx, FEATURE_ID)
const ticketCount = listByFeature(ctx, FEATURE_ID).length
log(`repair: before → phase=${before.phase}, tickets=${ticketCount}`)

if (before.phase === 'tickets') {
  log('repair: feature already at `tickets` — nothing to do (idempotent no-op).')
} else if (before.phase !== 'implementation') {
  log(`repair: feature is at \`${before.phase}\`, not \`implementation\` — refusing to touch it.`)
  process.exit(1)
} else {
  const after = setPhase(
    ctx,
    FEATURE_ID,
    'tickets',
    'phase.corrected',
    'G3 gate-violation repair: complete_phase(tickets) had advanced past the human Burn gate; phase restored to `tickets` so the human Burn click is again the only G3 crossing (docs/research/CORRECTIONS.md C3).',
  )
  log(`repair: after  → phase=${after.phase}`)
  log('repair: emitted event `phase.corrected`.')
}
