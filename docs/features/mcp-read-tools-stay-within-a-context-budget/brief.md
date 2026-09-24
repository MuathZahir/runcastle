## Why this exists

runcastle's MCP read tools grew into whole-state dumps, and they have crossed Claude Code's MCP output limit (about 25K tokens). Past that limit a result does not enter the agent's context at all: Claude Code saves it to a file and shows the agent only a pointer. The agent must then choose to go read the file, and in practice it often doesn't. So an oversized result is not only expensive; it is **hidden**. The human's rule: no tool should be able to fill a model's context window.

Measured on 2026-09-24:

- `get_feature_context` for `project-notes-jot-it-anywhere-triage-it-in-the-project-chat` (lap 2): **84K chars**. `tickets` 46K (all 14 tickets inlined in full, with burner digests); `docs` 34K (3 feature docs inlined whole); everything else is small.
- `get_project_context` for runcastle: **78K chars**. `featureIndex` 63K (105 features at about 600 chars each; each line carries a long first paragraph of the brief); charter 10K; the rest small.

Both grow with every lap and every feature, so the overflow gets worse over time without anyone noticing.

## The incident that surfaced it

On 2026-09-24 the project-notes lap-2 chat (a resumed conversation) called get_feature_context twice. Both results overflowed to files. Both files contain the correct `annotatedModels: [claude-opus-5-5[1m]]`, but the agent never read that field. It stamped tickets #12/#13 with `claude-opus-5[1m]` from its memory of the 20 Sep lap-1 call, and told the human that was "the roster". The earlier shipped bug `tickets-agent-sees-empty-annotatedmodels-despite-a-saved-roster` (agent reported annotatedModels empty) is very likely the same failure: the fix there assumed a stale server config, which was real, but an agent that never opens the overflow file sees no list either. Small, decision-critical fields (annotatedModels, burnConcurrency, phase, lap) sit at the tail of an 80K payload, which is the worst place for them.

## What this feature is for

One pattern applied to both tools:

- **Summary first.** Each tool returns a compact summary with small, decision-critical fields first: feature phase/lap/gates, annotatedModels, config knobs, ticket titles + status + seq, doc paths and sizes, a short feature-index line per feature.
- **Drill-down on demand.** Details come from fetch-one reads: one ticket in full (goal, context, AC, digest), one doc's body, one feature's full index entry. Docs on disk are already readable with Read, so the summary may just point at paths. Decide per surface whether that is enough or a tool is needed (a run agent without the worktree may need one).
- **A budget enforced by tests.** A test fixture sized like a real long-lived project (100+ features, a multi-lap feature with 15+ tickets and long digests) asserts each read tool's result stays under a stated limit. The limit should be well below the 25K-token spill threshold, since agents also need room to work.
- **Skills follow.** Update the skills and prompts that tell agents to read get_feature_context/get_project_context (ideate, tickets, lap planning, project, burner prompt if it uses them) so they know the summary shape and the fetch-one tools. Nothing more than that.

Also measure `get_work_record` (featureSlug and seam forms) against the same fixture. If it can overflow, bring it into scope with the same pattern. If not, record that it was checked.

## Design questions for this feature's own session

- What exactly belongs in each summary, and in what order.
- The feature-index line format: title + status + one short sentence? Paging or filtering by status (in flight vs shipped)?
- Which fetch-one tools to add, their names, and which session kinds see them (the server filters tools per session kind).
- Whether the budget is chars or estimated tokens, and what the number is.
- Whether a lap-planning session still needs the previous lap's digests inline, or fetches them per ticket.

A first lap that fixes only `get_feature_context` is acceptable if the whole thing is too big. That is the tool that caused the incident.

## What this must NOT swallow

- The ticket-store model validation. That is its own quick change, `session-assigned-ticket-models-must-be-annotated`: session-assigned models get checked against the annotated roster. Don't duplicate it here.
- Skill rewrites beyond pointing at the new summary and fetch-one tools.
- Anything about how Claude Code handles oversized MCP output. This feature fixes our own payloads.

## Sequencing

`project-notes-jot-it-anywhere-triage-it-in-the-project-chat` is still being built and adds project-session MCP tools in `packages/server/src/mcp/server.ts`. Let it land first, so this feature is the one that takes any conflicts in that file.
