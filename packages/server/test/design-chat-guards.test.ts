import { describe, expect, it } from 'vitest'
import { evaluateEditGuard, isUnguardedLead } from '../src/launcher/edit-guard'
import { evaluateInstallGuard } from '../src/launcher/install-guard'

/**
 * Every feature chat is the lead from its first message
 * (tickets-and-review-are-tools-not-phases decisions 4 and 13): both talk guards
 * lift for it, attended or headless, self-planning included. Other kinds stay
 * guarded.
 */
const wt = '/wt/dark-mode'
const edit = (over: Parameters<typeof evaluateEditGuard>[0] extends infer T ? Partial<T> : never) =>
  evaluateEditGuard({
    kind: 'chat',
    toolName: 'Edit',
    worktreePath: wt,
    featureSlug: 'dark-mode',
    filePath: 'src/Button.tsx',
    ...over,
  })
const install = (over: Partial<Parameters<typeof evaluateInstallGuard>[0]> = {}) =>
  evaluateInstallGuard({
    kind: 'chat',
    toolName: 'Bash',
    command: 'bun install',
    worktreePath: wt,
    talkWorktreePath: wt,
    ...over,
  })

describe('the lead is unguarded', () => {
  it('holds for chat and side sessions and no other kind', () => {
    expect(isUnguardedLead('chat')).toBe(true)
    expect(isUnguardedLead('side')).toBe(true)
    for (const kind of ['drive-fix', 'scenario', 'prepare', 'project'] as const) {
      expect(isUnguardedLead(kind), kind).toBe(false)
    }
  })
})

describe('edit guard — every feature chat', () => {
  it('lets a chat write outside the docs', () => {
    expect(edit({})).toBeNull()
  })

  it('lets a self-plan run write too: the purpose no longer guards it', () => {
    expect(edit({ purpose: 'self-plan' })).toBeNull()
    expect(edit({ kind: 'side' })).toBeNull()
  })

  it('leaves other kinds guarded', () => {
    expect(edit({ kind: 'drive-fix' })).not.toBeNull()
    expect(edit({ kind: 'scenario' })).not.toBeNull()
    expect(edit({ kind: 'prepare', featureSlug: undefined })).not.toBeNull()
  })
})

describe('install guard — every feature chat', () => {
  it('lets a chat and a side session install', () => {
    expect(install()).toBeNull()
    expect(install({ command: 'npm ci' })).toBeNull()
    expect(install({ kind: 'side' })).toBeNull()
  })

  it('still blocks another kind in the talk worktree', () => {
    expect(install({ kind: 'scenario' })).not.toBeNull()
  })
})
