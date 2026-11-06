## Purpose

Quick-win cut from the token analysis (2026-11-06). Every byte a tool returns stays in context for every later call, and every tool description and skill body rides in every call. These are mostly small server and copy changes with no behaviour change.

## Findings (evidence; savings over two weeks)

- **`get_feature_context` resends full docs** (~12M, up to 17M): 146 calls, 63 repeats in the same session; brief + decisions are ~66% of each reply. `feature/SKILL.md` (~:16) says "call it first, and again whenever you are unsure", and the SessionStart hook text (`routes/hooks.ts` ~520–543) repeats it. Direction: per session, remember which doc hashes were sent and return `{relPath, sha, unchanged: true}` on repeats; reset on a compact/clear SessionStart (`handleSessionStart`, `routes/hooks.ts` ~160). For the orchestrator (`projectReads` branch, `mcp/server.ts` ~3425) return a short status view, not the lead's working bundle (~4M).
- **Updates echo whole objects** (~8M): `toolUpdateTicket` (`server.ts` ~952/960), `toolCancelTicket` (~963/969) and `toolResolveFinding` (~1209) return the full row. Return `{ok, seq, status, changed}`.
- **`resolve_finding` fails 27% of the time** (27/99, 13 sessions) on findings that already closed themselves when their fix ticket landed. Return the current status instead of an error.
- **`get_ticket` returns everything** (~4–6M): add a `fields` option or drop context/criteria on done tickets (`toolGetTicket`, `server.ts` ~845).
- **`read_feature_chat` returns the same last 8k each time** (~4–5M): 59 of 124 were repeats. Return only turns since the last read in this session (`mcp/orchestrator-run-tools.ts` ~76).
- **`get_project_context`**: return the charter as unchanged on repeats; `baseBranches` and long project fields only on request (~1.5M).
- **Tool descriptions are essays** (~10–14M): chat kind 22 tools / 5.5k tokens, project 28 / 6.3k. Worst: `get_feature_context` description 2.8k chars (`server.ts` ~3402–3440), `start_design_server`, `show_design`, `wait_for_you`'s `kind` schema, `create_feature`, `review_drive`. Cut each to 1–2 sentences; the skills teach the rest.
- **The project skill is 46.7k chars** (~11.7k tokens per orchestrator call, ~16M): move intake, routing, curation, charter, sweeps and notes detail into references read on demand, and drop "Your tools" (repeats the tool descriptions). Roughly halves it.
- **Feature-skill references**: each chat loads ~64k chars of references, mostly up front, often by `cat`-ing several at once so the output overflows to a file that is then read whole (9 times, 15.5M). `preview-starter.html` (15k chars) was read 80 times in 34 chats and then copied anyway — say "copy it, don't read it" or have a tool fill it. Trim `tickets.md` (17k) and `design.md` (10k). Say "read only the reference for the step you're on".
- **Runcastle tools loaded piecemeal**: 143 tool-search calls in feature chats, often one runcastle tool at a time late in the chat. Load them in one call.
- A resumed chat re-invokes the entry skill every time (`runcastle:feature` loaded 71 times in 41 chats).

## Must not swallow

- Compaction and the lead delegating work → `lead-chats-stay-small`.
- The wake rule and news lines → `agents-are-woken-only-when-it-matters`.
- Burn prompts → `cheaper-burns`.
- User-level skills: they stay (the human's decision — keeping them lean is the user's job).

## Working agreement (cut 2, agreed 2026-11-06): autonomous

The orchestrator carries this to merged on its own judgement, after the lead's review round.
