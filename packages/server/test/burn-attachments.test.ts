import { execFile } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { ATTACHMENTS_DIR, annotationPath, attachmentRelPath } from '@runcastle/core/paths'
import { simpleGit } from 'simple-git'
import type { SimpleGit } from 'simple-git'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { burnWorktreePath, excludePath } from '../src/services/git'
import {
  attachedNoteIds,
  attachmentSources,
  buildAttachmentCopyCommands,
  clearAttachments,
} from '../src/workflows/ticket-burner'
import { useDataDir } from './helpers/data-dir'

/**
 * An annotated note's screenshot riding into the burn that fixes it (spec.md
 * "Riding into the burn"), tested at the burner's workspace-preparation seam.
 *
 * The seam is host-side by construction: sandcastle runs these commands after
 * `git worktree add` and before it starts a sandbox, so the images are already
 * in the directory docker binds — which is why the same copy serves `noSandbox`
 * unchanged. That is what the tests here drive: the real commands, in a real
 * worktree of a real repo, with git asked afterwards what it thinks of them.
 */

const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3])
const NOTE = 'n_Ab3-xY_9qWer'
const OTHER_NOTE = 'n_ZZ0011aabbcc'

/** The context the promotion writes for a note with a screenshot. */
function contextNaming(...noteIds: string[]): string {
  return [
    'Found during lap 1 test drive of wide-app.',
    ...noteIds.map(
      (id) =>
        `An annotated screenshot of the problem is at ${attachmentRelPath(id)} in your workspace — Read it before starting; the drawing marks the problem area.`,
    ),
  ].join('\n\n')
}

describe('burn attachments — reading the ticket context back out', () => {
  it('recovers the note ids the promotion named, in order and without repeats', () => {
    expect(attachedNoteIds(contextNaming(NOTE, OTHER_NOTE))).toEqual([NOTE, OTHER_NOTE])
    expect(attachedNoteIds(`${contextNaming(NOTE)}\n\nsee ${attachmentRelPath(NOTE)}`)).toEqual([
      NOTE,
    ])
  })

  it('finds nothing in the context of a plain note', () => {
    expect(
      attachedNoteIds(
        'Found during lap 1 test drive of wide-app.\n\nRead docs/features/wide-app/spec.md.',
      ),
    ).toEqual([])
  })
})

describe('burn attachments — which screenshots actually ride along', () => {
  let home: string
  let restoreDataDir: () => void

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'rc-burn-attach-home-'))
    restoreDataDir = useDataDir(home)
    mkdirSync(join(home, '.runcastle', 'annotations'), { recursive: true })
  })

  afterEach(() => {
    restoreDataDir()
    rmSync(home, { recursive: true, force: true })
  })

  it('resolves each named note to its PNG on disk', () => {
    writeFileSync(annotationPath(NOTE), PNG)

    expect(attachmentSources(contextNaming(NOTE))).toEqual([annotationPath(NOTE)])
  })

  it('drops a note whose PNG was deleted between promotion and burn', () => {
    writeFileSync(annotationPath(OTHER_NOTE), PNG)

    // The context still names both; only the one still on disk can ride.
    expect(attachmentSources(contextNaming(NOTE, OTHER_NOTE))).toEqual([
      annotationPath(OTHER_NOTE),
    ])
    expect(attachmentSources(contextNaming(NOTE))).toEqual([])
  })

  it('asks for no copy at all when nothing is attached', () => {
    expect(buildAttachmentCopyCommands([])).toEqual([])
  })
})

describe('burn attachments — preparing the workspace', () => {
  const branch = 'runcastle/ticket/wide-app/3-6erDoFV'
  const exec = promisify(execFile)

  let home: string
  let restoreDataDir: () => void
  let repo: string
  let g: SimpleGit
  let workspace: string

  beforeEach(async () => {
    home = mkdtempSync(join(tmpdir(), 'rc-burn-attach-home-'))
    restoreDataDir = useDataDir(home)
    mkdirSync(join(home, '.runcastle', 'annotations'), { recursive: true })
    writeFileSync(annotationPath(NOTE), PNG)

    repo = mkdtempSync(join(tmpdir(), 'rc-burn-attach-repo-'))
    g = simpleGit(repo)
    await g.init(['-b', 'main'])
    await g.addConfig('user.email', 'test@runcastle.dev')
    await g.addConfig('user.name', 'Runcastle Test')
    await g.addConfig('core.autocrlf', 'false')
    writeFileSync(join(repo, 'README.md'), 'base\n')
    await g.add(['README.md'])
    await g.commit('initial commit')

    // Stand in for sandcastle's `branch` strategy: the worktree it creates at
    // the derivable path, which is the cwd its host hooks then run in.
    workspace = burnWorktreePath(repo, branch)
    mkdirSync(join(repo, '.sandcastle', 'worktrees'), { recursive: true })
    await g.raw(['worktree', 'add', '-b', branch, workspace, 'main'])
  })

  afterEach(() => {
    restoreDataDir()
    rmSync(home, { recursive: true, force: true })
    rmSync(repo, { recursive: true, force: true })
  })

  /** Run the host hooks exactly as sandcastle does: in order, cwd = worktree. */
  async function runWorkspacePrep(context: string): Promise<void> {
    await excludePath(repo, `${ATTACHMENTS_DIR}/`)
    for (const { command } of buildAttachmentCopyCommands(attachmentSources(context))) {
      await exec(command, { cwd: workspace, shell: true })
    }
  }

  it('lands the PNG at the relative path the ticket context named', async () => {
    await runWorkspacePrep(contextNaming(NOTE))

    expect(readFileSync(join(workspace, ATTACHMENTS_DIR, `${NOTE}.png`))).toEqual(Buffer.from(PNG))
  })

  it('leaves the workspace clean, so no commit of the agent`s can pick it up', async () => {
    await runWorkspacePrep(contextNaming(NOTE))

    expect(await simpleGit(workspace).raw(['status', '--porcelain'])).toBe('')
    // The exclude lives in git's own dir, so the tracked tree is untouched: no
    // `.gitignore` edit, and nothing new for the human's checkout to report
    // (`.sandcastle/` is sandcastle's own, and a real repo ignores it).
    expect(await g.raw(['status', '--porcelain'])).toBe('?? .sandcastle/\n')
    expect(existsSync(join(repo, '.gitignore'))).toBe(false)
  })

  it('excludes idempotently, however many tickets burn against one repo', async () => {
    await excludePath(repo, `${ATTACHMENTS_DIR}/`)
    await Promise.all([
      excludePath(repo, `${ATTACHMENTS_DIR}/`),
      excludePath(repo, `${ATTACHMENTS_DIR}/`),
    ])

    const lines = readFileSync(join(repo, '.git', 'info', 'exclude'), 'utf8')
      .split('\n')
      .filter((l) => l === `${ATTACHMENTS_DIR}/`)
    expect(lines).toHaveLength(1)
  })

  it('takes the attachments back out when the run is over', async () => {
    await runWorkspacePrep(contextNaming(NOTE))
    expect(existsSync(join(workspace, ATTACHMENTS_DIR))).toBe(true)

    clearAttachments(workspace)

    expect(existsSync(join(workspace, ATTACHMENTS_DIR))).toBe(false)
    // Called again on a workspace sandcastle already removed: still no throw.
    rmSync(workspace, { recursive: true, force: true })
    expect(() => clearAttachments(workspace)).not.toThrow()
  })

  it('prepares nothing, and fails nothing, when the promoted note`s PNG is gone', async () => {
    rmSync(annotationPath(NOTE))

    await runWorkspacePrep(contextNaming(NOTE))

    expect(existsSync(join(workspace, ATTACHMENTS_DIR))).toBe(false)
    expect(await simpleGit(workspace).raw(['status', '--porcelain'])).toBe('')
  })

  it('copies with the shell each host actually has', () => {
    const src = join('C:', 'Users', 'dev', '.runcastle', 'annotations', `${NOTE}.png`)

    expect(buildAttachmentCopyCommands([src], 'win32')).toEqual([
      { command: `if not exist ".runcastle-attachments" mkdir ".runcastle-attachments"` },
      { command: `copy /Y "${src}" ".runcastle-attachments\\${NOTE}.png" >nul` },
    ])
    expect(buildAttachmentCopyCommands(['/home/dev/.runcastle/annotations/a.png'], 'linux')).toEqual(
      [
        { command: `mkdir -p ".runcastle-attachments"` },
        { command: `cp "/home/dev/.runcastle/annotations/a.png" ".runcastle-attachments/a.png"` },
      ],
    )
  })
})
