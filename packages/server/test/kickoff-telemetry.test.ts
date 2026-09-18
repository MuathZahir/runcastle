import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { featureDocsRel, sessionDir, worktreeDir } from '@runcastle/core/paths'
import { simpleGit } from 'simple-git'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Feature } from '@runcastle/core'
import type { AppCtx } from '../src/db/types'
import { launchSession } from '../src/launcher/launcher'
import { KICKOFF_LINES, claudeRuntime } from '../src/launcher/runtimes/claude'
import type { PtyEntry } from '../src/pty/registry'
import { ptyRegistry } from '../src/pty/registry'
import { stopAllDocsWatch } from '../src/services/docs-watch'
import { listAfter } from '../src/services/events'
import { createFeatureBranch } from '../src/services/git'
import { useDataDir } from './helpers/data-dir'
import { makeTestCtx } from './helpers/db'
import { rmTemp, seedFeature, seedProject } from './helpers/fixtures'

/**
 * `session.kickoff` is the record that a CLI was handed its briefing, and the
 * briefing rides the argv of a process — so the event belongs to the spawn, not
 * to the argv-building that precedes it. It used to be emitted the moment the
 * launch spec was written, which claimed a delivery for the `spawn:false` smoke
 * driver (no process at all) and for a PTY that failed to start.
 */
describe('session.kickoff — emitted at spawn, never before one', () => {
  let ctx: AppCtx
  let projectId: string
  let repoPath: string
  let restoreDataDir: () => void
  const cleanup: string[] = []

  beforeEach(async () => {
    const home = mkdtempSync(join(tmpdir(), 'runcastle-kickoff-home-'))
    cleanup.push(home)
    restoreDataDir = useDataDir(home)

    ctx = await makeTestCtx()
    repoPath = mkdtempSync(join(tmpdir(), 'runcastle-kickoff-repo-'))
    cleanup.push(repoPath)
    const git = simpleGit(repoPath)
    await git.init(['-b', 'main'])
    await git.addConfig('user.email', 'test@runcastle.dev')
    await git.addConfig('user.name', 'Runcastle Test')
    await git.addConfig('core.autocrlf', 'false')
    await git.raw(['commit', '--allow-empty', '-m', 'initial commit'])
    projectId = seedProject(ctx, repoPath).id
  })

  afterEach(() => {
    vi.restoreAllMocks()
    stopAllDocsWatch()
    restoreDataDir()
    for (const dir of cleanup) rmTemp(dir)
    cleanup.length = 0
  })

  /** A feature with its docs committed on a real branch + talk worktree. */
  async function featureWithWorktree(slug: string): Promise<Feature> {
    const feature = seedFeature(ctx, projectId, { slug })
    const docsSegments = featureDocsRel(slug).split('/')
    mkdirSync(join(repoPath, ...docsSegments), { recursive: true })
    writeFileSync(join(repoPath, ...docsSegments, 'brief.md'), '# brief\n', 'utf8')
    const git = simpleGit(repoPath)
    await git.add('.')
    await git.commit(`scaffold docs for ${slug}`)
    await createFeatureBranch({ id: projectId, name: 't', repoPath }, slug, 'main')
    cleanup.push(worktreeDir(projectId, slug))
    return feature
  }

  /** Stub the readiness gate, and make the PTY either appear or refuse to. */
  function stubSpawn(outcome: 'spawns' | 'fails'): void {
    vi.spyOn(claudeRuntime, 'checkReady').mockReturnValue({ ok: true })
    const create = vi.spyOn(ptyRegistry(), 'create')
    if (outcome === 'fails') {
      create.mockImplementation(() => {
        throw new Error('no conpty here')
      })
    } else {
      create.mockReturnValue({ pty: { pid: 4512 } } as unknown as PtyEntry)
    }
  }

  function kickoffs(featureId: string): { data: Record<string, unknown> | null }[] {
    return listAfter(ctx, featureId, 0).filter((e) => e.type === 'session.kickoff')
  }

  it('records the briefing once the CLI has it', async () => {
    const feature = await featureWithWorktree('spawned')
    stubSpawn('spawns')

    const { sessionId } = await launchSession(ctx, { featureId: feature.id, kind: 'chat' })
    cleanup.push(sessionDir(sessionId))

    expect(kickoffs(feature.id)).toHaveLength(1)
    expect(kickoffs(feature.id)[0]?.data).toMatchObject({
      sessionId,
      kind: 'chat',
      line: KICKOFF_LINES.ideation,
      mechanism: 'argv',
    })
  })

  it('records nothing for a smoke launch, which spawns no CLI to brief', async () => {
    const feature = await featureWithWorktree('smoke')

    const { sessionId } = await launchSession(
      ctx,
      { featureId: feature.id, kind: 'chat' },
      { spawn: false },
    )
    cleanup.push(sessionDir(sessionId))

    const types = listAfter(ctx, feature.id, 0).map((e) => e.type)
    expect(types).toContain('session.launched')
    expect(kickoffs(feature.id)).toHaveLength(0)
  })

  it('records nothing when the terminal fails to spawn', async () => {
    const feature = await featureWithWorktree('stillborn')
    stubSpawn('fails')

    const { sessionId } = await launchSession(ctx, { featureId: feature.id, kind: 'chat' })
    cleanup.push(sessionDir(sessionId))

    const types = listAfter(ctx, feature.id, 0).map((e) => e.type)
    expect(types).toContain('session.spawn_failed')
    expect(kickoffs(feature.id)).toHaveLength(0)
  })
})
