import { describe, expect, it } from 'vitest'
import { toolsForAudience } from '../src/mcp/server'
import { chatKickoffHeader } from '../src/launcher/launcher'
import { makeTestCtx } from './helpers/db'
import { seedFeature, seedProject } from './helpers/fixtures'

describe('chat contract', () => {
  it('registers the settled union toolset', () => {
    expect(toolsForAudience('chat').sort()).toEqual([
      'cancel_ticket',
      'complete_phase',
      'create_feature',
      'emit_tickets',
      'emit_waypoints',
      'escalate_to_map',
      'get_feature_context',
      'list_tickets',
      'read_feature_doc',
      'record_event',
      'resolve_finding',
      'resolve_waypoint',
      'update_ticket',
    ])
  })

  it('briefs state, lap, tickets, run, and the full-context handoff', async () => {
    const ctx = await makeTestCtx()
    const feature = seedFeature(ctx, seedProject(ctx).id, { phase: 'review', lap: 3 })
    const line = chatKickoffHeader(ctx, feature)
    expect(line).toContain('Feature state: review')
    expect(line).toContain('lap 3')
    expect(line).toContain('tickets: none')
    expect(line).toContain('latest run: none')
    expect(line).toContain('Drive outcome: review; see the review evidence')
    expect(line.endsWith('Call get_feature_context for the full picture.')).toBe(true)
  })
})
