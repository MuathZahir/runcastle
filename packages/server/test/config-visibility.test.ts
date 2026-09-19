import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Hono } from 'hono'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { ModelEntry, SettingField } from '@runcastle/core'
import type { AppCtx } from '../src/db/types'
import { clearRuntimeCtx, followConfigFile, setRuntimeCtx } from '../src/launcher/runtime'
import { createSessionRow, markSessionLive } from '../src/launcher/sessions'
import mcpApp from '../src/mcp/server'
import { createCallerFactory } from '../src/trpc/context'
import { appRouter } from '../src/trpc/router'
import { makeTestCtx } from './helpers/db'
import { rmTemp, seedFeature, seedProject, tmpRepo } from './helpers/fixtures'

/**
 * The roster an agent is offered has to be the roster the operator saved (the
 * `annotatedModels: []` report of 2026-09-11). Two surfaces disagree by
 * construction: the settings UI resolves every field from `config.json` on each
 * read, while `get_feature_context` reads the in-memory `ctx.config` the server
 * booted with — so a note the UI shows is not by itself proof that a session can
 * see it. Both directions are pinned here, over the real `/mcp` transport.
 */

/** The operator's roster from the report: one note per runtime. */
const ROSTER: ModelEntry[] = [
  { id: 'gpt-5.6-sol', runtime: 'codex', note: 'Backend and logic work. Non-UI/UX' },
  { id: 'claude-opus-5[1m]', runtime: 'claude-code', note: 'UI/UX work, any design-related work' },
]

/**
 * …as `annotatedModels` serves it: curated order, which is not the order the
 * roster was written in.
 */
const ANNOTATED = [
  { id: 'claude-opus-5[1m]', runtime: 'claude-code', note: 'UI/UX work, any design-related work' },
  { id: 'gpt-5.6-sol', runtime: 'codex', note: 'Backend and logic work. Non-UI/UX' },
]

describe('config visibility (roster notes reach the agent)', () => {
  let ctx: AppCtx
  let app: Hono
  let trpc: ReturnType<ReturnType<typeof createCallerFactory<typeof appRouter>>>
  let sessionId: string
  let dataDir: string
  let repoPath: string
  const previousDataDir = process.env.RUNCASTLE_DATA_DIR

  beforeEach(async () => {
    // A data dir of this test's own, so `configPath()` — which both the settings
    // service and `loadConfig` resolve lazily — is a file we can write.
    dataDir = mkdtempSync(join(tmpdir(), 'runcastle-config-'))
    process.env.RUNCASTLE_DATA_DIR = dataDir

    ctx = await makeTestCtx()
    repoPath = tmpRepo()
    const feature = seedFeature(ctx, seedProject(ctx, repoPath).id, {
      slug: 'roster-notes',
      phase: 'planning',
    })
    const session = createSessionRow(ctx, {
      featureId: feature.id,
      kind: 'chat',
      worktreePath: repoPath,
    })
    markSessionLive(ctx, session.id)
    sessionId = session.id

    setRuntimeCtx(ctx)
    app = new Hono()
    app.route('/mcp', mcpApp)
    trpc = createCallerFactory(appRouter)(ctx)
  })

  afterEach(() => {
    clearRuntimeCtx()
    if (previousDataDir === undefined) delete process.env.RUNCASTLE_DATA_DIR
    else process.env.RUNCASTLE_DATA_DIR = previousDataDir
    rmTemp(dataDir)
    rmTemp(repoPath)
  })

  /** `annotatedModels` as a session actually receives it: over `/mcp`. */
  async function annotatedModels(): Promise<unknown> {
    const res = await app.request('/mcp', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        'X-Runcastle-Session': sessionId,
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name: 'get_feature_context', arguments: {} },
      }),
    })
    const body = (await res.json()) as { result?: { content?: { text: string }[] } }
    const text = body.result?.content?.[0]?.text ?? '{}'
    return (JSON.parse(text) as { annotatedModels: unknown }).annotatedModels
  }

  /** The `models` field as the settings UI resolves it. */
  async function settingsRoster(): Promise<unknown> {
    const view = await trpc.settings.get()
    return view.fields.find((f: SettingField) => f.key === 'models')?.value
  }

  it('serves a roster written through settings, with no restart', async () => {
    expect(await annotatedModels()).toEqual([])

    await trpc.settings.update({ key: 'models', value: ROSTER })

    // The write-through half: the settings mutation refreshed the very `ctx`
    // the MCP sub-app resolves, so the next tool call carries the notes.
    expect(await annotatedModels()).toEqual(ANNOTATED)
  })

  it('serves a roster written to config.json outside this process, with no restart', async () => {
    followConfigFile(ctx)
    expect(await annotatedModels()).toEqual([])

    // Nobody's tRPC mutation: the file itself changes underneath the running
    // server (a hand-edited config, another build writing it). This is the half
    // the report hit — the settings surface reads the file and shows the notes…
    writeFileSync(join(dataDir, 'config.json'), `${JSON.stringify({ models: ROSTER }, null, 2)}\n`)
    expect(await settingsRoster()).toEqual(ROSTER)

    // …so the session must see them too, rather than the boot snapshot.
    expect(await annotatedModels()).toEqual(ANNOTATED)
  })
})
