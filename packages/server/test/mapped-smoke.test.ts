import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { sessionDir, worktreeDir } from '@runcastle/core/paths'
import { Hono } from 'hono'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { Project } from '@runcastle/core'
import type { AppCtx } from '../src/db/types'
import { converge, launchSession } from '../src/launcher/launcher'
import { clearRuntimeCtx, setRuntimeCtx } from '../src/launcher/runtime'
import mcpApp from '../src/mcp/server'
import hooksApp from '../src/routes/hooks'
import { createFeatureBranch } from '../src/services/git'
import { createCallerFactory } from '../src/trpc/context'
import { appRouter } from '../src/trpc/router'
import { makeTestCtx } from './helpers/db'
import { seedFeature, seedProject } from './helpers/fixtures'

/**
 * Issue #9 — mapped-path smoke coverage, at integration level. This exercises the
 * exact surfaces `scripts/smoke.ts`'s mapped section drives (the `/mcp` HTTP
 * endpoint + the tRPC caller + the `converge` launcher) end to end, WITHOUT a
 * real claude burn, so it runs in the normal suite and guards the smoke's flow:
 * escalate → emit two waypoints with a blocking edge → resolve both (watching the
 * second unblock) → G1 (`all-waypoints-terminal`) satisfiable → converge crosses it.
 */

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim()
}

function initRepo(dir: string): void {
  git(dir, 'init', '-b', 'main')
  git(dir, 'config', 'user.email', 'test@runcastle.dev')
  git(dir, 'config', 'user.name', 'Runcastle Test')
  git(dir, 'config', 'core.autocrlf', 'false')
  git(dir, 'commit', '--allow-empty', '-m', 'initial commit')
}

describe('mapped-path smoke (issue #9)', () => {
  let ctx: AppCtx
  let app: Hono
  let trpc: ReturnType<ReturnType<typeof createCallerFactory<typeof appRouter>>>
  let repoPath: string
  let project: Project
  const cleanup: string[] = []

  beforeEach(async () => {
    ctx = await makeTestCtx()
    repoPath = mkdtempSync(join(tmpdir(), 'runcastle-mapped-'))
    cleanup.push(repoPath)
    initRepo(repoPath)
    project = seedProject(ctx, repoPath)
    setRuntimeCtx(ctx) // the /mcp + /api/hooks sub-apps resolve their ctx from here
    app = new Hono()
    app.route('/mcp', mcpApp)
    app.route('/api/hooks', hooksApp)
    trpc = createCallerFactory(appRouter)(ctx)
  })

  afterEach(() => {
    clearRuntimeCtx()
    for (const d of cleanup) rmSync(d, { recursive: true, force: true })
    cleanup.length = 0
  })

  async function mcpTool(
    sessionId: string,
    name: string,
    args: Record<string, unknown>,
  ): Promise<{ isError: boolean; data: any }> {
    const res = await app.request('/mcp', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        'X-Runcastle-Session': sessionId,
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }),
    })
    const body = await res.json()
    const text = body.result?.content?.[0]?.text
    let data: any = text
    try {
      data = JSON.parse(text)
    } catch {
      /* leave as raw text */
    }
    return { isError: !!body.result?.isError, data }
  }

  it('escalate → blocking waypoints → resolution cascade → G1 satisfiable → converge', async () => {
    // (1) mapped-path feature + a live ideation session so MCP resolves by header.
    const slug = 'mapped-play'
    const feature = seedFeature(ctx, project.id, { slug, mapped: false })
    const featureId = feature.id
    await createFeatureBranch(project, slug)
    cleanup.push(worktreeDir(project.id, slug))
    const { sessionId } = await launchSession(ctx, { featureId, kind: 'ideation' }, { spawn: false })
    cleanup.push(sessionDir(sessionId))
    await app.request('/api/hooks/session-start', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        sessionId,
        payload: {
          session_id: 'cc-mapped-001',
          transcript_path: '/tmp/t.jsonl',
          hook_event_name: 'SessionStart',
          source: 'startup',
        },
      }),
    })

    // (2) escalate_to_map — flips mapped + scaffolds map.md.
    const esc = await mcpTool(sessionId, 'escalate_to_map', {
      destination: 'a fully mapped feature',
      notes: 'charted across several waypoints',
    })
    expect(esc.isError).toBe(false)
    expect(esc.data.ok).toBe(true)
    expect((await trpc.feature.get({ id: featureId })).feature.mapped).toBe(true)
    expect(existsSync(join(worktreeDir(project.id, slug), 'docs', 'features', slug, 'map.md'))).toBe(true)

    // (3) emit two waypoints with a blocking edge (wp2 blockedBy wp1).
    const emit = await mcpTool(sessionId, 'emit_waypoints', {
      waypoints: [
        { title: 'root question', type: 'grilling', question: 'what is the shape?', blockedBy: [] },
        { title: 'follow-up', type: 'grilling', question: 'given the shape, then what?', blockedBy: [1] },
      ],
    })
    expect(emit.isError).toBe(false)
    expect(emit.data.stored).toBe(2)
    const [wp1Id, wp2Id] = emit.data.ids as [string, string]

    // only wp1 is on the frontier — wp2 is blocked; G1 is not yet satisfiable.
    let full = await trpc.feature.get({ id: featureId })
    expect(full.frontierIds).toEqual([wp1Id])
    expect(full.gate.next?.id).toBe('G1')
    expect(full.gate.satisfied).toBe(false)

    // (4) resolve wp1 → the cascade emits waypoint.unblocked for wp2, freeing it.
    const r1 = await mcpTool(sessionId, 'resolve_waypoint', { id: wp1Id, disposition: 'resolved', summary: 'shape settled' })
    expect(r1.data.ok).toBe(true)
    const unblocked = (await trpc.events.list({ featureId, afterId: 0 })).find(
      (e) => e.type === 'waypoint.unblocked' && (e.data as { id?: string }).id === wp2Id,
    )
    expect(unblocked).toBeTruthy()
    full = await trpc.feature.get({ id: featureId })
    expect(full.frontierIds).toEqual([wp2Id]) // wp2 cascaded onto the frontier
    expect(full.gate.satisfied).toBe(false) // wp2 still open

    // (5) resolve wp2 → every waypoint terminal → G1 satisfiable, frontier empty.
    const r2 = await mcpTool(sessionId, 'resolve_waypoint', { id: wp2Id, disposition: 'resolved', summary: 'plan set' })
    expect(r2.data.ok).toBe(true)
    full = await trpc.feature.get({ id: featureId })
    expect(full.frontierIds).toEqual([])
    expect(full.gate.satisfied).toBe(true)

    // (6) converge crosses the satisfied G1 into spec.
    const conv = await converge(ctx, { featureId }, { spawn: false })
    cleanup.push(sessionDir(conv.sessionId))
    const shipped = await trpc.feature.get({ id: featureId })
    expect(shipped.feature.phase).toBe('spec')
    expect(shipped.sessions.find((s) => s.id === conv.sessionId)?.kind).toBe('converge')
  })
})
