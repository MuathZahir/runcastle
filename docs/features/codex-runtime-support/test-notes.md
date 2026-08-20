# Test notes

## Lap 1

- [ ] [Drive blocked — no app walkthrough, no test run this lap]

What I did: called review_drive({action:"start"}) to boot `feature/codex-runtime-support` for the walkthrough the ticket prescribes.

What happened: the drive refused outright — `{"ok":false,"deniedReason":"Working tree has uncommitted changes — commit or stash first"}`. The checkout is sitting on `main` with two uncommitted paths that are NOT part of this feature:
  M  packages/core/src/index.ts
  ?? packages/core/src/docs.ts

What I expected: the drive to switch to the feature branch, render its per-branch DB and print a dev URL.

Consequence — the following acceptance criteria are UNVERIFIED and need a human at the keyboard:
  - `bun test` across packages/core, packages/server, apps/web (I could only have run it against `main`, which would have been a lie about this branch — so I did not run it at all).
  - Settings walkthrough: runtime-grouped model dropdown, required runtime picker for custom ids, persisted use-case notes.
  - Ticket-card model chip render + pre-burn edit.
  - Doctor/setup per-runtime state and conditional severity.
  - spawn:false smoke-path launch commands for a claude-runtime and a codex-runtime talk session, and the codex synthetic-home artifact files on disk.

I did not stash, commit, or switch the branch — those are the human's uncommitted changes on their own working tree, not mine to move. Rerunning the review after committing or stashing those two paths should let the drive start.

The code review itself ran to completion and is reported in separate notes; it needs no app.
- [ ] [Code review — Spec axis] Codex sessions ignore `permissionMode`, so a project session on a GPT model auto-approves the whole repo where the Claude equivalent asks.

Spec line (spec.md, "The AgentRuntime seam"): "The Codex adapter generates a synthetic per-session `CODEX_HOME` containing `config.toml` (model; `workspace-write` sandbox with **auto-approval as the `acceptEdits` analogue**; …)". And the seam's own contract, `packages/server/src/launcher/runtimes/types.ts:49`:

    /** Overrides the runtime's default permission posture (the project session's `default`). */
    permissionMode?: string

What I did: traced `permissionMode` end-to-end through the seam (`git grep -n permissionMode` on the branch, then opened each site).

What I found:
- `packages/server/src/launcher/launcher.ts:787` — the project session deliberately downgrades the posture:
      // Decision 18: whole-repo write access voids the acceptEdits justification.
      permissionMode: 'default',
- `packages/server/src/launcher/runtimes/claude.ts:63` honours it: `const permissionMode = input.permissionMode ?? 'acceptEdits'`, and threads it into both settings and argv (`claude.ts:160`).
- `packages/server/src/launcher/runtimes/codex.ts` never reads `input.permissionMode` at all. `CodexConfigInput` has no such field, and `renderCodexConfig` emits a hardcoded pair for every session kind:
      'sandbox_mode = "workspace-write"',
      'approval_policy = "never"',

What I expected: the Codex adapter to translate `permissionMode: 'default'` into an approval policy that prompts (Codex's `approval_policy` has non-`never` values), the same way `acceptEdits` maps to `never`.

Why it matters: a **project** session runs against the whole repo checkout, not a feature worktree — that is exactly why the Claude path was downgraded to `default`. Pick a Codex model as the `project`-step model and that safety downgrade silently evaporates: the agent gets unattended write approval across the human's whole repo. Nothing warns, and the behaviour differs from the same session on a Claude model, which is precisely the parity the feature promised.

Not a hard blocker for the feature, but it is a silent, safety-shaped divergence rather than a cosmetic one — worth a fix ticket before Codex project sessions are used in anger.
- [ ] [Code review — Spec axis] A Codex-only user who pastes an API key passes onboarding, gets Codex defaults seeded, and then every talk session refuses to launch.

Spec/decision lines. Decision #5: "Interactive Codex sessions inherit the user's own `codex login` (ChatGPT OAuth, `~/.codex/auth.json`) … AFK Codex burns require `CODEX_API_KEY`". Decision #6: "gate first-run on **at least one runtime being ready**". Decision #7: "On onboarding completion the wizard writes the global default and smoke model from an authed runtime … Codex's pair when Codex-only."

What I did: traced the wizard's readiness gate to the launcher's own precheck and compared the two definitions of "ready".

What I found — the two definitions disagree:
- `apps/web/src/lib/first-run.ts:115` (`runtimeReadiness`):
      talkReady: installed && (authed || afkReady),
  with the comment "`talkReady` accepts EITHER an interactive login or the unattended credential … an operator who pasted a token is not sent back to log in a second time."
- `apps/web/src/lib/first-run.ts:127` `readyRuntimes` filters on exactly that `talkReady`, and `FirstRunWizard.tsx:57` seeds defaults from it: `seed.mutate({ runtimes: readyRuntimes(runtimes) })`.
- But `packages/server/src/launcher/runtimes/codex.ts` `checkReady()` hard-refuses a talk launch with no `auth.json`:
      if (!existsSync(realCodexAuthFile())) return { ok: false, reason: 'Codex is installed but not logged in — runcastle copies your own credentials into each session's home, and there are none at …' }

Reproduce: on a machine with the `codex` CLI installed but no `codex login` performed, run first-run onboarding and paste only an OpenAI API key into the Codex AFK card. The wizard marks Codex `talkReady`, the gate opens, `seedModelDefaults` writes `gpt-5.6-sol` / `gpt-5.6-luna` as the global default and smoke models.

What happens then: every interactive session — ideation, qa, waypoint, converge, project — resolves to a Codex model and dies on `checkReady`'s GateError. The user finished onboarding into a runcastle that cannot open a single talk session.

What I expected: `talkReady` to mean what the launcher means by ready — an interactive login — with the API key counting only toward AFK readiness (which is what decision #5 says those two credentials are for). `afkReady` should not satisfy `talkReady`.

The Claude side is masked because its own adapter does not precheck login the same way, so this bites Codex-only users specifically — exactly the audience decision #6 exists to serve.
- [ ] [Code review — Spec axis] The fail-early auth precheck only covers the run's model, so a per-ticket cross-runtime assignment reaches the container with no credentials.

Spec/decision lines. Decision #5: Codex burns require `CODEX_API_KEY` "injected into the burn env exactly like `CLAUDE_CODE_OAUTH_TOKEN`, **with the same fail-early auth precheck**". Decision #7: "fail-early beats a cryptic CLI error mid-launch". Decision #4 is what creates the mismatch: "the burner treats `ticket.model` as the run override."

What I did: read `resolveBurnDeps` and the precheck in `burnRun`, then followed `ticketToken` to where it becomes the agent's env.

What I found:
- `packages/server/src/workflows/ticket-burner.ts:2638` — the precheck's input is computed once, from the RUN-level model only:
      const model = resolveModelEntry('implement', config, ctx.project, ctx.modelOverride)
      const token = readTokenFromEnvFile(envPath(), model.runtime)
      … hasAuthToken: token !== undefined,
- `ticket-burner.ts:1639` — the one and only precheck reads that single flag:
      if (deps.config.sandbox !== 'noSandbox' && !deps.hasAuthToken) { … return { status: 'failed', summary: 'burn aborted: auth token missing' } }
- `ticket-burner.ts:2642` — per ticket, a DIFFERENT runtime's token is read, with no equivalent guard:
      const ticketModel = resolveTicketModel(config, ctx.project, ctx.modelOverride, ticket)
      const ticketToken = ticketModel.runtime === model.runtime ? token : readTokenFromEnvFile(envPath(), ticketModel.runtime)
- `buildAgentEnv` then simply skips a missing token: `if (token) env[RUNTIME_AUTH_KEY[runtime]] = token`. A container's env "starts empty" (its own comment), so the agent gets no auth at all.

Reproduce: a Claude-default project with `CLAUDE_CODE_OAUTH_TOKEN` set and `CODEX_API_KEY` absent from `~/.runcastle/.env`; stamp one ticket with `gpt-5.6-sol` and Burn.

What happens: the run-level precheck passes (the Claude token is there), the burn starts, and that one ticket spins up a container with no `CODEX_API_KEY` — failing inside the sandbox with whatever the Codex CLI says about missing credentials, after paying for image start and setup.

What I expected: the precheck to cover every runtime the run will actually launch — i.e. `configuredRuntimes(config, ticketModels)` — and to abort with `RUNTIME_AUTH_SETUP_HINT[codex]` before any container starts, which is exactly the "same fail-early auth precheck" decision #5 asked for.
- [ ] [Code review — Spec axis] Ticket `model` is validated against the whole roster, not the annotated one, so decision #4's "annotated set" is guidance to the agent rather than a rule the store enforces.

Spec line (spec.md, Seams): "**Ticket store / `emit_tickets`** *(existing, extended)* — optional `model` per ticket, **validated against the annotated roster**, surfaced on cards, honored as run override." Decision #4: "when emitting tickets it may stamp an optional `model` per ticket, **chosen from that annotated set**".

What I did: read `normalizeModel`, the single gate every stored ticket model passes through, and compared it with what the MCP tool offers the agent.

What I found — `packages/server/src/services/tickets.ts:65`:

    function normalizeModel(ctx: AppCtx, value: string | null | undefined): string | null {
      const id = value?.trim()
      if (!id) return null
      const roster = modelRoster(ctx.config)
      if (!roster.some((m) => m.id === id)) {
        throw new InvalidInputError(`unknown model "${id}" — assign one of the configured models: …`)
      }
      return id
    }

`modelRoster(config)` is `CURATED_MODELS` merged with the operator's entries — every model, annotated or not. The MCP side is correct: `mcp/server.ts` passes only `annotatedModels` into the tickets session's context, and `packs/runcastle/skills/tickets/SKILL.md` tells it to choose from those. But nothing enforces it: an agent that stamps `claude-opus-4-8` with zero annotations anywhere is accepted.

What I expected, reading the spec's "validated against the annotated roster": `emit_tickets` to refuse an id the operator never annotated, so decision #4's "keeps the agent's candidate set exactly what the user curated" is an invariant rather than a suggestion.

The counter-argument is in the code's own comment and is a reasonable one — the human can retype the model on the card, and they should be able to pick any configured model there, not only annotated ones. If that is the intent, the two paths want splitting (strict on `emit_tickets`, permissive on `ticket.update`) and the spec line wants correcting, because as written the branch does not do what it says. Flagging it as a spec/implementation disagreement to settle rather than an outright bug.
- [ ] [Code review — Spec axis] Doctor's conditional severity ignores per-ticket model assignments, and the code comment that says so is stale in its own branch.

Spec line (spec.md, Seams): "**Doctor probes** *(existing, extended)* — per-runtime readiness (binary, auth, AFK key) with conditional severity." Decision #6: "Doctor probes both runtimes but only flags a runtime as a problem when it is missing *and* **some configured model resolves to it**."

What I did: read `configuredRuntimes` in core and then every place that calls it.

What I found. `packages/core/src/config.ts:452` takes exactly the right input — its own doc says "whatever extra ids the caller holds (**per-project overrides, per-ticket assignments**)":

    export function configuredRuntimes(config: ModelConfig, extraModelIds: readonly (string|null|undefined)[] = []): AgentRuntime[]

But neither caller supplies ticket models:
- `packages/server/src/trpc/routers/setup.ts:45` passes only per-project overrides — and the comment two lines above it is now false in this same branch:
      // Per-project overrides join the global default and the step matrix here;
      // per-ticket assignments will too once tickets carry a model of their own.
  Tickets carry a model of their own as of this branch (`TicketInput.model`, `tickets.model` column, migration 0028).
- `packages/server/src/doctor/cli.ts:55` passes nothing at all: `runtimes = configuredRuntimes(config)`.

Reproduce: on a host with no `codex` binary, leave every model setting on Claude and stamp one ticket with `gpt-5.6-sol`. Open the doctor / setup surface.

What happens: Codex's probes stay at `info` severity — "reported, never demanded" — so nothing warns. Then the burn hits that ticket and fails on a missing CLI.

What I expected: the ticket assignment to promote Codex to a real error the same way a per-project override does, since decision #6's whole test is "some configured model resolves to it", and a stamped ticket is as configured as a project override.

Note this compounds with the auth-precheck note: the same scenario produces neither a doctor error nor a fail-early abort.
- [ ] [Code review — Spec axis] The edit guard did change, against decision #9's "unchanged" — benignly, but it means Claude's launch artifacts are not byte-identical after the refactor.

Spec/decision lines. Decision #9: "Codex's hook protocol is Claude-shaped …, so **the edit guard and `/api/hooks` routes are unchanged**." Decision #8: "the Claude adapter is a refactor-in-place of today's behavior."

What I did: diffed `packages/server/src/launcher/edit-guard.ts` against main.

What I found:

    -export const EDIT_TOOLS = ['Edit', 'Write', 'NotebookEdit'] as const
    +export const EDIT_TOOLS = ['Edit', 'Write', 'NotebookEdit', 'apply_patch'] as const

`EDIT_TOOL_MATCHER = EDIT_TOOLS.join('|')` feeds both Codex's `hooks.json` and Claude's `settings.json`, so every Claude session now registers its PreToolUse hook with the matcher `Edit|Write|NotebookEdit|apply_patch` instead of `Edit|Write|NotebookEdit`.

What I expected, given the wording of #9: the guard untouched, with the Codex tool name contributed by the Codex adapter.

Why I am reporting it as low severity rather than a bug: the code's own comment argues it correctly — "a runtime never sees the other's tool names, so listing both costs nothing and keeps one matcher for both" — and a Claude session has no `apply_patch` tool for the extra alternation to match. The behaviour is the same; the *artifact* is not. Worth knowing only because #9's claim of an unchanged guard is what a reader would otherwise rely on, and because the byte-identical criterion the ticket names is therefore not literally met on this one string.

Second, smaller instance of the same thing: `renderCommand` now prefixes `KEY=value` env onto the `spawn:false` smoke command for both runtimes, so the Claude `session.launched` event string differs from main's. Also cosmetic, also worth knowing if anything downstream matched on that string.

Everything else on the Claude path does check out — argv, env, envScrub, the flags (`--settings`, `--mcp-config`, `--append-system-prompt-file`, `--plugin-dir`), the kickoff lines and the prompt text are verbatim, and no `CLAUDE_CONFIG_DIR` is set for any session (the only reference on the branch is the pre-existing `scripts/smoke.ts`, which pins it to the developer's REAL `~/.claude` and is untouched by this diff).
- [ ] [Code review — Standards axis] Shotgun Surgery: per-runtime identity facts are spread across ~15 `Record<AgentRuntime, …>` tables in three packages, several holding the same fact twice.

Smell: **Shotgun Surgery** — "one logical change forces scattered edits across many files. → gather what changes together." (Also touches **Duplicated Code**.) No documented standard in CLAUDE.md, CONTEXT.md, SPEC or the ADRs endorses this shape, so the baseline stands.

What I did: grepped every `Record<AgentRuntime, …>` on the branch and opened the ones that looked like the same fact.

The hunks. `packages/server/src/doctor/doctor.ts:220` holds the canonical spec:

    export const RUNTIME_SPECS: Record<AgentRuntime, RuntimeSpec> = {
      'claude-code': { label: 'Claude Code', bin: 'claude', loginCommand: 'claude auth login', afkKey: 'CLAUDE_CODE_OAUTH_TOKEN', … },
      codex: { label: 'Codex', bin: 'codex', loginCommand: 'codex login', afkKey: 'CODEX_API_KEY', … },
    }

and then the same facts are restated where they are needed:
- `apps/web/src/lib/settings.ts:39` — `RUNTIME_LABEL = { 'claude-code': 'Claude Code', codex: 'Codex' }` — an exact duplicate of `RUNTIME_SPECS[r].label`.
- `apps/web/src/lib/vocabulary.ts:26` — `AGENT_NAME = { 'claude-code': 'Claude', codex: 'Codex' }` — deliberately a different string (the vendor, not the CLI), which is fine, but it is a third naming table nobody would find from the first two.
- `apps/web/src/lib/first-run.ts` `RUNTIME_LOGIN` (`{ kind, command }`) restates `loginCommand` + `LOGIN_TERMINAL_KIND` from `services/setup.ts`.
- `apps/web/src/components/EnableAfkCard.tsx` `AFK_CREDENTIAL` restates the AFK key/noun.
- `packages/server/src/trpc/routers/setup.ts` re-spells the terminal kinds by hand as `z.enum(['setup-token','build-image','claude-login','codex-login'])` rather than deriving them — a fifth place a third runtime must be edited.

What it costs: the diff's own commit list shows the symptom — adding the SECOND runtime took edits in doctor, setup service, setup router, launcher, three web lib modules and two web components just to teach the app one runtime's name and login command. A third runtime pays the same tax, and the failure mode is a half-taught runtime (labelled in settings, unnamed in a transcript bubble) rather than a compile error.

The fix the smell points at: the runtime-identity half of `RUNTIME_SPECS` (label, product name, bin, login command, AFK key + noun) belongs in `@runcastle/core`, which both server and web already import; the doctor keeps only the probe-specific fields. That also resolves the layering oddity in the separate `divergent-change` note.

Judgement call, not a hard violation — nothing is wrong today, and the tables are all small and well-commented. But it is the one structural thing in this lap I would not let harden before a third runtime arrives.
- [ ] [Code review — Standards axis] Divergent Change: the doctor module is now a dependency of the launcher and the burn path, because it is where the runtime table lives.

Smell: **Divergent Change** — "one file edited for several unrelated reasons. → split so each module changes for one reason." Related to CLAUDE.md's package map, which describes `packages/server`'s dirs by role (`src/doctor` = prerequisite probes; `src/launcher` = spawn the terminal; `src/workflows` = burns).

What I did: grepped the importers of `RUNTIME_SPECS` and of the auth constants in `services/setup.ts`.

What I found — `packages/server/src/doctor/doctor.ts` is now imported by things that have nothing to do with diagnosis:
- `packages/server/src/launcher/runtimes/codex.ts:14` — `import { RUNTIME_SPECS } from '../../doctor/doctor'`, then uses it to locate `auth.json` and to word its readiness hint.
- `packages/server/src/services/setup.ts` — derives `AFK_TOKEN_KEY`, `CODEX_API_KEY`, `RUNTIME_AUTH_KEY` and `RUNTIME_AUTH_SETUP_HINT` from it.
- `packages/server/src/workflows/ticket-burner.ts:25` and `workflows/research.ts:26` then reach through the onboarding service for those: `import { RUNTIME_AUTH_KEY, RUNTIME_AUTH_SETUP_HINT } from '../services/setup'`.

So the dependency chain for burning a ticket now runs burner → onboarding service → doctor. The doctor file changes for probe reasons, launcher reasons and burn-auth reasons, and a burn's auth wording is coupled to a diagnostics module.

The comment on the codex adapter states the intent honestly and it is a good one — "asked of the doctor's own probe so the launcher and the 'Codex login' check can never disagree about where credentials live". The single source of truth is right; its address is the problem.

What I expected: a runtime-identity table each of these can depend on without depending on each other — in `@runcastle/core` (which already owns `AGENT_RUNTIMES` and every other cross-package contract per CLAUDE.md's package map), with the doctor holding only its probe fields.

Judgement call, and the same underlying issue as the shotgun-surgery note — I am recording it separately because the fixes differ: that one is about duplication in web, this one is about layering in server.
- [ ] [Code review — Standards axis] Middle Man: three exported names in `services/setup.ts` for one field of `RUNTIME_SPECS`, two of which exist only to build the third.

Smell: **Middle Man** — "a function that mostly just delegates onward. → cut it, call the real target."

What I did: opened `packages/server/src/services/setup.ts:32-53` and grepped every consumer of the four constants.

The hunk:

    export const AFK_TOKEN_KEY = RUNTIME_SPECS['claude-code'].afkKey
    export const CODEX_API_KEY = RUNTIME_SPECS.codex.afkKey

    export const RUNTIME_AUTH_KEY: Record<AgentRuntime, string> = {
      'claude-code': AFK_TOKEN_KEY,
      codex: CODEX_API_KEY,
    }

    export const RUNTIME_AUTH_SETUP_HINT: Record<AgentRuntime, string> = {
      'claude-code': RUNTIME_SPECS['claude-code'].afkFix,
      codex: RUNTIME_SPECS.codex.afkFix,
    }

What the grep shows:
- `AFK_TOKEN_KEY` — no production consumer outside line 41 of this same file; otherwise only `test/setup.test.ts:109`, which asserts `RUNTIME_AUTH_KEY['claude-code']` equals it (a tautology given line 41).
- `CODEX_API_KEY` — same shape: line 42 here, plus assertions in `test/setup.test.ts`.
- `RUNTIME_AUTH_KEY[r]` is `RUNTIME_SPECS[r].afkKey`, entry for entry.
- `RUNTIME_AUTH_SETUP_HINT[r]` is `RUNTIME_SPECS[r].afkFix`, entry for entry — a hand-written re-projection of a record that is already keyed by runtime.

What I expected: the two real consumers (`ticket-burner.ts`, `research.ts`) to index `RUNTIME_SPECS[runtime].afkKey` / `.afkFix` directly, and these four exports to go away. As written, a new runtime must be added to `RUNTIME_SPECS` and then remembered again in two hand-listed maps below it — and the compiler catches only the `Record<AgentRuntime, …>` half, not the `AFK_TOKEN_KEY` half.

Low severity and no behaviour at stake; it is pure indirection, and the tests that "cover" it mostly assert the indirection back to itself.
- [ ] [Code review — Standards axis] Speculative Generality: three exported seams the lap leaves with no production caller, kept alive only by their own tests.

Smell: **Speculative Generality** — "abstraction or hooks for needs the spec doesn't have. → delete it." CLAUDE.md's own framing agrees: "`NotImplementedError` stubs are wave-B sockets — replace, don't redesign", i.e. sockets exist for named consumers.

What I did: grepped each exported symbol across `packages` and `apps`, excluding `/test/`.

1. `packages/core/src/config.ts:391` — `resolveModel`. Zero non-test callers anywhere on the branch: every production site moved to `resolveModelEntry` (which returns the `{ id, runtime }` pair a launch now needs), and `resolveModel` survives only as a one-line `.id` wrapper plus `packages/core/test/config.test.ts`. It is the API the whole feature was built to replace, still exported from core's public barrel.

2. `packages/server/src/launcher/runtimes/index.ts:46,51` — `registerRuntimeAdapter` / `resetRuntimeAdapters`. The only callers are `packages/server/test/runtime-adapter.test.ts` (lines 12, 77, 88, 176). Production uses the frozen `BUILT_IN` list. The doc comment is candid about it: "the seam a runtime is added through — and the one **tests** drive the launcher's runtime dispatch from". A mutable module-level registry that only tests mutate is a shared-global hazard between test files for a dispatch that could be injected instead.

3. `packages/server/src/workflows/burn-guard.ts` — `GUARD_SCRIPT_PATH`, and `packages/server/src/launcher/runtimes/claude.ts` — `CONVERGE_KICKOFF_LINE`. Same shape: exported, test-only. (`GUARD_SCRIPT_PATH` in particular was orphaned by the Codex-twin work — commit f97299d already dropped a sibling constant "the twin orphaned"; this one stayed.)

What I expected: `resolveModel` retired along with its callers (or kept deliberately, with a comment saying it is public API for external callers); the adapter registry replaced by passing the adapter map into the launcher; the two orphaned constants deleted.

None of this is wrong, and #2 in particular is a defensible testing seam. Recording it because "the only caller is a test" is the exact signature the baseline asks to be flagged, and because the spec's Seams section names the adapter contract as "the feature's one new seam" — a registry on top of it is a second seam the spec did not ask for.
- [ ] [Code review — Standards axis] Duplicated Code: the runtime-grouped model `<optgroup>` list is rendered twice, in Settings and on the ticket card.

Smell: **Duplicated Code** — "the same logic shape in more than one hunk or file. → extract it, call it from both."

What I did: grepped `modelOptionGroups` and opened both render sites.

The two hunks both walk the same groups and both re-derive the same option label:
- `apps/web/src/components/SettingsOverlay.tsx` (`ModelCombobox`):

      {groups.map((group) => (
        <optgroup key={group.runtime} label={group.label}>
          {group.entries.map((entry) => (
            <option key={entry.id} value={entry.id} title={entry.note}>
              {entry.note ? `${entry.id} — ${entry.note}` : entry.id}
            </option>
          ))}
        </optgroup>
      ))}

- `apps/web/src/components/bodies/TicketsBody.tsx:383` (`TicketEditor`) — `{modelOptionGroups(roster).map((g) => …)}` with the same `note ? id — note : id` label expression.

The grouping helper is already shared (`apps/web/src/lib/settings.ts:75`), so the shared part is done; it is the last hop — the `<optgroup>`/`<option>` markup and the label rule — that is copied.

What I expected: one `<ModelOptions groups={…} />` component both selects render, so the label convention ("id — note") and the `title` tooltip cannot drift between the two places a human picks a model.

Low severity: small, adjacent, and both copies are correct today. It matters mainly because these two dropdowns are the feature's whole per-ticket-model story, and a human comparing them expects them to look identical.
- [ ] [Code review — Standards axis] Mysterious Name: two different things named `KICKOFF_LINES` and two different things named `RuntimeReadiness`.

Smell: **Mysterious Name** — "a name that doesn't reveal what it does or holds. → rename it."

What I did: grepped the exported symbol names introduced by the seam.

Collision 1 — `KICKOFF_LINES`, same name, different content, in sibling files:
- `packages/server/src/launcher/runtimes/claude.ts:108` — `export const KICKOFF_LINES = kickoffLinesFor('claude-code')` (the `/runcastle:*` spellings)
- `packages/server/src/launcher/runtimes/codex.ts:343` — `export const KICKOFF_LINES = kickoffLinesFor('codex')` (the `$`-prefixed spellings)

Neither name says which runtime's lines it holds, so any consumer needing both must rename one at the import — which is exactly what `packages/server/test/kickoff.test.ts:5-6` does:

    import { CONVERGE_KICKOFF_LINE, KICKOFF_LINES } from '../src/launcher/runtimes/claude'
    import { KICKOFF_LINES as CODEX_KICKOFF_LINES } from '../src/launcher/runtimes/codex'

An import site having to invent the distinguishing half of a name is the smell's own tell. `CLAUDE_KICKOFF_LINES` / `CODEX_KICKOFF_LINES` would read correctly everywhere, and the adapters already expose `kickoffLine(kind)` as the interface anyway.

Collision 2 — `RuntimeReadiness`, two unrelated shapes:
- `packages/server/src/launcher/runtimes/types.ts:24` — the launcher's precheck verdict: `{ ok: true } | { ok: false, reason, doctorHint }`
- `apps/web/src/lib/first-run.ts:75` — the wizard's per-runtime card: `{ runtime, label, installed, authed, afkReady, talkReady, detail, installFix? }`

They are in different packages so nothing breaks, but "is this runtime ready" is the one question the codebase now answers in two incompatible ways under one name — and (see the separate spec-axis note) those two answers genuinely disagree about a Codex install with an API key and no login. The naming collision is how that disagreement stayed invisible. Renaming the web one to something like `RuntimeCard` would make the two concepts visibly distinct.

Low severity on its own; worth fixing alongside the readiness bug rather than separately.
- [ ] [SUMMARY — read me first] Code review complete on all 38 commits; the drive never started, so nothing was verified by running the app.

WHAT RAN. Full two-axis code review of `feature/codex-runtime-support` against `main` (merge-base 1b4be3c), 89 files / ~7,800 insertions. Both axes were verified by me against the source before being written up — every finding below has a citation and a hunk I opened.

WHAT DID NOT RUN. `review_drive` refused with "Working tree has uncommitted changes" (the checkout sits on `main` with `M packages/core/src/index.ts` and an untracked `packages/core/src/docs.ts`, neither of which belongs to this feature). That is a final refusal, so there was no dev server, no browser walk, and no test run — details and the full list of unverified criteria are in the separate drive-blocked note. In short: **`bun test` for core/server/web, the Settings walkthrough, the ticket-card model chip, the doctor surface, the spawn:false smoke commands and the codex synthetic-home files on disk are all UNTESTED.** Fresh-onboarding wizard states and anything needing a live `codex` binary or a real burn were out of reach regardless, and stay untested. Everything I say about behaviour is read off the code, not observed running.

SPEC AXIS — 6 findings. Worst within this axis: **a Codex-only user who pastes an API key but never runs `codex login` passes the onboarding gate, gets Codex models seeded as their defaults, and then every single talk session refuses to launch** — the wizard's `talkReady` accepts the AFK credential, the Codex adapter's `checkReady` does not. That is the precise audience decision #6 was written to serve, walking into a dead end. The other five: Codex sessions ignore `permissionMode`, so a project session on a GPT model auto-approves the whole repo where Claude asks (the Standards axis found this independently as Refused Bequest); the fail-early auth precheck covers only the run-level model, so a cross-runtime per-ticket assignment reaches the container with no credentials; ticket `model` is validated against the whole roster rather than the annotated one the spec names; doctor's conditional severity ignores per-ticket assignments (its own comment saying "will too once tickets carry a model" is stale in this branch); and the edit guard's tool matcher did change despite decision #9 promising it unchanged (benign — additive alternation a Claude session can never match).

Also worth stating positively, because I checked them: the called-out contract items hold. No runtime is ever inferred from a custom id (#3) — the custom-model form's runtime picker is required with no default. `CODEX_API_KEY` is used throughout and `OPENAI_API_KEY` appears nowhere (#5). No `CLAUDE_CONFIG_DIR` is set for any session (#8) — the only reference on the branch is the pre-existing `scripts/smoke.ts`, untouched. The Claude adapter's flags, argv, env, envScrub, kickoff lines and prompt text are verbatim from before the refactor (#8). Server hook routes and the MCP server are untouched (#9). Reasoning effort correctly did not ship (#12).

STANDARDS AXIS — 6 findings, zero hard violations of a documented standard. Worst within this axis: **Shotgun Surgery** — per-runtime identity facts (label, product name, login command, AFK key) are restated in ~5 hand-written tables across `doctor/doctor.ts`, `services/setup.ts`, `trpc/routers/setup.ts` and three web modules, so a third runtime pays the same tax and the failure mode is a half-taught runtime rather than a compile error. Then: Divergent Change (the doctor module is now on the burn path's dependency graph, because it owns the runtime table); Middle Man (four exported constants in `services/setup.ts` that re-project one field of `RUNTIME_SPECS`); Speculative Generality (`resolveModel`, the adapter registry, and two constants now have no production caller); Duplicated Code (the model `<optgroup>` render, copied between Settings and the ticket card); Mysterious Name (`KICKOFF_LINES` and `RuntimeReadiness` each name two different things).

CAVEAT ON THE DIFF ITSELF. The three-dot diff excludes the two uncommitted paths on `main` noted above — I reviewed the branch's committed work only. All seven implementation tickets landed; nothing was missing outright, so this is a review of a fully-built feature, not a partial one.
