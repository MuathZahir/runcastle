# Outcome — Session-assigned ticket models must be annotated

Validate session-assigned ticket models against the ANNOTATED roster, not the full roster. Today packages/server/src/services/tickets.ts:76 checks `model` against modelRoster(ctx.config), which merges CURATED_MODELS with the operator's roster, so any curated id passes even when the operator annotated none of them. The tickets skill (packages/skills/packs/runcastle/skills/tickets/SKILL.md §'Assigning a model') already promises that a model outside `annotatedModels` makes the store reject the batch; make that true. Scope: the MCP paths a session uses (emit_tickets and the session's update_ticket model field). Keep the human's UI edit path (tRPC) permissive: the human may pick any roster model. Share one helper with mcp/server.ts annotatedModels() so both read the same list. The error message must list the current annotated ids, or say none are annotated and model must be omitted, so the agent can correct itself in one step. Blank/'' still clears. Observed 2026-09-24: a resumed chat session for project-notes stamped tickets #12/#13 `claude-opus-5[1m]` from its 20 Sep memory of the roster, although get_feature_context was serving only `claude-opus-5-5[1m]`; the store accepted it because the id is curated. Regression tests in packages/server/test: emit with a curated-but-unannotated id is rejected with the annotated ids in the message; emit with an annotated id succeeds; the tRPC ticket edit still accepts any roster id.

- Shipped: 2026-09-24
- Laps run: 1

## What shipped

2 commits · 4 files

### Lap 1
- 1 tickets landed: #1 Validate session-assigned ticket models against the ANNOTATED roster,…
- 0 waived
- 0 failed

## Review record

### Lap 1 · review

- Reviewed commit: ffe740724f5acc76892791918b0eef40713cea00
- Landed since: 0
- Outcome: done

- **Gates pass: no verify commands configured; both review axes clean against the brief** — open
- **Annotated-model guard is opt-in per MCP call site, and the blank-clears rule now lives in two places** — open

## Notes record

- No human notes
