import type { RouterOutputs, SettingsView } from '../src/lib/api'
import { listItem } from '../test/fixtures'
import { project } from '../../../.runcastle/preview/shell-fakes'

/** Sample data for preview/rest.tsx: three projects, a set-up machine's settings, a half-set-up doctor. */

export const projects = [
  project,
  { ...project, id: 'proj_2', name: 'field-notes', repoPath: '/home/you/code/field-notes' },
  {
    ...project,
    id: 'proj_3',
    name: 'billing-service-with-a-very-long-name',
    repoPath: '/home/you/work/clients/northwind/platform/services/billing-service',
  },
] as RouterOutputs['project']['list']

export const featuresOf = (input: unknown) => {
  const id = (input as { projectId?: string } | undefined)?.projectId
  if (id === 'proj_2')
    return [
      listItem({ id: 'f1', projectId: 'proj_2', title: 'Offline drafts', waitingReason: 'ready to test' }),
      listItem({ id: 'f2', projectId: 'proj_2', title: 'Share links' }),
    ]
  if (id === 'proj_3') return []
  return [
    listItem({ id: 'f3', title: 'Slack alerts on failed runs', activeRun: true }),
    listItem({ id: 'f4', title: 'Export a run as a report' }),
    listItem({ id: 'f5', title: 'Faster sidebar' }),
  ]
}

const f = (key: string, value: unknown, over: Record<string, unknown> = {}) => ({
  key,
  restartRequired: key === 'serverPort',
  scope: 'global',
  value,
  source: value === null ? 'default' : 'file',
  editable: true,
  ...over,
})

const roster = [
  { id: 'claude-opus-5-5', runtime: 'claude-code', note: 'Complex work and anything with a screen' },
  { id: 'claude-haiku-5-5', runtime: 'claude-code', note: 'Simple, mechanical work' },
]

const model = (id: string, runtime: string, displayName: string, description: string) => ({
  id,
  runtime,
  displayName,
  description,
})

const discovery = {
  sources: {
    'claude-code': {
      status: 'ok',
      lastSuccessAt: Date.now() - 3_600_000,
      lastAttemptAt: Date.now() - 3_600_000,
      models: [
        model('claude-opus-5-5', 'claude-code', 'Opus 5.5', 'Best for everyday, complex tasks'),
        model('claude-sonnet-5-5', 'claude-code', 'Sonnet 5.5', 'Balanced'),
        model('claude-haiku-5-5', 'claude-code', 'Haiku 5.5', 'Fastest'),
      ],
      newIds: [],
      knownIds: [],
    },
    codex: {
      status: 'failed',
      lastAttemptAt: Date.now() - 7_200_000,
      error: 'codex exited with 1',
      models: [model('gpt-6-luna', 'codex', 'GPT-6-Luna', 'Fast and affordable')],
      newIds: [],
      knownIds: [],
    },
  },
}

const shared = [
  f('serverPort', 4512, { source: 'default' }),
  f('sessionMcp', 'inherit', { source: 'default' }),
  f('burnConcurrency', 3, { source: 'default' }),
  f('burnMaxIterations', 3, { source: 'default' }),
  f('burnAttempts', 3, { source: 'default' }),
  f('burnConflictAttempts', 2, { source: 'default' }),
  f('burnCpus', 8),
  f('stepModels.chat', null),
  f('stepModels.implement', 'claude-opus-5-5'),
  f('stepModels.review', 'claude-opus-5-5'),
  f('stepModels.prepare', null),
  f('stepModels.project', null),
  f('stepModels.smoke', 'claude-haiku-5-5', { source: 'default' }),
]

export const globalSettings = {
  discovery,
  fields: [
    f('model', 'claude-opus-5-5'),
    f('models', roster),
    f('sandbox', 'docker'),
    f('sandboxImage', null),
    f('setupCommand', null),
    f('verifyCommands', null),
    f('knownFailures', null),
    ...shared,
  ],
} as unknown as SettingsView

export const projectSettings = {
  projectId: project.id,
  discovery,
  fields: [
    f('model', 'claude-opus-5-5', { scope: 'project' }),
    f('sandbox', 'docker', { scope: 'project' }),
    f('sandboxImage', null, { scope: 'project' }),
    f('setupCommand', 'bun install', { scope: 'project', source: 'project' }),
    f('verifyCommands', 'bun run typecheck\nbun run test', { scope: 'project', source: 'project' }),
    f('knownFailures', 'Both verify commands are expected fully green.', { scope: 'project', source: 'project' }),
    f('devCommand', 'bun run dev', { scope: 'project', source: 'project' }),
    f('sessionBranch', null, { scope: 'project' }),
    f('docsCommitPrefix', 'runcastle:', { scope: 'project', source: 'default' }),
    f('dbResetCommand', 'rm -f ~/.runcastle-dev/runcastle.db', { scope: 'project', source: 'project' }),
    f('driveSetupCommand', 'bun .runcastle/drive-setup.ts', { scope: 'project', source: 'project' }),
    f('driveStopCommand', 'bun .runcastle/drive-stop.ts', { scope: 'project', source: 'project' }),
    f('driveInstructions', 'Use the demo project for all testing.', { scope: 'project', source: 'project' }),
    f('scenarioRunner', null, { scope: 'project' }),
    ...shared,
  ],
} as unknown as SettingsView

export const prep = {
  pendingKeys: [],
  findings: [
    {
      key: 'setupCommand',
      source: 'session',
      evidence: 'The root package.json is a bun workspace, so one install covers every package.',
      establishedAt: Date.now() - 3 * 86_400_000,
    },
    {
      key: 'devCommand',
      source: 'session',
      evidence: 'Started the server and the web app and saw both answer.',
      establishedAt: Date.now() - 3 * 86_400_000,
    },
  ],
  prepared: true,
  empty: false,
  preparedAt: 1,
  dryRun: null,
} as unknown as RouterOutputs['project']['prep']

const probe = (id: string, label: string, status: string, detail: string, over: Record<string, unknown> = {}) => ({
  id,
  label,
  tier: 2,
  status,
  severity: 'error',
  detail,
  ...over,
})

/** A machine with an agent ready and the unattended parts half done. */
export const doctorHalfDone = {
  ok: false,
  tier1Ok: true,
  results: [
    probe('git-identity', 'Git identity', 'ok', 'You <you@example.com>'),
    probe('claude', 'Claude Code CLI', 'ok', '2.1.314 (Claude Code)', { runtime: 'claude-code', check: 'binary' }),
    probe('claude-auth', 'Claude Code login', 'ok', 'claude reports a login', { runtime: 'claude-code', check: 'auth' }),
    probe('afk-token', 'Claude Code AFK token', 'error', 'CLAUDE_CODE_OAUTH_TOKEN not set', {
      runtime: 'claude-code',
      check: 'afk-key',
    }),
    probe('codex', 'Codex CLI', 'ok', 'codex-cli 0.155.1', { runtime: 'codex', check: 'binary', severity: 'info' }),
    probe('codex-auth', 'Codex login', 'ok', 'credentials found', { runtime: 'codex', check: 'auth', severity: 'info' }),
    probe('container-runtime', 'Container runtime', 'ok', 'Docker version 28.5.2, build ecc6942'),
    probe(
      'sandcastle-image',
      'Sandcastle container image',
      'stale',
      'sandcastle:runcastle: Claude Code 2.1.295 in image, 2.1.314 on host, rebuild',
      { fix: 'Open Settings → Workers (Rebuild image).' },
    ),
  ],
} as unknown as RouterOutputs['setup']['doctor']

/** A fresh machine: no identity, one agent installed but not signed in, one missing. */
export const doctorFresh = {
  ok: false,
  tier1Ok: true,
  results: [
    probe('git-identity', 'Git identity', 'error', 'user.email not set'),
    probe('claude', 'Claude Code CLI', 'ok', '2.1.314 (Claude Code)', { runtime: 'claude-code', check: 'binary' }),
    probe('claude-auth', 'Claude Code login', 'error', 'not signed in', { runtime: 'claude-code', check: 'auth' }),
    probe('afk-token', 'Claude Code AFK token', 'error', 'CLAUDE_CODE_OAUTH_TOKEN not set', {
      runtime: 'claude-code',
      check: 'afk-key',
    }),
    probe('codex', 'Codex CLI', 'error', 'codex was not found on PATH', {
      runtime: 'codex',
      check: 'binary',
      severity: 'info',
      fix: 'npm i -g @openai/codex',
    }),
    probe('codex-auth', 'Codex login', 'error', 'not signed in', { runtime: 'codex', check: 'auth', severity: 'info' }),
    probe('container-runtime', 'Container runtime', 'error', 'docker was not found on PATH'),
    probe('sandcastle-image', 'Sandcastle container image', 'error', 'not built'),
  ],
} as unknown as RouterOutputs['setup']['doctor']

export const roots = [
  { label: '/', path: '/', kind: 'drive' },
  { label: 'Home', path: '/home/you', kind: 'home' },
  { label: 'code', path: '/home/you/code', kind: 'common' },
] as RouterOutputs['project']['roots']

export const listing = {
  dir: '/home/you/code',
  parent: '/home/you',
  crumbs: [
    { name: '/', path: '/' },
    { name: 'home', path: '/home' },
    { name: 'you', path: '/home/you' },
    { name: 'code', path: '/home/you/code' },
  ],
  entries: [
    { name: 'field-notes', path: '/home/you/code/field-notes', isRepo: true, isSymlink: false },
    { name: 'runcastle', path: '/home/you/code/runcastle', isRepo: true, isSymlink: false },
    { name: 'scratch', path: '/home/you/code/scratch', isRepo: false, isSymlink: false },
    { name: 'vendor', path: '/home/you/code/vendor', isRepo: false, isSymlink: true },
  ],
  truncated: false,
} as unknown as RouterOutputs['project']['browse']

export const imageTarget = {
  kind: 'ready',
  dockerfile: '.runcastle/sandbox/Dockerfile',
  tag: 'sandcastle:runcastle',
} as unknown as RouterOutputs['setup']['imageBuildTarget']
