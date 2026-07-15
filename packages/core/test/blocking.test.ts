import { describe, expect, it } from 'vitest'
import { BlockingEdgeError, resolveBatchBlocking } from '../src/blocking'

const edges = (...blockedBy: number[][]) => blockedBy.map((b) => ({ blockedBy: b }))

describe('resolveBatchBlocking', () => {
  it('assigns sequential seqs starting at startSeq', () => {
    const out = resolveBatchBlocking(edges([], [], []), { startSeq: 1 })
    expect(out.map((n) => n.seq)).toEqual([1, 2, 3])
  })

  it('offsets seqs by startSeq when the feature already has tickets', () => {
    const out = resolveBatchBlocking(edges([], []), { startSeq: 3 })
    expect(out.map((n) => n.seq)).toEqual([3, 4])
  })

  it('resolves batch-local positions to assigned global seqs', () => {
    // fresh: positions == global seq
    const fresh = resolveBatchBlocking(edges([], [1], [1, 2]), { startSeq: 1 })
    expect(fresh[1].blockedBy).toEqual([1])
    expect(fresh[2].blockedBy).toEqual([1, 2])

    // offset: position 1 -> global seq 3
    const offset = resolveBatchBlocking(edges([], [1]), { startSeq: 3 })
    expect(offset[1].blockedBy).toEqual([3])
  })

  it('returns [] for an empty batch', () => {
    expect(resolveBatchBlocking([], { startSeq: 1 })).toEqual([])
  })

  it('throws on an out-of-range position', () => {
    expect(() => resolveBatchBlocking(edges([], [5]), { startSeq: 1 })).toThrow(BlockingEdgeError)
  })

  it('throws on a non-integer position', () => {
    expect(() => resolveBatchBlocking(edges([1.5]), { startSeq: 1 })).toThrow(BlockingEdgeError)
  })

  it('rejects a self-referencing position loudly', () => {
    expect(() => resolveBatchBlocking(edges([1]), { startSeq: 1 })).toThrow(BlockingEdgeError)
  })

  it('names the node with the given label in rejection messages', () => {
    expect(() => resolveBatchBlocking(edges([1]), { startSeq: 1, label: 'waypoint' })).toThrow(
      /waypoint 1 cannot block on itself/,
    )
  })

  it('rejects a two-node dependency cycle loudly', () => {
    // node 1 blocks on node 2, node 2 blocks on node 1
    expect(() => resolveBatchBlocking(edges([2], [1]), { startSeq: 1 })).toThrow(/cycle/)
  })

  it('rejects a longer dependency cycle (a→b→c→a)', () => {
    expect(() => resolveBatchBlocking(edges([2], [3], [1]), { startSeq: 1 })).toThrow(
      BlockingEdgeError,
    )
  })

  it('accepts a diamond (shared dependency, no cycle)', () => {
    // 1←2, 1←3, 2←4, 3←4 : acyclic DAG
    const out = resolveBatchBlocking(edges([], [1], [1], [2, 3]), { startSeq: 1 })
    expect(out.map((n) => n.seq)).toEqual([1, 2, 3, 4])
  })
})
