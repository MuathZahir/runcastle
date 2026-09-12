# Outcome — Tickets agent sees empty annotatedModels despite a saved roster

Bug (observed ~2026-09-11 in the runcastle project itself): while a tickets-phase session was emitting tickets, the agent reported 'annotatedModels is empty so I won't set models' — but the operator's roster has two models with use-case notes, verified on disk in ~/.runcastle/config.json: gpt-5.6-sol (codex, 'Backend and logic work. Non-UI/UX') and claude-opus-5[1m] (claude-code, 'UI/UX work, any design-related work'), and the settings ROSTER UI shows both notes. Diagnose why get_feature_context served annotatedModels: []. What is already verified against source, so don't re-derive it from scratch: (1) the only producer is annotatedModels(ctx) at packages/server/src/mcp/server.ts:225-229, filtering modelRoster(ctx.config) on m.note?.trim(); (2) modelRoster (packages/core/src/config.ts:527) merges CURATED_MODELS with config.models by id and the ModelEntry zod schema keeps note (config.ts:68), so a boot-time loadConfig preserves notes; (3) the settings write-through for the models key (packages/server/src/services/settings.ts:100-106, generic path at ~512-514) refreshes ctx.config in place, and the MCP sub-app shares the boot AppCtx via setRuntimeCtx (packages/server/src/launcher/runtime.ts) — so on current source the notes SHOULD be visible. Prime suspects to check, in order: (a) the lazy-fallback ctx in getRuntimeCtx — if any MCP/hook request can arrive before boot injection, it caches its own loadConfig() snapshot and later setRuntimeCtx ordering, or a second AppCtx object anywhere (tRPC createContext vs runtime ctx), would make settings mutations invisible to MCP; verify index.ts wiring passes ONE object to both; (b) staleness across restart/version skew — the running installed server may predate the in-place refresh, meaning notes saved mid-session were invisible until restart; if you can show current source cannot reproduce, say so in the digest and treat the fix as regression-proofing; (c) any code path serving a cached FeatureContext computed at session launch instead of calling featureContext live. Fix whatever the diagnosis finds. Regression tests in packages/server/test: (1) after a settings write of the models roster (with notes) on a running app, a subsequent get_feature_context via the MCP path returns those entries in annotatedModels — asserting tRPC-written config is visible to the MCP ctx without restart; (2) mcp-tools.test.ts already asserts the empty case at :207 and a populated case at :220 — extend rather than duplicate.

- Shipped: 2026-09-12
- Laps run: 1

## What shipped

3 commits · 5 files

### Lap 1
- 1 tickets landed: #1 Bug (observed ~2026-09-11 in the runcastle project itself): while a…
- 0 waived
- 0 failed

## Review record

### Lap 1 · review

- Reviewed commit: 51111207d80000ba4a87985459eb45cb4408ca78
- Landed since: 0
- Outcome: done

- No findings

## Notes record

- No human notes
