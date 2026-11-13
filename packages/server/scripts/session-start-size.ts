/**
 * Measures what a feature lead and an orchestrator start with: the briefing
 * (system prompt), the entry skill they open first, and the tools runcastle
 * offers that session kind (name, description and input schema, as listed to
 * the model). Prints bytes and an estimate of tokens (bytes / 4).
 *
 *   bun packages/server/scripts/session-start-size.ts [--json]
 *
 * Run it on main before a prompt change and on the branch after
 * (skills-become-short-rules decision 11). Other reference pages are not counted:
 * an agent reads them only when it needs them.
 */
import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import type { Feature } from '@runcastle/core'
import {
  renderProjectPrompt,
  renderSystemPrompt,
  talkingToTheHumanSection,
} from '../src/launcher/artifacts'
import { buildMcpServer, type McpAudience } from '../src/mcp/server'

const ROOT = resolve(import.meta.dir, '../../..')
const SKILLS = join(ROOT, 'packages/skills/packs/runcastle/skills')

const feature: Feature = {
  id: 'feat_measure',
  projectId: 'proj_measure',
  slug: 'sample-feature',
  title: 'Sample feature',
  oneLiner: 'a feature to measure prompts with',
  branch: 'feature/sample-feature',
  status: 'active',
  createdAt: 0,
  upNext: false,
  chatId: null,
  stoppedAt: null,
  lastHumanMessageAt: null,
  lastDispatchAt: null,
}

/** The session prompt file is the kind's brief plus the shared closing section (`renderSessionPrompt`). */
function withClosing(brief: string): string {
  return `${brief.trimEnd()}\n\n${talkingToTheHumanSection()}`
}

async function toolsFor(audience: McpAudience): Promise<{ count: number; bytes: number }> {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  const client = new Client({ name: 'session-start-size', version: '1' })
  await Promise.all([buildMcpServer(audience).connect(serverTransport), client.connect(clientTransport)])
  const { tools } = await client.listTools()
  await client.close()
  const listed = tools.map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema }))
  return { count: tools.length, bytes: Buffer.byteLength(JSON.stringify(listed)) }
}

/** `pages` are paths under the skill pack's `skills/` folder. */
function skillBytes(pages: string[]): number {
  return pages.reduce((sum, p) => sum + Buffer.byteLength(readFileSync(join(SKILLS, p), 'utf8')), 0)
}

interface Row {
  session: string
  briefing: number
  skill: number
  tools: number
  toolCount: number
  total: number
  tokens: number
}

async function row(session: string, briefing: string, skill: string[], audience: McpAudience): Promise<Row> {
  const b = Buffer.byteLength(briefing)
  const s = skillBytes(skill)
  const t = await toolsFor(audience)
  const total = b + s + t.bytes
  return { session, briefing: b, skill: s, tools: t.bytes, toolCount: t.count, total, tokens: Math.round(total / 4) }
}

const rows: Row[] = [
  await row('feature lead', withClosing(renderSystemPrompt(feature, 'chat')), ['feature/SKILL.md'], 'chat'),
  // A headless planning run is sent to its planning page at once, so that page counts.
  await row(
    'feature lead, planning alone',
    withClosing(renderSystemPrompt(feature, 'chat', 'self-plan', undefined, true)),
    ['feature/SKILL.md', 'feature/references/planning-alone.md'],
    'chat',
  ),
  await row(
    'orchestrator',
    withClosing(
      renderProjectPrompt({
        project: { id: 'proj_measure', name: 'sample', repoPath: '/repo', position: 0 },
        branch: 'runcastle/project',
        worktreePath: '/wt/__project',
        base: 'main',
        openNotes: 0,
      }),
    ),
    ['project/SKILL.md'],
    'project',
  ),
]

if (process.argv.includes('--json')) {
  console.log(JSON.stringify(rows, null, 2))
} else {
  const head = ['session', 'briefing', 'skill', 'tools', 'total bytes', '~tokens']
  const lines = rows.map((r) => [
    r.session,
    String(r.briefing),
    String(r.skill),
    `${r.tools} (${r.toolCount})`,
    String(r.total),
    String(r.tokens),
  ])
  const widths = head.map((h, i) => Math.max(h.length, ...lines.map((l) => l[i]!.length)))
  const fmt = (cells: string[]) => cells.map((c, i) => (i === 0 ? c.padEnd(widths[i]!) : c.padStart(widths[i]!))).join('  ')
  console.log(fmt(head))
  for (const l of lines) console.log(fmt(l))
}
