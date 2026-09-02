## Why this feature exists

Part of the 2026-08-28 decision to redesign the runcastle web app **one flow at a time** on top of `web-ui-foundation-tailwind-tokens-primitives-and-carving-feature-ui`. This is flow 5 of 7. The human singled it out: "the settings panel is dreadful, looks very bad, difficult to find what I need, a lot of useless text". This is an **information-architecture** problem first and a styling problem second — the ideation session should treat it that way.

## The flow, as it exists

- `apps/web/src/components/SettingsOverlay.tsx` (602 lines) — a peek-style overlay, autosaving with no Save button (a banner at the top explains the commit-on-blur model). Sections: **Global** (server port, default model, sandbox, sandbox image, MCP servers in sessions, burn concurrency/iterations/attempts, conflict resolver passes, …), **Advanced — per-step models** (collapsed), **This project** (overrides, prep findings), **AFK burns** (`EnableAfkCard.tsx`, 463 lines: container-runtime re-check, one-click sandcastle image build with a streamed log, per-runtime credential rows, burn-cache row).
- `apps/web/src/lib/settings.ts` (657 lines) — the field definitions/derivations.
- Server: `packages/core/src/config.ts` (schema + defaults), the settings router, env-var overrides ("Set by RUNCASTLE_SERVER_PORT").
- Entry points: titlebar/palette "Settings"; the stale-image error from `stale-sandbox-image-detect-it-fail-fast-and-offer-a-rebuild` points users at "Settings → AFK burns (Rebuild image)".

## Known issues going in

- Every field carries a paragraph of help text inline (see the human's screenshot) — the "useless text". Decide what is help-on-demand vs always visible.
- Prior audit F17.7 / F25.4 (`docs/features/identify-random-issues-throughout-the-system/findings.md`): literal `burnMaxIterations`-style labels mixed with humanised ones, raw option values, unlabeled per-project fields (empty a11y tree), silent saves with no saved/failed distinction.
- Config semantics already decided and to be *reflected*, not re-decided: `project-model-overrides-global-step-models` (project model beats global per-step), `burn-concurrency-default-by-core-count` (effective default shown per machine), `codex-burns-on-the-chatgpt-subscription` ("Codex ready" = logged in), charter decision 4 (`sessionMcp` inherit vs runcastleOnly).
- Restart-required fields (server port) vs live ones need a visible distinction that isn't a badge nobody reads.

## How the ideation session must work (human's instruction, applies to every flow feature)

1. Walk the whole flow with agent-browser: every section, every field, the image build stream, credential rows, per-project overrides, env-var-locked fields, error states. Every button and dead end.
2. Present the complete flow map (and the full field inventory, grouped) to the human and get it confirmed before designing.
3. Redesign: propose the IA (tabs/pages/search?), what is global vs project, what is advanced; then the visual on the foundation's primitives (the foundation ships a form-field primitive — use it).
4. Code quality is in scope for this flow's files — `SettingsOverlay.tsx`, `EnableAfkCard.tsx`, `lib/settings.ts` are all oversized.
5. Migration rule: move this surface's rules out of `styles.css` into Tailwind and delete the old rules.

## What it must NOT swallow

- Config *semantics* or new settings — no new options, no changed defaults; if one is wrong, record it as a finding for its own feature.
- Preparation findings' behaviour (preparation flow) — only their placement here.
- The server's config loading beyond bugs found in this path.
