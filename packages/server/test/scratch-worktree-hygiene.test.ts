import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { resolvePluginDir } from '../src/launcher/skills-root'
import { burnerAssetPath, burnerTemplatePath } from '../src/workflows/ticket-burner'

/**
 * Prompts are content, so the only way to assert a rule in one is to read the
 * shipped file and pin its wording — the same thing `tickets-skill.test` does
 * for the tickets skill. The rule pinned here came from the wild: a review
 * session created `<repo>/.occ-review` with the feature branch checked out and
 * never removed it, so the branch had a holder no other worktree could take it
 * from, and the next lap's launch had to fight its way past it. Every prompt
 * that tells an agent to examine a branch carries the same two halves —
 * detached, and removed — because a prompt that carries only one of them is
 * how the directory gets left behind.
 */
describe('the branch-examining prompts', () => {
  const prompts = (): Array<[string, string]> =>
    [
      join(resolvePluginDir(), 'skills', 'code-review', 'SKILL.md'),
      burnerAssetPath('review-ticket.md'),
      burnerAssetPath('verify-fixes.md'),
      burnerTemplatePath(),
    ].map((path) => [path, readFileSync(path, 'utf8')])

  it('only ever spell a scratch worktree detached, and always remove it', () => {
    for (const [path, text] of prompts()) {
      expect(text, path).toContain('git worktree add --detach')
      expect(text, path).toContain('git worktree remove')
      // The shape that caused the incident appears only as a prohibition.
      expect(text, path).toMatch(/never `git worktree add <path> <branch>`/i)
    }
  })

  it('tell the review flows to read the branch rather than check it out', () => {
    for (const path of [
      join(resolvePluginDir(), 'skills', 'code-review', 'SKILL.md'),
      burnerAssetPath('review-ticket.md'),
      burnerAssetPath('verify-fixes.md'),
    ]) {
      expect(readFileSync(path, 'utf8'), path).toMatch(/never (check|leave)/i)
    }
  })
})
