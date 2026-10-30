import { describe, expect, it } from 'vitest'
import { transcriptBlocks } from '../src/lib/feature-ui/run'

/**
 * Decision #13(a–b). The burner's wire protocol was the agent's last words on
 * screen and tool lines spoke in container paths, neither of which means
 * anything to the human reading the lane.
 */
describe('transcript hygiene', () => {
  it('swallows the completion marker and reports it as UI instead', () => {
    const { blocks, completed } = transcriptBlocks([
      { kind: 'text', text: 'Committed the fix.\n\n' },
      { kind: 'text', text: '<promise>COMPLETE</promise>' },
    ])
    expect(completed).toBe(true)
    expect(blocks).toEqual([{ kind: 'text', text: 'Committed the fix.' }])
    expect(JSON.stringify(blocks)).not.toContain('promise')
  })

  it('drops a text block that was nothing but the marker, and reports nothing without one', () => {
    expect(transcriptBlocks([{ kind: 'text', text: '<promise>COMPLETE</promise>' }])).toEqual({
      blocks: [],
      completed: true,
    })
    expect(transcriptBlocks([{ kind: 'text', text: 'still going' }]).completed).toBe(false)
  })

  it('rewrites sandbox paths in a tool line without losing the prose around them', () => {
    const { blocks } = transcriptBlocks([
      {
        kind: 'tool',
        name: 'Edit',
        text: 'editing /home/agent/cache/slots/1/repo/src/App.tsx  and\n/home/agent/cache/slots/1/repo/test/app.test.ts',
      },
    ])
    expect(blocks).toEqual([
      { kind: 'tool', name: 'Edit', args: 'editing src/App.tsx and test/app.test.ts' },
    ])
  })

  it('merges the stream arbitrary text slices into one prose block', () => {
    const { blocks } = transcriptBlocks([
      { kind: 'text', text: 'I read the ' },
      { kind: 'text', text: 'spec first.' },
      { kind: 'tool', name: 'Read', text: 'docs/SPEC.md' },
    ])
    expect(blocks).toEqual([
      { kind: 'text', text: 'I read the spec first.' },
      { kind: 'tool', name: 'Read', args: 'docs/SPEC.md' },
    ])
  })
})
