import { exec } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { promisify } from 'node:util'
import { ATTACHMENTS_DIR, annotationPath, attachmentRelPath } from '@runcastle/core/paths'
import { simpleGit } from 'simple-git'
import type { SimpleGit } from 'simple-git'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { burnWorktreePath, excludePath } from '../src/services/git'
import {
  ISOLATED_REPO_PATH,
  SANDBOX_WORKSPACE_PATH,
  attachedNoteIds,
  attachmentSources,
  buildAttachmentCopyCommands,
  buildIsolatedSetupCommand,
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

/** Exactly how sandcastle runs a hook command: through a shell. */
const runCommand = promisify(exec)

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

  let home: string
  let restoreDataDir: () => void
  let repo: string
  let g: SimpleGit
  let workspace: string
  let excludeFile: string

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

    excludeFile = join(repo, '.git', 'info', 'exclude')
    mkdirSync(dirname(excludeFile), { recursive: true })
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
      await runCommand(command, { cwd: workspace })
    }
  }

  it('lands the PNG at the relative path the ticket context named', async () => {
    await runWorkspacePrep(contextNaming(NOTE))

    // Mounted mode: the agent works in this directory, so the context's
    // relative path resolves from here. (Isolated mode, below, is the clone.)
    expect(readFileSync(resolve(workspace, attachmentRelPath(NOTE)))).toEqual(Buffer.from(PNG))
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

    await clearAttachments(workspace, repo)

    expect(existsSync(join(workspace, ATTACHMENTS_DIR))).toBe(false)
    // Called again on a workspace sandcastle already removed: still no throw.
    rmSync(workspace, { recursive: true, force: true })
    await expect(clearAttachments(workspace, repo)).resolves.toBeUndefined()
  })

  // The exclude is load-bearing while the agent commits, but `info/exclude`
  // resolves against the COMMON git dir — a line left behind outlives the burn
  // worktree and hides the directory from the human's own `git status` in every
  // worktree, forever. So the run brackets it: added before the copy, removed
  // after, whichever way the run ended.
  for (const ending of ['returns', 'throws'] as const) {
    it(`puts info/exclude back exactly as it found it when the run ${ending}`, async () => {
      const before = '# the human`s own entries\r\nbuild/\r\nscratch.txt\n'
      writeFileSync(excludeFile, before)

      await runWorkspacePrep(contextNaming(NOTE))
      expect(readFileSync(excludeFile, 'utf8')).toContain(`${ATTACHMENTS_DIR}/`)

      try {
        if (ending === 'throws') throw new Error('the agent run died')
      } catch {
        // the burner's catch does the same cleanup its success path does
      } finally {
        await clearAttachments(workspace, repo)
      }

      // Byte-identical: the comment, the CRLF endings and the human's own
      // patterns all survive; only our one line is gone.
      expect(readFileSync(excludeFile, 'utf8')).toBe(before)
    })
  }

  it('tolerates the exclude line being absent — never added, or already taken out', async () => {
    const untouched = 'build/\n'
    writeFileSync(excludeFile, untouched)

    // A burn with no attachments never wrote the line; cleanup must still be a
    // no-op on the file rather than a failure or a rewrite.
    await clearAttachments(workspace, repo)
    await clearAttachments(workspace, repo)

    expect(readFileSync(excludeFile, 'utf8')).toBe(untouched)
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

/**
 * Isolated mode — the `burnWorkspace: 'auto'` default on Windows and macOS,
 * where the agent works in a container-native `git clone` of the mounted
 * workspace. The host-side copy lands the PNG in the workspace; a clone carries
 * tracked content only, so without a second copy the relative path the ticket
 * context names resolves to nothing (decisions.md #9).
 */
describe('burn attachments — riding the clone into isolated mode', () => {
  const branch = 'runcastle/ticket/wide-app/5-nNFSXHBi'

  it('copies the attachments into the clone, after the clone and only if they are there', () => {
    const cmd = buildIsolatedSetupCommand(branch, undefined)
    const src = `${SANDBOX_WORKSPACE_PATH}/${ATTACHMENTS_DIR}`

    expect(cmd).toContain(`[ -d "${src}" ]`)
    expect(cmd).toContain(`cp -r "${src}/." "${ISOLATED_REPO_PATH}/${ATTACHMENTS_DIR}/"`)
    expect(cmd.indexOf(src)).toBeGreaterThan(cmd.indexOf(`git clone ${SANDBOX_WORKSPACE_PATH}`))
  })

  // The script runs inside the burn container by construction, so it is `sh` —
  // driven here for real rather than matched as a string. A Windows host has no
  // sh to drive it with; the shape assertion above covers that host.
  describe.skipIf(process.platform === 'win32')('driven for real', () => {
    let home: string
    let restoreDataDir: () => void
    let workspace: string
    let clone: string

    /** The setup script with its two container paths pointed at real dirs. */
    function setupScript(): string {
      return buildIsolatedSetupCommand(branch, undefined)
        .replaceAll(SANDBOX_WORKSPACE_PATH, workspace)
        .replaceAll(ISOLATED_REPO_PATH, clone)
    }

    async function runSetup(): Promise<void> {
      // `git config --global` is a real write: keep it in the temp home.
      await runCommand(setupScript(), {
        cwd: workspace,
        env: { ...process.env, HOME: home, GIT_CONFIG_GLOBAL: join(home, 'gitconfig') },
      })
    }

    beforeEach(async () => {
      home = mkdtempSync(join(tmpdir(), 'rc-burn-isolated-home-'))
      restoreDataDir = useDataDir(home)
      mkdirSync(join(home, '.runcastle', 'annotations'), { recursive: true })
      writeFileSync(annotationPath(NOTE), PNG)

      workspace = mkdtempSync(join(tmpdir(), 'rc-burn-isolated-ws-'))
      clone = join(mkdtempSync(join(tmpdir(), 'rc-burn-isolated-clone-')), 'repo')
      const g = simpleGit(workspace)
      await g.init(['-b', branch])
      await g.addConfig('user.email', 'test@runcastle.dev')
      await g.addConfig('user.name', 'Runcastle Test')
      writeFileSync(join(workspace, 'README.md'), 'base\n')
      await g.add(['README.md'])
      await g.commit('initial commit')
    })

    afterEach(() => {
      restoreDataDir()
      for (const dir of [home, workspace, dirname(clone)]) {
        rmSync(dir, { recursive: true, force: true })
      }
    })

    /** What the host-side hook leaves behind before the sandbox starts. */
    async function prepareWorkspace(): Promise<void> {
      await excludePath(workspace, `${ATTACHMENTS_DIR}/`)
      for (const { command } of buildAttachmentCopyCommands(attachmentSources(contextNaming(NOTE)))) {
        await runCommand(command, { cwd: workspace })
      }
    }

    it('lands the PNG at the same relative path the ticket context named', async () => {
      await prepareWorkspace()

      await runSetup()

      // The agent is told to `cd` here and Read that exact relative path.
      expect(readFileSync(resolve(clone, attachmentRelPath(NOTE)))).toEqual(Buffer.from(PNG))
    })

    it('leaves the clone clean, so nothing the agent commits can push them back', async () => {
      await prepareWorkspace()

      await runSetup()

      // Isolated mode lands work by pushing the clone's commits to the
      // workspace, so the images must be unstageable in the clone too — its
      // `info/exclude` is not one the clone inherits.
      expect(await simpleGit(clone).raw(['status', '--porcelain'])).toBe('')
    })

    it('sets up a burn with no attachments at all, without failing', async () => {
      await runSetup()

      expect(existsSync(join(clone, ATTACHMENTS_DIR))).toBe(false)
      expect(existsSync(join(clone, 'README.md'))).toBe(true)
    })
  })
})
