# Model roster discovers new models

## Problem

When Anthropic or OpenAI ship a model, runcastle doesn't offer it. The roster every chooser shows is a hard-coded curated list with the operator's own entries merged over it. So a new model reaches the chooser only through a runcastle release or the operator typing it into Settings → Models. Today the ChatGPT backend already serves GPT-6 Astra, Sol and Luna to the Codex CLI on this machine, and runcastle lists none of them. The operator has also had to hand-type `claude-opus-5-5[1m]` to use it.

## Approach

**From the operator's side:** when runcastle starts, it asks the logins it already uses which models they offer, and it adds what they report to the roster. A newly shipped model shows up in Settings → Models with a **new** badge and appears in every model dropdown under its runtime, ready to pick. A **Refresh** button re-asks on demand. Each source has a status line (for example "Claude: 7 models · 2h ago" or "Codex: no cache found — log in to Codex"). A model that providers stop offering disappears if nothing uses it. If it's still annotated, the default, or used by a step, it stays and is flagged **no longer offered**. Codex retirement notices ("retires 2026-10-14 → gpt-5.6-sol") appear on the row. Discovery never changes the default model, any per-step model, or any note. Promoting a model is always the operator's click.

**Shape:**

1. **Two discovery sources (decision 1)**, run by a new server-side discovery service, each failing independently:
   - **Claude:** the Claude Agent SDK (`@anthropic-ai/claude-agent-sdk`, a new server dependency). Open a query pointed at the host's own `claude` executable (`pathToClaudeCodeExecutable`, resolved through the same `resolveBinary` the runtimes use, read-only). Read `initializationResult().models` (equivalently `supportedModels()`) and close it **without sending a prompt**. Each `ModelInfo` becomes an entry with id `resolvedModel ?? value`, never a bare alias, runtime `claude-code`, and `displayName` / `description` carried over. The SDK's `ModelInfo`, from the docs pulled during ideation:
     ```ts
     type ModelInfo = { value: string; resolvedModel?: string; displayName: string; description: string;
       supportsEffort?: boolean; supportedEffortLevels?: (...)[]; supportsAdaptiveThinking?: boolean;
       supportsFastMode?: boolean; supportsAutoMode?: boolean }
     ```
   - **Codex:** read `~/.codex/models_cache.json` (fields `fetched_at`, `client_version`, `models[]`). Keep only `visibility: "list"` entries. Each becomes an entry with id `slug`, runtime `codex`, `display_name` / `description`, and, when `upgrade` is non-null, a retirement hint from `upgrade.retirement_at` and `upgrade.model`. Order follows `priority`.
   - A source that fails keeps its last good result and records why: SDK can't start or not logged in, cache file missing or unparseable.

2. **Discovery cache.** Results persist in their own file under the runcastle data dir, separate from `config.models` (decision 2). For each source it holds the status (ok or failed plus reason), when it last succeeded, the discovered entries, and the id set from the run before. That previous set drives the **new** badge: an id is new when it's in the latest successful run of its source and was absent from that source's previous run. It stays new until a later run changes the set. Discovery never writes the operator's config.

3. **Cadence (decision 3).** At server boot, discovery runs in the background without delaying startup. Until it finishes, the cached result (or nothing, on first run) serves the roster. A tRPC mutation on the settings router re-runs both sources for the Refresh button. No timer. When the discovered set or a source's status changes, the service emits an event, and the web maps it to invalidating the settings view so open choosers pick it up immediately.

4. **One merged roster (decisions 2 and 5).** Core's `modelRoster` becomes `curated → discovered → operator`, merged by id, last layer wins. A discovered entry's display metadata replaces a curated entry's for the same id. An operator entry always wins, so notes and declared runtimes survive. Core stays IO-free: the discovered layer is an *input* to the roster functions, not something they read. Make it part of the roster input shape, so every call site has to supply it and can't silently forget it. On the server, **every** roster consumer uses the same merged roster: the MCP `annotatedModels` (still annotated-only, since discovery never adds a note), `emit_tickets` / `update_ticket` model validation, and `resolveModelEntry`'s runtime lookup in the launcher, burner and research workflow. The settings view served to the web carries the discovered layer and per-source status, and the web's `rosterFromView` merges it instead of starting from `CURATED_MODELS` alone.

5. **Settings → Models (decision 4).**
   - The model dropdowns list the full merged roster, grouped by runtime as today.
   - The roster table's "worth showing" rule gains one case: a **new** discovered model is visible by default. Untouched discovered models otherwise collapse behind "show all" like untouched curated ones, and the "show all" count covers both.
   - A row whose id is referenced (annotated, default, or used by a step) but is no longer in its source's latest successful discovery shows **no longer offered by Claude/Codex**. This applies only to a source whose latest run succeeded: a failed source flags nothing.
   - A row with a retirement hint shows it.
   - The page shows the Refresh button and one status line per source.

6. **Roles (decision 7).** Discovery writes nothing to `model`, `stepModels`, or `RUNTIME_DEFAULT_MODELS`.

## Seams

- **`modelRoster` / `resolveModelEntry` / `mergeModelEntries`** (existing, core, pure; extended): given curated, discovered and operator layers, observe the merge order, operator notes and runtimes winning, discovered metadata replacing curated, and the runtime lookup for a discovered-only id. This is the main seam: most behaviour is pinned here with unit tests.
- **Claude discovery source** (new, server): behind an injectable SDK-query factory. Given a fake returning `ModelInfo[]`, observe `resolvedModel ?? value` ids, `claude-code` runtime and carried metadata. Given a throwing fake, observe a failed status with a reason. Also check that the prompt channel is never written to.
- **Codex discovery source** (new, server): behind an injectable file read. Given fixture cache JSON (a trimmed copy of the real shape, including a `hide` entry and an `upgrade` block), observe list-only filtering, priority order and the retirement hint. Given a missing or malformed file, observe a failed status.
- **Discovery service** (new, server): with fake sources and a temp data dir, observe persistence, keep-last-good on failure, the new-id computation against the previous run, event emission only on change, and that boot discovery doesn't block.
- **Settings view / refresh mutation** (existing `getSettings` extended; new mutation on the settings router): observe the discovered layer and source statuses in the view, and that refresh re-runs the sources and emits.
- **MCP `get_feature_context` / `emit_tickets`** (existing): observe that a discovered id the operator annotated appears in `annotatedModels` and is accepted on a ticket, and that an unannotated discovered id is absent from `annotatedModels`. Extend the existing config-visibility test rather than adding a parallel one.
- **Web roster helpers** (existing, `settings.ts` pure functions: `rosterFromView`, `rosterRows`, `rosterVisibleRows`, `hiddenCuratedCount`): observe the merged roster from a view with a discovered layer, new-badge visibility, collapsed untouched discovered rows, and the no-longer-offered flag (and its absence when the source failed).
- **Models page** (existing component, per `apps/web/STYLE.md`'s test tiers): observe the Refresh button calling the mutation, the per-source status lines, and the badges.

## Out of scope

- **Keeping sandbox CLIs current.** That's `sandbox-agent-clis-track-the-host-version`, burning in parallel. Its burn preflight and run-fatal "CLI too old for this model" classification cover a discovered model burned on an older sandbox CLI, so this feature adds no CLI-version guard (decision 6).
- **Per-step or per-project model resolution order** (`project-model-overrides-global-step-models`).
- **Changing defaults or step models automatically** (decision 7).
- **Anthropic `GET /v1/models`, alias roster entries, or a runcastle-published remote list** (decision 1).
- **Periodic or staleness-triggered refresh** (decision 3).
- **Updating `CURATED_MODELS` or the onboarding seeds.** They stay as the floor and first-run starting point.
- **Surfacing capability flags** (effort levels, fast mode) from either source beyond display name, description and retirement.

## Open questions

- **The zero-cost SDK probe.** The implementing ticket must confirm that opening a query and reading `initializationResult()` without sending a prompt bills no turn, and that the spawned CLI process exits cleanly on close. Also confirm the exact option name for pointing the SDK at the host binary against the installed SDK version, using Context7 or the package's types.
- **`[1m]` variants.** Check whether the SDK's model list includes 1M-context variants as separate entries, and what `value` / `resolvedModel` look like for them. If they don't appear, the curated `[1m]` entries remain the way to pick them. Record what was observed.
- **The Codex cache path.** Confirm it honours `CODEX_HOME` when set, falling back to `~/.codex`, the same way the shipped Codex auth handling locates `auth.json`.
