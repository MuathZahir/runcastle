import { describe, expect, it } from 'vitest'
import { evaluateEditGuard } from '../src/launcher/edit-guard'
import { evaluateInstallGuard } from '../src/launcher/install-guard'

/**
 * Design mode lifts both talk guards for a human-attended feature chat in every
 * phase; only the headless self-plan run in planning stays docs-only.
 */
const wt = '/wt/dark-mode'
const edit = (over: Parameters<typeof evaluateEditGuard>[0] extends infer T ? Partial<T> : never) =>
  evaluateEditGuard({
    kind: 'chat',
    featurePhase: 'planning',
    toolName: 'Edit',
    worktreePath: wt,
    featureSlug: 'dark-mode',
    filePath: 'src/Button.tsx',
    ...over,
  })
const install = (over: Partial<Parameters<typeof evaluateInstallGuard>[0]> = {}) =>
  evaluateInstallGuard({
    kind: 'chat',
    featurePhase: 'planning',
    toolName: 'Bash',
    command: 'bun install',
    worktreePath: wt,
    talkWorktreePath: wt,
    ...over,
  })

describe('edit guard — design mode', () => {
  it('lets a human chat write outside the docs in planning', () => {
    expect(edit({})).toBeNull()
  })

  it('still denies a self-plan chat in planning, and allows it past Go', () => {
    expect(edit({ purpose: 'self-plan' })?.reason).toMatch(/Talk sessions do not write code/)
    expect(edit({ purpose: 'self-plan', featurePhase: 'building' })).toBeNull()
  })

  it('leaves other kinds guarded', () => {
    expect(edit({ kind: 'drive-fix' })).not.toBeNull()
    expect(edit({ kind: 'scenario' })).not.toBeNull()
    expect(edit({ kind: 'prepare', featureSlug: undefined })).not.toBeNull()
  })
})

describe('install guard — design mode', () => {
  it('lets a human chat install in planning', () => {
    expect(install()).toBeNull()
    expect(install({ command: 'npm ci' })).toBeNull()
  })

  it('still blocks a self-plan chat in planning', () => {
    expect(install({ purpose: 'self-plan' })).not.toBeNull()
    expect(install({ purpose: 'self-plan', command: 'npm ci' })).not.toBeNull()
  })
})
