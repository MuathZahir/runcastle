/**
 * Batch blocking-edge resolution — pure, IO-free (SPEC §1).
 *
 * An ideation session emits a batch of nodes (tickets, and — post ADR-0001 —
 * waypoints) in one shot. Each node's `blockedBy` is a list of **1-based
 * positions within that batch**. This utility assigns each node a global `seq`
 * (continuing after any nodes the feature already has, via `startSeq`) and
 * resolves every batch-local position to the referenced node's assigned global
 * `seq`. Out-of-range, non-integer, and self-referencing (a degenerate cycle)
 * edges are rejected loudly with `BlockingEdgeError`.
 *
 * NOTE: SPEC §3 phrases this as "seq→id"; the pinned core schema types
 * `blockedBy` as `number[]`, so we resolve to global seq (not id). Recorded in
 * docs/research/CORRECTIONS.md.
 */

/** A batch node carrying only the input blocking edges this utility needs. */
export interface BatchBlockingEdges {
  /** 1-based positions of other nodes in the SAME batch this node depends on. */
  blockedBy: number[]
}

/** A node after seq assignment + edge resolution. */
export interface ResolvedBlockingEdges {
  /** Global seq assigned to this node. */
  seq: number
  /** `blockedBy` positions resolved to the referenced nodes' global seqs. */
  blockedBy: number[]
}

export interface ResolveBatchBlockingOptions {
  /** First global seq to assign; node i gets `startSeq + i`. */
  startSeq: number
  /** Noun used in rejection messages (default `'ticket'`). */
  label?: string
}

/** A batch blocking edge is out of range, non-integer, or self-referencing. */
export class BlockingEdgeError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'BlockingEdgeError'
  }
}

/**
 * Assign global seqs and resolve in-batch `blockedBy` positions to global seqs.
 * Throws `BlockingEdgeError` on an invalid or self-referencing position.
 */
export function resolveBatchBlocking(
  nodes: readonly BatchBlockingEdges[],
  { startSeq, label = 'ticket' }: ResolveBatchBlockingOptions,
): ResolvedBlockingEdges[] {
  const n = nodes.length

  nodes.forEach((node, i) => {
    for (const pos of node.blockedBy) {
      if (!Number.isInteger(pos) || pos < 1 || pos > n) {
        throw new BlockingEdgeError(
          `${label} ${i + 1} blockedBy references invalid batch position ${pos} (batch has ${n} ${label}(s), positions 1..${n})`,
        )
      }
      if (pos === i + 1) {
        throw new BlockingEdgeError(`${label} ${i + 1} cannot block on itself`)
      }
    }
  })

  return nodes.map((node, i) => ({
    seq: startSeq + i,
    // batch position -> assigned global seq
    blockedBy: node.blockedBy.map((pos) => startSeq + (pos - 1)),
  }))
}
