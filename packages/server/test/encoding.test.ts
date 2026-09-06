import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { Hono } from 'hono'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { Feature, Project } from '@runcastle/core'
import type { AppCtx } from '../src/db/types'
import { clearRuntimeCtx, setRuntimeCtx } from '../src/launcher/runtime'
import { createSessionRow } from '../src/launcher/sessions'
import mcpApp from '../src/mcp/server'
import hooksApp from '../src/routes/hooks'
import { listAfter } from '../src/services/events'
import { featureDocsDir } from '../src/services/feature-docs'
import { listDocs, readDoc } from '../src/services/knowledge'
import { makeTestCtx } from './helpers/db'
import { seedFeature, seedProject, tmpRepo } from './helpers/fixtures'

/**
 * Encoding regression (E2E mojibake finding). The full agent-visible path —
 * request BYTES over HTTP → MCP tool → sqlite → events service, and docs file
 * bytes on disk → title/content listing — must preserve non-ASCII text exactly:
 * em-dashes (the observed `â€"` victim), Arabic and CJK. Responses must also
 * DECLARE utf-8, because a bare `application/json` lets CP1252-defaulting HTTP
 * clients misdecode perfectly good UTF-8 bytes (the E2E's actual root cause —
 * the stored bytes were never corrupted).
 */

// em-dash + curly quotes + Arabic + CJK — every class the E2E flagged
const SPICY = 'decided — use “tRPC” — القرارات النهائية 最终决定'

describe('utf-8 integrity across the agent-facing surfaces', () => {
  let ctx: AppCtx
  let project: Project
  let feature: Feature
  let sessionId: string
  let app: Hono

  beforeEach(async () => {
    ctx = await makeTestCtx()
    project = seedProject(ctx, tmpRepo())
    feature = seedFeature(ctx, project.id, {
      slug: 'moji',
      title: 'Entry tags — وسوم',
      oneLiner: 'tag entries — 标签',
    })
    sessionId = createSessionRow(ctx, {
      featureId: feature.id,
      kind: 'ideation',
      worktreePath: project.repoPath,
    }).id
    setRuntimeCtx(ctx)
    app = new Hono()
    app.route('/mcp', mcpApp)
    app.route('/api/hooks', hooksApp)
  })

  afterEach(() => clearRuntimeCtx())

  /** POST raw UTF-8 BYTES (exactly what arrives on the wire) to /mcp. */
  async function mcpCall(name: string, args: Record<string, unknown>): Promise<Response> {
    const body = JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name, arguments: args },
    })
    return app.request('/mcp', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        'X-Runcastle-Session': sessionId,
      },
      body: new TextEncoder().encode(body),
    })
  }

  it('record_event round-trips an em-dash + Arabic + CJK message byte-exactly', async () => {
    const res = await mcpCall('record_event', { type: 'decisions.recorded', message: SPICY })
    expect(res.status).toBe(200)

    const stored = listAfter(ctx, feature.id, 0).find((e) => e.type === 'decisions.recorded')
    expect(stored?.message).toBe(SPICY)
    // byte-level: the stored string encodes to real UTF-8 (em-dash e2 80 94),
    // with no CP1252 mojibake (c3 a2 e2 82 ac = `â€`) and no U+FFFD (ef bf bd).
    const hex = Buffer.from(stored?.message ?? '', 'utf8').toString('hex')
    expect(hex).toContain('e28094')
    expect(hex).not.toContain('c3a2e282ac')
    expect(hex).not.toContain('efbfbd')
  })

  it('docs listing preserves a non-ASCII first-line title byte-exactly', () => {
    const title = 'Decisions — القرارات 最终'
    const dir = featureDocsDir(project, feature)
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'decisions.md'), `# ${title}\n\nbody — نص 内容\n`, 'utf8')

    const docs = listDocs(ctx, feature)
    expect(docs).toMatchObject([{ relPath: 'decisions.md', title }])
    expect(readDoc(ctx, feature, 'decisions.md').content).toContain('body — نص 内容')
  })

  it('MCP responses carry the message back as strictly valid UTF-8 and declare it', async () => {
    await mcpCall('record_event', { type: 'decisions.recorded', message: SPICY })
    const res = await mcpCall('get_feature_context', {})

    expect(res.headers.get('content-type')).toContain('charset=utf-8')
    // fatal decoder: throws on any byte sequence that is not valid UTF-8
    const text = new TextDecoder('utf-8', { fatal: true }).decode(await res.arrayBuffer())
    expect(text).toContain('Entry tags — وسوم')
  })

  it('hook responses carry the feature line (em-dash included) as declared UTF-8', async () => {
    const res = await app.request('/api/hooks/session-start', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: new TextEncoder().encode(
        JSON.stringify({ sessionId, payload: { hook_event_name: 'SessionStart' } }),
      ),
    })

    expect(res.headers.get('content-type')).toContain('charset=utf-8')
    const text = new TextDecoder('utf-8', { fatal: true }).decode(await res.arrayBuffer())
    const json = JSON.parse(text)
    expect(json.hookSpecificOutput.additionalContext).toContain(
      'Entry tags — وسوم — tag entries — 标签',
    )
  })
})
