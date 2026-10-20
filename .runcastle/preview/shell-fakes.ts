import type { RouterOutputs } from '../../apps/web/src/lib/api'
import { listItem } from '../../apps/web/test/fixtures'
import type { TrpcFakes } from './fake-api'

/**
 * The one project every page story stands in: the id `test/fixtures.ts` gives
 * its features, so a fixture feature is already this project's.
 */
export const PROJECT_ID = 'proj_1'

export const project = {
  id: PROJECT_ID,
  name: 'runcastle',
  repoPath: '/home/you/code/runcastle',
} as RouterOutputs['project']['list'][number]

/**
 * A host the first-run wizard has nothing left to ask (lib/first-run.ts
 * `setupComplete`): a git identity and one coding agent installed and signed in.
 */
const setUpHost = {
  results: [
    { id: 'git-identity', status: 'ok', detail: 'You <you@example.com>' },
    { id: 'claude-code-binary', runtime: 'claude-code', check: 'binary', status: 'ok', detail: 'claude 1.0.0' },
    { id: 'claude-code-auth', runtime: 'claude-code', check: 'auth', status: 'ok', detail: 'logged in' },
  ],
} as unknown as RouterOutputs['setup']['doctor']

/**
 * What the shell asks on first render, answered for one prepared project with
 * nothing on it yet: the project list and the doctor (where to land), the
 * update check, the sidebar's features, prep, drive and notes, the project
 * session's chat and branch and the events feed. A page story spreads
 * these with {@link withShell} and states only what makes its page differ.
 */
export const shellFakes = {
  project: {
    list: () => [project],
    prep: () => ({ pendingKeys: [], findings: [], prepared: true, empty: false, preparedAt: 1, dryRun: null }),
    projectSession: () => null,
    conversations: () => [],
    sessionBranch: () => ({ stored: null, effective: 'main', detected: 'main' }),
    branches: () => ({ current: 'main', detected: 'main', branches: ['main'], remoteBranches: [] }),
  },
  setup: { doctor: () => setUpHost },
  system: {
    checkUpdate: () => ({ current: '0.0.0', latest: '0.0.0', updateAvailable: false, command: 'bun add -g runcastle@latest' }),
  },
  feature: { list: () => [listItem()], driveInfo: () => null },
  projectNotes: { openCount: () => 0, list: () => [] },
  events: { listByProject: () => [] },
} satisfies TrpcFakes

/**
 * The shell defaults with a story's own answers on top, merged per router so an
 * override replaces one procedure and keeps its neighbours.
 */
export function withShell(fakes: TrpcFakes = {}): TrpcFakes {
  const merged: Record<string, object> = { ...shellFakes }
  for (const [router, procedures] of Object.entries(fakes)) {
    merged[router] = { ...merged[router], ...procedures }
  }
  return merged as TrpcFakes
}
