import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, userEvent, waitFor, within } from 'storybook/test'
import type { RouterOutputs } from '../../../../apps/web/src/lib/api'
import { AppAt } from '../../../storybook/app-at'
import { failLoudly } from '../../../storybook/fail-loudly'
import { withApi } from '../../../storybook/fake-api'
import { withShell } from '../../../storybook/shell-fakes'

/**
 * The first-run wizard, as the whole app shows it to a host that is not set up
 * yet (lib/first-run.ts `setupComplete`): no git identity, so `/` lands on
 * onboarding (lib/projects.ts `launchView`). Each state is one screen of the
 * flow; the screens have no address, so every state after the first walks there
 * the way a user does, clicking the wizard's own buttons, and checks it arrived.
 *
 * The states differ only in what the doctor's probes report about the host.
 */
type DoctorReport = RouterOutputs['setup']['doctor']
type Probe = DoctorReport['results'][number]
type Runtime = NonNullable<Probe['runtime']>

/** Each agent as the doctor names it (packages/server/src/doctor/doctor.ts `RUNTIME_SPECS`). */
const RUNTIMES: Record<Runtime, { label: string; bin: string; version: string; login: string; install: string }> = {
  'claude-code': {
    label: 'Claude Code',
    bin: 'claude',
    version: '2.1.4 (Claude Code)',
    login: 'claude auth login',
    install:
      'Install Claude Code: curl -fsSL https://claude.ai/install.sh | bash (Windows: irm https://claude.ai/install.ps1 | iex)',
  },
  codex: {
    label: 'Codex',
    bin: 'codex',
    version: 'codex-cli 0.48.0',
    login: 'codex login',
    install: 'Install Codex: npm install -g @openai/codex (or: brew install codex)',
  },
}

const identityUnset: Probe = {
  id: 'git-identity',
  label: 'Git identity (user.name / user.email)',
  tier: 1,
  status: 'unset',
  severity: 'error',
  detail: 'user.name, user.email not set — commits (docs, merges) would fail',
  fix: 'git config --global user.name "Your Name" && git config --global user.email "you@example.com"',
}

/** A coding agent's CLI, on PATH or not. */
function binary(runtime: Runtime, installed: boolean): Probe {
  const spec = RUNTIMES[runtime]
  const base = { id: spec.bin, label: `${spec.label} CLI`, tier: 1 as const, runtime, check: 'binary' as const }
  return installed
    ? { ...base, status: 'ok', severity: 'error', detail: spec.version }
    : { ...base, status: 'missing', severity: 'info', detail: `${spec.bin} not found on PATH`, fix: spec.install }
}

/** A coding agent's interactive login, for an installed CLI. */
function login(runtime: Runtime, signedIn: boolean): Probe {
  const spec = RUNTIMES[runtime]
  const base = {
    id: `${spec.bin}-auth`,
    label: `${spec.label} login (interactive sessions)`,
    tier: 1 as const,
    runtime,
    check: 'auth' as const,
  }
  return signedIn
    ? { ...base, status: 'ok', severity: 'error', detail: `${spec.bin} reports a login` }
    : {
        ...base,
        status: 'unset',
        severity: 'error',
        detail: `${spec.bin} reports no interactive login — sessions on ${spec.label} would stop to log in`,
        fix: `Run \`${spec.login}\` (the wizard and Settings can run it for you).`,
      }
}

/** A host with no git identity yet, whose coding agents report `agents`. */
function host(...agents: Probe[]): DoctorReport {
  return { results: [identityUnset, ...agents], ok: false, tier1Ok: false }
}

/** The usual first run: Claude Code installed but not signed in, no Codex. */
const claudeInstalled = host(binary('claude-code', true), login('claude-code', false), binary('codex', false))
const noneInstalled = host(binary('claude-code', false), binary('codex', false))
const claudeSignedIn = host(binary('claude-code', true), login('claude-code', true), binary('codex', false))

/**
 * The page with a host the doctor describes. The git identity write is the one
 * write answered: every later step sits behind its success.
 */
function onboarding(doctor: DoctorReport) {
  return {
    layout: 'fullscreen',
    ...withApi({
      trpc: withShell({
        project: { list: () => [] },
        setup: {
          doctor: () => doctor,
          gitIdentity: () => ({ ...identityUnset, status: 'ok', detail: 'Ada Lovelace <ada@example.com>' }),
        },
      }),
    }),
  }
}

const meta = {
  title: 'Onboarding',
  render: () => <AppAt path="/" />,
  parameters: onboarding(claudeInstalled),
} satisfies Meta

export default meta
type Story = StoryObj<typeof meta>
type Canvas = ReturnType<typeof within>

/**
 * A walk through the wizard: the page, and a user who types without per-key
 * delays, so a frame whose timers the browser throttles (a map frame scrolled
 * off screen) cannot stall mid-word.
 */
type Walk = { canvas: Canvas; user: ReturnType<typeof userEvent.setup> }

const walk = (canvasElement: HTMLElement): Walk => ({
  canvas: within(canvasElement),
  user: userEvent.setup({ delay: null }),
})

/**
 * Generous, because each screen animates in (FirstRunWizard.tsx; DESIGN.md's
 * Motion section) and a throttled frame advances that slowly.
 */
const PATIENCE = { timeout: 15_000 }

/** Waits until the screen titled `name` has finished arriving. */
async function onScreen({ canvas }: Walk, name: string | RegExp) {
  await waitFor(() => expect(canvas.getByRole('heading', { name })).toBeVisible(), PATIENCE)
}

/** Clicks a button once it is there and enabled. */
async function press({ canvas, user }: Walk, name: string) {
  const button = await canvas.findByRole('button', { name }, PATIENCE)
  await waitFor(() => expect(button).toBeEnabled(), PATIENCE)
  await user.click(button)
}

/** The steps a user takes to each screen, each one checked before the next. */
async function toIdentity(walk: Walk) {
  await onScreen(walk, /driven through a pipeline/)
  await press(walk, 'Set up runcastle')
  await onScreen(walk, 'Set your git identity')
}

async function toCodingAgents(walk: Walk) {
  await toIdentity(walk)
  const { canvas, user } = walk
  await user.type(await canvas.findByPlaceholderText('Ada Lovelace', {}, PATIENCE), 'Ada Lovelace')
  await user.type(await canvas.findByPlaceholderText('ada@example.com', {}, PATIENCE), 'ada@example.com')
  await press(walk, 'Continue')
  await onScreen(walk, 'Connect a coding agent')
}

async function toAfkBurns(walk: Walk) {
  await toCodingAgents(walk)
  await press(walk, 'Continue')
  await onScreen(walk, 'Run burns unattended?')
}

/** One agent's card: its name and the one-word status the card wears. */
async function expectCard(canvas: Canvas, label: string, status: string) {
  const card = (await canvas.findByText(label, { selector: 'span' })).closest('li')
  await expect(card).not.toBeNull()
  await expect(within(card as HTMLElement).getByText(status)).toBeVisible()
}

export const Welcome: Story = { name: '1 Welcome' }

export const GitIdentity: Story = {
  name: '2 Git identity',
  play: failLoudly(async ({ canvasElement }) => toIdentity(walk(canvasElement))),
}

export const CodingAgents: Story = {
  name: '3 Coding agents',
  play: failLoudly(async ({ canvasElement }) => {
    const user = walk(canvasElement)
    const { canvas } = user
    await toCodingAgents(user)
    await expectCard(canvas, 'Claude Code', 'Not signed in')
    await expectCard(canvas, 'Codex', 'Not installed')
    await expect(canvas.getByRole('button', { name: 'Run claude auth login' })).toBeVisible()
    await expect(canvas.getByRole('button', { name: 'Continue' })).toBeDisabled()
  }),
}

export const CodingAgentsNoneInstalled: Story = {
  name: '3 Coding agents · None installed',
  parameters: onboarding(noneInstalled),
  play: failLoudly(async ({ canvasElement }) => {
    const user = walk(canvasElement)
    const { canvas } = user
    await toCodingAgents(user)
    await expectCard(canvas, 'Claude Code', 'Not installed')
    await expectCard(canvas, 'Codex', 'Not installed')
    await expect(canvas.getByText(/Connect at least one agent to continue/)).toBeVisible()
    await expect(canvas.getByRole('button', { name: 'Continue' })).toBeDisabled()
  }),
}

export const CodingAgentsClaudeCodeSignedIn: Story = {
  name: '3 Coding agents · Claude Code signed in',
  parameters: onboarding(claudeSignedIn),
  play: failLoudly(async ({ canvasElement }) => {
    const user = walk(canvasElement)
    const { canvas } = user
    await toCodingAgents(user)
    await expectCard(canvas, 'Claude Code', 'Ready')
    await expectCard(canvas, 'Codex', 'Not installed')
    await expect(canvas.getByRole('button', { name: 'Continue' })).toBeEnabled()
  }),
}

export const AfkBurns: Story = {
  name: '4 AFK burns',
  parameters: onboarding(claudeSignedIn),
  play: failLoudly(async ({ canvasElement }) => toAfkBurns(walk(canvasElement))),
}

export const FirstProject: Story = {
  name: '5 First project',
  parameters: onboarding(claudeSignedIn),
  play: failLoudly(async ({ canvasElement }) => {
    const user = walk(canvasElement)
    await toAfkBurns(user)
    await press(user, 'Skip for now')
    await onScreen(user, 'Open your first project')
  }),
}
