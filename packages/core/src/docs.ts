/**
 * Which feature docs an AGENT's context is built from — the one contract shared
 * by the two places that assemble a docs payload for a model: the MCP
 * `get_feature_context` tool (talk sessions) and the burner's docs digest
 * (sandboxed implementation + review agents).
 *
 * It exists because those two grew the same bug independently. Each globbed
 * `docs/features/<slug>/*.md` and inlined every match in full, so both shipped
 * whatever happened to be in the directory. On this repo's own dogfooding data
 * that meant a lap-2 session or coder received `outcome.md` (52 KB) and
 * `test-notes.md` (27 KB) — the previous lap's human-facing postmortem and its
 * already-triaged bug notes — as the bulk of its opening context.
 *
 * The rule is an ALLOWLIST rather than a denylist, and that is safe only because
 * of the second half of the contract: the docs a payload does not inline it must
 * still LIST, so the agent can read any of them on demand (`read_feature_doc`
 * over MCP, an ordinary file read in a checkout). Nothing becomes unreachable —
 * only the automatic, unbounded inlining is capped. A denylist would have to
 * predict every large doc a future session invents; an allowlist plus an index
 * does not.
 *
 * NOT to be confused with `listDocs` in the server's knowledge service, which
 * backs the web UI's document list and must keep returning EVERYTHING — a human
 * browsing a feature wants its outcome and test notes most of all.
 */

/**
 * The canonical feature docs, in the order an agent should meet them. These are
 * the four the pipeline itself scaffolds and writes (`scaffoldDocs`,
 * `scaffoldMapDoc`), and between them they carry a feature's whole intent:
 * what it is, where it is going, what was decided, and what to build.
 */
export const AGENT_DIGEST_DOCS = ['brief.md', 'map.md', 'decisions.md', 'spec.md'] as const

export type AgentDigestDoc = (typeof AGENT_DIGEST_DOCS)[number]

/**
 * Docs deliberately left out of an agent digest, with the reason — kept as data
 * so the payload builders can TELL the agent what exists and was withheld
 * rather than silently dropping it.
 *
 * All three are records of work already finished. They are written FOR humans
 * (and for the project session's later portfolio lookups), they are the largest
 * files a mature feature accumulates, and re-reading them is how an agent talks
 * itself into redoing or second-guessing work that already landed.
 */
export const WITHHELD_FEATURE_DOCS: Readonly<Record<string, string>> = {
  'outcome.md': 'the previous run’s outcome report — human-facing, and the burner digests it is built from are already on their tickets',
  'test-notes.md': 'test-drive notes already triaged into this lap’s tickets',
  'findings.md': 'a finished findings report; read it only if a ticket points at it',
}

/**
 * True when `relPath` is one of the canonical docs an agent digest inlines.
 * Compared case-insensitively against the bare filename, so it is safe to call
 * with either a bare name (`spec.md`) or a path relative to the docs dir; a doc
 * in a SUBDIRECTORY (`research/3-auth.md`) is never canonical — those are
 * indexed and read on demand.
 */
export function isAgentDigestDoc(relPath: string): boolean {
  if (relPath.includes('/') || relPath.includes('\\')) return false
  const name = relPath.toLowerCase()
  return (AGENT_DIGEST_DOCS as readonly string[]).includes(name)
}

/**
 * Sort key putting the canonical docs in {@link AGENT_DIGEST_DOCS} order and
 * everything else after them alphabetically — so a rendered digest always reads
 * brief → map → decisions → spec regardless of how the filesystem enumerated it.
 */
export function agentDigestDocOrder(relPath: string): number {
  const i = (AGENT_DIGEST_DOCS as readonly string[]).indexOf(relPath.toLowerCase())
  return i === -1 ? AGENT_DIGEST_DOCS.length : i
}
