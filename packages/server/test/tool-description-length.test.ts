import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { describe, expect, it } from 'vitest'
import { SessionKind } from '@runcastle/core'
import { buildMcpServer, type McpAudience } from '../src/mcp/server'

/** Per-description caps: a tool says what it does in a sentence or two; a parameter, a phrase. */
const TOOL_CAP = 400
const PARAM_CAP = 120

const AUDIENCES: McpAudience[] = [...SessionKind.options, 'run']

type Schema = {
  description?: string
  properties?: Record<string, Schema>
  items?: Schema
  anyOf?: Schema[]
  oneOf?: Schema[]
  allOf?: Schema[]
}

function walk(schema: Schema | undefined, path: string, out: { path: string; text: string }[]): void {
  if (!schema || typeof schema !== 'object') return
  if (schema.description) out.push({ path, text: schema.description })
  for (const [k, v] of Object.entries(schema.properties ?? {})) walk(v, `${path}.${k}`, out)
  if (schema.items) walk(schema.items, `${path}[]`, out)
  for (const branch of [schema.anyOf, schema.oneOf, schema.allOf]) {
    branch?.forEach((b, i) => walk(b, `${path}|${i}`, out))
  }
}

async function listFor(audience: McpAudience) {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  const client = new Client({ name: 'length-test', version: '1' })
  await Promise.all([buildMcpServer(audience).connect(serverTransport), client.connect(clientTransport)])
  const { tools } = await client.listTools()
  await client.close()
  return tools
}

describe('tool description length', () => {
  it.each(AUDIENCES)('keeps every description short for %s', async (audience) => {
    const tools = await listFor(audience)
    const tooLong: string[] = []
    for (const tool of tools) {
      const desc = tool.description ?? ''
      if (desc.length > TOOL_CAP) tooLong.push(`${tool.name}: ${desc.length} > ${TOOL_CAP}`)
      const params: { path: string; text: string }[] = []
      walk(tool.inputSchema as Schema, tool.name, params)
      for (const p of params) {
        if (p.text.length > PARAM_CAP) tooLong.push(`${p.path}: ${p.text.length} > ${PARAM_CAP}`)
      }
    }
    expect(tooLong).toEqual([])
  })

  it('tells the orchestrator its feature read is a status view, not the lead’s repeat-call stubs', async () => {
    const tool = (await listFor('project')).find((t) => t.name === 'get_feature_context')
    expect(tool?.description).toMatch(/status view/)
    expect(tool?.description).not.toMatch(/repeat call/i)
  })
})
