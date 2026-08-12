# CONTENT-PERIPHERY — consolidated audit report

Scope: `packages/skills/**` (injected prompt surface), `scripts/**` + root config hygiene, `site/**`,
root `README.md` / `E2E-FINDINGS.md`, and the stray `packages/server/~/.claude` artifact.

Leaf reports (full evidence): `periphery-skills.md`, `periphery-scripts.md`, `periphery-site.md`.
This file is the consolidated view: duplicates merged, disagreements resolved against source by the
orchestrator, section G ranked across all three leaves, section H promoted.

## Orchestrator adjudications (read first — these override the leaves and my own earlier notes)

| Claim | Verdict | Evidence |
|---|---|---|
| `all-waypoints-terminal` is an unused `GateCheckId` | **FALSE — overridden.** It is the mapped-feature G1 variant. | `packages/core/src/pipeline.ts:151-155` (`check: 'all-waypoints-terminal'`), returned by `nextGate` at `:175`; implemented `packages/server/src/services/gates.ts:31`; rendered `apps/web/src/components/Inspector.tsx:99`; specified `docs/SPEC.md:235`, `docs/adr/0001-mapped-ideation.md:75`; tested `packages/core/test/pipeline.test.ts:140`, `packages/server/test/gates.test.ts:84`. Both leaves that touched it agree. |
| The site calls the 4th phase "build" but core says `implementation` → drift | **FALSE — retracted (my own error).** Deliberate label indirection. | `apps/web/src/lib/feature-ui.ts:207-214` `PHASE_LABELS` maps `implementation: 'build'`. Site, README and shipped UI all agree; `implementation` is the internal id only. |
| 5 orphaned `mock-*.png` (~305 KB) | **Corrected down to 4 assets / ~124 KB.** My grep was scoped to `site/`; root `README.md` references three of them. | Referenced: `README.md:2` (`banner.png`), `README.md:100` (`mock-strip.png`), `README.md:123` (`mock-term.png`, `mock-review.png`). Genuinely orphaned: `mock-ledger.png`, `mock-shipped.png`, `npm.svg`, `typescript.svg`. |
| `npm install -g npm@latest` / `npm publish` in CI violates "bun everywhere" | **Not a finding** — deliberate and documented. | `.github/workflows/release.yml:83-88`: OIDC trusted publishing needs npm ≥ 11.5.1; bun has no publish equivalent. |
| `bun add -g runcastle` is a fake install path (root `private: true`) | **Not a finding** — real. | `release.yml:79` verifies the published name; `private: true` is by design per `release.yml:6`. |
| `tsconfig.base.json` `"lib": ["ESNext"]`, `"types": []` is a strictness gap | **Not a finding** — every workspace opts back in correctly. | `apps/web/tsconfig.json` DOM libs; `core` node; `server` bun-types. |

---

## A. Flow map

Three independent peripheral surfaces, each drifting from the same core contract
(`packages/core/src/pipeline.ts` + `schemas.ts`) with no automated link back to it:

```
packages/core/src/{pipeline,schemas}.ts   ← the ONE source of truth
   │
   ├─(hand-copied prose)→ packages/skills/packs/runcastle/skills/*/SKILL.md  ─┐
   │                      packages/skills/burner/*.md                        │ injected into
   │                      ← rendered by packages/server/src/launcher/         │ live agent
   │                        artifacts.ts (6 renderers) + sessions.ts          │ sessions
   │                                                                          ┘
   ├─(hand-copied prose)→ site/docs/{pipeline,gates}/index.html, site/compare/*
   │                      README.md, CONTEXT.md, docs/SPEC.md   (20 locations, 5 formats)
   │
   └─(no link at all)───→ scripts/dev.ts ─spawn→ bun --filter server|web ─spawn→ bun serve:4512 | vite:4513
                          scripts/devtool.ts → dev DB surgery
                          scripts/release.ts → git tag → .github/workflows/release.yml (the ONLY workflow)

apps/web/src/styles.css ──(manual `node site/build-app-css.mjs`)──→ site/assets/app-ui.css
                            ↑ never run in 47 commits; wired into no script, no CI
```

The structural fact tying the whole scope together: **there is no CI on push or pull request.**
`.github/` contains exactly one workflow, `release.yml`, triggered `on: push: tags: ['v*']`. Nothing
anywhere detects any of the drift above.

---

## B. Dead code

**B1. `dead-code:fix-feature-phase-script`** — violation — confidence **high** — effort S
`scripts/fix-feature-phase.ts` (whole file, 56 lines) is a one-off repair hard-coded to a single
feature id, referenced by nothing:
```
scripts/fix-feature-phase.ts:25
  const FEATURE_ID = process.argv[2] ?? 'feat_Oq7SVoUpPTvf'
```
Verified: repo-wide grep for `fix-feature-phase` returns exactly one hit — its own docstring at `:15`.
Not in root `package.json` scripts, not in `release.yml`, not in `README.md`, not in `docs/`.
Two aggravating facts: it targets the **production** data dir (`:27` `createDb(dbPath())` with no
`RUNCASTLE_DATA_DIR` pin — contrast `scripts/devtool.ts:54-63`, which refuses to run against the real
install), and its capability is already a documented devtool command (`README.md:264` →
`scripts/devtool.ts:242-258 featurePhase()`, which routes through `setPhase` so the move lands in the
timeline). This is the exact footgun devtool was built to prevent, sitting one `bun run` away.

**B2. `dead-field:smoke-step-result`** — violation — high — trivial
`scripts/smoke.ts:74` `type StepResult = { name; ok; detail }`; `record()` (`:86-89`) is the only
writer and always sets `ok: true`; `printSummary` (`:490`) prints `PASS` unconditionally. `ok` is
never false and never read as a discriminator.

**B3. `dead:site-orphan-assets`** — violation — high — effort S
4 assets referenced by no page and no README (~124 KB): `site/assets/screens/mock-ledger.png` (98 KB),
`site/assets/screens/mock-shipped.png` (26 KB), `site/assets/logos/npm.svg`, `site/assets/logos/typescript.svg`.

**B4. The stray artifact** — see the Appendix. **Safe to delete**, verified.

**Verified NOT dead** (recorded so no sibling re-litigates): `scripts/smoke.ts` (`README.md:238`,
`docs/SPEC.md:206`, `packages/server/test/mapped-smoke.test.ts:22`); `scripts/vendor-node-pty-prebuilds.ts`
(`vendor/node-pty/README.md:75`, `packages/server/src/pty/install-check.ts:105`,
`prebuild-bridge.ts:120`); `scripts/dev.ts` exports `DEV_FILTERS`/`devArgs`/`devEnv`
(`packages/server/test/dev-script.test.ts:4` — a legitimate testability seam); the 12 skill-referenced
MCP tools all exist; `record_finding` / `dry_run_drive` are unreferenced by skills but belong to the
`prepare` kind, which deliberately has no skill (`packages/server/src/launcher/sessions.ts:216-219`).

---

## C. Redundancy & repeated logic

**C1. `redundant:process-teardown`** — violation — **high** — effort S — *also §D1, also §H1*
A correct cross-platform process-tree kill already exists at
`packages/server/src/pty/dev-pane.ts:159-170`; `scripts/dev.ts:56` re-implements teardown naively.
Two real callers → real seam. Shared module: **`killProcessTree(pid)`**.

**C2. `redundant:repo-root-resolution`** — judgement call — high — effort S
Four different idioms for "where is the repo root" across four files, one of them unsound
(§D3 `scripts/vendor-node-pty-prebuilds.ts:33`), plus `packages/server/scripts/build-package.ts:32-35`
computing `SERVER_DIR`/`REPO_ROOT`/`CORE_DIR`/`SKILLS_DIR`/`WEB_DIR` independently.
Shared module: **`repoRoot()` / `assetPaths`**.

**C3. `redundant:script-logging`** — judgement call — medium — effort S
Five console front-ends across `scripts/**`, plus `packages/server/scripts/build-package.ts` (`•`/`✓`)
and `packages/server/src/doctor/cli.ts`. Shared module: **console reporter** (`log`/`step`/`ok`/`die`).

**C4. `redundant:script-entry-epilogue`** — judgement call — medium — effort S
Three different entry/epilogue conventions across 7 scripts. Shared module: **`runScript(main)`**.

**C5. `redundant:site-page-chrome`** — judgement call — **high** — effort M
~500 lines of byte-identical head/header/footer across the 8 static pages (~14% of all site HTML).
Header md5 `697fa20b…` identical ×5; footer md5 `1f795b4c…` identical ×4; the `og:image`
(`https://runcastle.dev/assets/screens/mock-shell.png`) is hand-repeated in all 8 files
(`site/index.html:24`, `docs/index.html:23`, `docs/pipeline/index.html:23`, `docs/gates/index.html:23`,
`compare/index.html:26`, `compare/{claude-code,conductor,t3-code}/index.html:23`). No templating step
exists. *Clean bill on the rest of the site: no broken links, no broken anchors, no inline `<style>`,
no TODO/FIXME/lorem, sitemap matches the real page set.*

**C6. `duplication:mcp-cheat-sheet`** — judgement call — high — effort M
The MCP tool contract is authored in **four** places: `packages/core/src/schemas.ts` (zod),
`packages/server/src/mcp/server.ts` (tool `description` strings), the SKILL.md packs, and
`packages/server/src/launcher/artifacts.ts` renderers. Every drift finding in §D below is a symptom.
Shared module: a **cheat-sheet generated from the registered schemas**.

---

## D. Latent bugs, inconsistencies & structural smells

### D-BUG. Live bugs (distinct from cleanliness — ranked)

**D1. `leaked-process:dev-launcher`** — violation — **high** — LATENT BUG
`scripts/dev.ts:56` kills only its two direct children; the processes actually holding ports 4512/4513
are their **grandchildren** (`bun --hot src/bin/runcastle.ts serve` per `packages/server/package.json:18`,
and `vite`):
```ts
// scripts/dev.ts:53-57
const stop = (signal: NodeJS.Signals): void => {
  if (down) return
  down = true
  for (const c of children) c.kill(signal)   // ← direct child only
}
```
On Windows `ChildProcess.kill()` maps to `TerminateProcess` on that one pid — grandchildren are
orphaned outright. The repo already documents this exact trap and fixes it with `taskkill /T /F` at
`packages/server/src/pty/dev-pane.ts:150-157`. Blast radius is not theoretical: `apps/web/vite.config.ts:15`
sets `strictPort: true`, so the next `bun run dev` fails immediately on "port 4513 in use", while the
stale 4512 server keeps answering `/health` — which is exactly what
`scripts/devtool.ts:439-454 warnIfServerRunning()` reads, so devtool reports a live server against a
dev tree nobody is looking at. Teardown also has no timeout→SIGKILL escalation and no
`child.on('error')` handler.

**D2. `missing-idle-timeout:server` (E2E F11 + F14)** — violation — **high** — effort **S** — LATENT BUG
*Surfaced from the E2E-FINDINGS classification; belongs to the server scope — routing up.*
`packages/server/src/index.ts:105-112` calls `Bun.serve({ port, fetch, websocket })` with **no
`idleTimeout`**, so Bun's 10 s default applies, while the SSE heartbeat is
`packages/server/src/lib/stream.ts:31` `const HEARTBEAT_MS = 25_000`. Every SSE stream is reaped
before its first heartbeat, giving a ~13 s reconnect cycle, and any request over 10 s is dropped.
Verified directly by the orchestrator. One line to fix; `DRIVE_HOOK_TIMEOUT_MS` next door is 10
*minutes*. **Highest value-per-effort finding in this scope.**

**D3. `swallowed-exit:dev-launcher`** — judgement call — medium — effort S
`scripts/dev.ts:61-68` collapses a signal death (`code === null`) to exit 1 without inspecting the
`signal` argument, so "vite was OOM-killed" and "vite exited 1" are indistinguishable. Worse: if
either child exits **0** (a `bun run --filter` shim exits 0 when the filter matches nothing), the
launcher tears everything down and reports **success** — `bun run dev` exits 0 having started nothing.

**D4. `windows-path:vendor-script`** — violation — high — effort S
`scripts/vendor-node-pty-prebuilds.ts:33` `const repoRoot = join(import.meta.dirname ?? '.', '..')`
— the `?? '.'` fallback makes the destination path (`:47`) cwd-relative. Everything else in the file
uses `join`/`dirname` correctly, which makes the fallback look accidental.

**D5. `npm-invocation:vendor-script`** — violation — high — effort S
`scripts/vendor-node-pty-prebuilds.ts:40` `execFileSync('npx', ['--yes','node-gyp@10','rebuild'], …)`
— the only `npx`/`npm` invocation in `scripts/**`, against the house rule. `bunx --yes node-gyp@10
rebuild` is the direct replacement. Secondary (currently masked by the non-linux refusal at `:22-28`):
bare `'npx'` with no `shell: true` cannot resolve `npx.cmd` on Windows.

**D6. `posix-only:smoke-transcript-path`** — violation — high — effort S
`scripts/smoke.ts:240` and `:416` hard-code `'/tmp/smoke-transcript.jsonl'` /
`'/tmp/smoke-mapped-transcript.jsonl'` in a file whose header (`:21-26`) is about not assuming a
platform and whose own `SCRATCH` correctly uses `join(tmpdir(), …)` (`:40`). Low impact (hook payload
only; `packages/server/src/routes/hooks.ts:128-133` stores the string and never opens it).

### D-VERIFY. The verification-gate hole

**D7. `verification-gate-hole:root-typecheck`** — violation — **high** — effort S
Re-verified from source by the orchestrator. `package.json:17`:
```json
"typecheck": "bun run --filter '@runcastle/core' --filter '@runcastle/server' typecheck"
```
Two workspaces have a real `typecheck` script no automation ever invokes: `apps/web` (`tsc --noEmit`,
~15.6k lines) and `packages/design-system` (`tsc -p tsconfig.json --noEmit`, ~1.2k lines).
`.github/` does **not** close it: exactly one workflow, `.github/workflows/release.yml`, `on: push:
tags: ['v*']` (`:15-18`), running the *same* two-filter root scripts (`:62-66`). Therefore:
1. `apps/web` and `packages/design-system` are typechecked by **nothing**.
2. **There is no PR or push CI at all.** A broken `main` is discoverable only at release time — on the
   same run that publishes to npm.
Doc drift rides along: `README.md:235` calls `bun run typecheck` *"`tsc --noEmit` across the typed
packages"*, which is not what it does.

> **Consequence every sibling scope must absorb:** the briefing's "skip anything tooling enforces"
> ground rule is **false** for `apps/web`, `packages/design-system`, and all test directories.

**D8. `untypechecked-tests`** — violation — high — effort S
```
packages/server/tsconfig.json:  "include": ["src"]                     ← 78 test files unchecked
apps/web/tsconfig.json:         "include": ["src","vite.config.ts"]    ← 16 test files unchecked
packages/core/tsconfig.json:    "include": ["src","test"]              ← correct
```
94 of 99 test files sit outside every `tsc`. `core` being the only one right makes this an
inconsistency, not a policy.

**D9. `divergent-tsconfig:design-system`** — violation — high — effort S
`packages/design-system/tsconfig.json` is the only workspace tsconfig that does **not** extend
`tsconfig.base.json`; it re-declares everything and drifts on five settings (`target` ES2020 vs ESNext;
`isolatedModules` and `resolveJsonModule` absent; `noUnusedLocals`/`noUnusedParameters` stricter than
every sibling), plus a duplicated pinned `typescript: 7.0.2` devDependency.

**D10. `orphan-package:design-system`** — judgement call — medium-high — effort M — *question, not a claim*
`packages/design-system` (~1.2k lines) has no importer in shipped code; repo-wide grep for
`@runcastle/design-system` outside the package returns only `.design-sync/config.json:2` and 21 files
under `.design-sync/previews/*.tsx`. Never built, never typechecked. **Not claimed dead** — plausibly
an in-flight redesign surface. For the root to resolve against the `apps/web` report.

### D-DRIFT. Injected-prompt drift (`packages/skills` vs source)

These are the highest-severity content findings: they are **shipped into live agent sessions**.

**D11. `contradiction:spec-sections-vs-later-laps`** — violation — high
`packages/skills/packs/runcastle/skills/spec/SKILL.md:18` says write spec.md "with **exactly these
sections**" and lists five — `## Later laps` is not among them. But `ideate/SKILL.md:31` promises the
human their deferred scope is "parked in the spec's `## Later laps` section", and
`revisit/SKILL.md:32,35-37`, `packages/server/src/launcher/artifacts.ts:292`,
`packages/server/src/launcher/sessions.ts:244` and `CONTEXT.md` decision 15 all read it back. Nothing
validates spec.md sections (G2 is only `spec-file-exists`), so lap 2 silently finds nothing — and
`revisit/SKILL.md:32` pre-absolves the loss: *"**Both may be absent** — that is not an error"*.

**D12. `drift:review-verb-rethink`** — violation — high
`project/SKILL.md:62` ("tell them to click **Rethink**") and `revisit/SKILL.md:3,30` name a button
that does not exist. `apps/web/src/lib/feature-ui.ts:1154-1155` ships `label: 'Iterate', kind: 'rethink'`
— Rethink was demoted to an internal procedure name (`trpc/routers/feature.ts:90`). `CONTEXT.md`
decision 15 drifted the same way. *Note the contrast with §Adjudications: phase labels ARE centralised
in `PHASE_LABELS`; review verbs are not.*

**D13. `stale:tickets-emitted-event`** — violation — high
`tickets/SKILL.md:68` instructs `record_event({ type: "tickets.emitted" })`, but
`packages/server/src/mcp/server.ts:199-201` states: *"This tool used to emit an additional
`tickets.emitted` note, which double-logged the same action"* — and
`packages/server/test/mcp-tools.test.ts:70-74` asserts it is gone. The skill restores the double-log by
hand; the test passes because it exercises the tool, not the prompt. Same shape at `ideate/SKILL.md:69`
(`phase.completed`) against `server.ts:297` + `features.ts:403` → three rows per transition.

**D14. `contradiction:waypoint-prototype-vs-edit-guard`** — violation — high
`waypoint/SKILL.md:23` tells a `prototype` waypoint to "build the smallest throwaway spike", but
`packages/server/src/launcher/edit-guard.ts:36-38` `guardsEdits(kind) = kind !== 'project'`, so every
Edit/Write outside `docs/features/<slug>/` is denied (`:77-89`). Compounding it: `noCodeRule`
(`artifacts.ts:82`) is injected at only **2 of 6** renderers (`:147`, `:357`) —
`renderWaypointPrompt` and `renderConvergePrompt` omit it, so the agent meets the deny with no warning.

**D15. `drift:burner-branch-claim`** — violation — high
`burner/implement-ticket.md:5` and `burner/research-waypoint.md:5` both say work happens "on branch
`feature/<slug>`". Actual: `workflows/ticket-burner.ts:67,1998,2028` → `runcastle/ticket/<slug>/<seq>-<uniq>`;
`workflows/research.ts:34-36` → `runcastle/research/...`, "**never to the feature branch itself**" —
yet `research-waypoint.md:39` says "Commit the doc to the feature branch."

**D16. `contradiction:complete-phase-refusal`** — violation — high
`revisit/SKILL.md:38` says the tool "will **refuse** to cross into implementation";
`mcp/server.ts:308-317` returns `{ ok: true, nextPhase: 'implementation', waitingOn: 'human burn' }`.
The tool's own description (`server.ts:946`) is correct; the skill is not. No skill mentions
`waitingOn` — including `tickets/SKILL.md:69`, whose only documented failure mode (`ok: false`) is
unreachable.

**D17. `drift:required-blockedby` / `drift:mcp-tool-args`** — violations — high
`packages/core/src/schemas.ts:114,175` make `blockedBy` **required**; `tickets/SKILL.md:38` reads as
"omit it". `originWaypointId` (`schemas.ts:177`) is required and demanded by `waypoint/SKILL.md:26`,
but omitted from the `emit_waypoints` description the agent actually sees (`mcp/server.ts:898`) and
from `ideate/SKILL.md:57`.

**D18. `inconsistent:burner-templates`** — judgement call — high
`burner/research-waypoint.md` lacks *all* of: the turn-ends-process rule, `<promise>COMPLETE</promise>`,
the concurrency-flag ban, the file-tools rule, `{{WORKSPACE_NOTES}}`, and `BLOCKED.md` — despite
running the same `claude --print` loop (`workflows/research.ts:275-282`).

**D19. `repeated-switch:session-kind`** — judgement call — high
`SessionKind` is switched in 4 disjoint places — skill directory names, `KICKOFF_LINES`, the
`renderSystemPrompt` chain, and `guardsEdits` — and only `KICKOFF_LINES` is compiler-checked.

### D-SITE. Site & doc drift

**D20. `stale:site-app-ui-css`** — violation — **high** — effort S
`site/assets/app-ui.css` (88 KB) is **generated** from `apps/web/src/styles.css` by
`site/build-app-css.mjs`, whose own header states the contract (`:16-18`): *"The product sheet is flat
… Run after changing app styles: `node site/build-app-css.mjs`"*. Last regenerated in commit `ca416e1`
(2026-07-25); `apps/web/src/styles.css` has changed in **47 commits since**. Measured drift:
**153 of 613 product classes missing, 19 dead classes shipped.** The generator is referenced only from
`site/README.md:10` and `:166` — wired into no package.json script and no CI job — and the output is
committed and not gitignored. The generator *would* still work (the product sheet is still flat: 0
nesting). The landing page embeds "real runcastle UI as live markup, not screenshots"
(`build-app-css.mjs:3-5`) styled by a 47-commit-stale copy.

**D21. `stale:skill-attribution`** — violation — **high** — effort S — *named by 2 leaves*
8 skills exist and **6** carry fork provenance (including `project`), but
`packages/skills/NOTICE.md:5-8`, `packages/skills/README.md:7` and the **public**
`site/compare/claude-code/index.html:149` all say "five of six … only waypoint is original".
`packages/skills/packs/runcastle/.claude-plugin/plugin.json:3` names 4; `packages/skills/packs/README.md:9-16,20-29,40`
says 5/4/"four". The public page cites `NOTICE.md` as proof of an attribution claim that is itself wrong.

**D22. `drift:site-prerequisites`** — violation — high — effort S
`site/compare/claude-code/index.html:210-215` says interactive phases "need only Bun, Git, and Claude
Code", contradicting `README.md:71` (Node.js 22+ required on Windows, else "terminals that instantly
exit") — in the paragraph aimed specifically at locked-down machines.

**D23. `drift:site-drive-port`** — judgement call — medium
"test drive on its own port" is claimed at `README.md:112`, `site/docs/pipeline/index.html:239`,
`site/docs/gates/index.html:208` and `site/compare/index.html:313`, but
`packages/server/src/services/drive-env.ts:59-65` has no `{{port}}` variable.

**D24. `stale-doc:posix-verification`** — violation — high — effort S
`docs/research/POSIX-VERIFICATION.md:216-218` reports `scripts/smoke.ts:38` hardcoded-absolute-path as
open; it is **fixed** (`scripts/smoke.ts:40` is `join(tmpdir(), 'runcastle-smoke')`). The note cannot
be trusted item-by-item without re-verification — relevant because it also lists still-open
server-side items (`packages/server/src/services/git.ts:65-73` `canon()` lowercasing paths; six tests
setting only `USERPROFILE` and not `HOME`).

**D25. `weak-guard:release-not-pushed`** — judgement call — medium — effort S
`scripts/release.ts` checks a clean tree (`:83-88`) and a free tag (`:92-97`), then tags `HEAD` and
pushes only the tag (`:118-120`). It never checks `HEAD` is on / an ancestor of `origin/main`, so the
released commit can exist on no remote branch. One `git merge-base --is-ancestor HEAD origin/main` is
cheap insurance given the docstring's own emphasis (`:15-19`) on how un-walk-backable a publish is.

### E2E-FINDINGS.md status — **0 fixed / 19 open / 5 paper cuts unverifiable**

`E2E-FINDINGS.md` is a 19-finding backlog with **no status column**, sitting in the repo root looking
like documentation. **Nothing in it has been fixed.** Every verdict below came from reading current
source (see the citation warning immediately after the table).

| F | Status | Evidence |
|---|---|---|
| F1 doctor reads boot env | OPEN | `setup.ts:30-33` no `env`; `doctor.ts:281`; merge helper `cli.ts:22-34` CLI-only |
| F2 hardcoded `~/.runcastle/.env` | OPEN | `setup.ts:299,308,322,327`; `doctor.ts:270`; `ticket-burner.ts:79`; `research.ts:53` |
| F3 git-identity dead button | OPEN | `FirstRunWizard.tsx:163` |
| F4 token plaintext | OPEN | `EnableAfkCard.tsx:218-222`, no `type=password` |
| F5 setup-token PTY not torn down | OPEN (low conf) | no kill path in `EnableAfkCard.tsx` |
| F6 prepare double-consent | OPEN — now *deliberate* | `artifacts.ts:668-670`, `:641` "Deliberately git-only" |
| F7 no `{{port}}` | OPEN | `drive-env.ts:59-65` |
| F8 `git clear` needs dev DB | OPEN | `devtool.ts:95-100` bail precedes dispatch at `:133` |
| F9 live prep session invisible | OPEN | `project-workspace.ts:152-181` |
| F10 POSIX-only db recipe | OPEN | `artifacts.ts:418-421` + `drive-hooks.ts:84` cmd.exe |
| **F11 no `idleTimeout`** | **OPEN** | `server/src/index.ts:105-112` — see §D2 |
| F12 "verified" ×2 meanings | OPEN (tooltips only) | `PreparationWorkspace.tsx:386` + `:339` |
| F13 re-record drops stamp | OPEN | `findings.ts:100` |
| **F14 SSE reaped pre-heartbeat** | **OPEN** | `stream.ts:31` 25 s vs Bun 10 s default — see §D2 |
| F15 sandbox has no DB | OPEN | `driveEnv` 0 hits in `ticket-burner.ts` |
| F16 drift banner asserts falsehood | OPEN | `git.ts:1983-2012`, `:2005` |
| F17 `notify off` default | OPEN | `use-notifications.ts:36-42` |
| **F18 "Resolve with agent" impossible** | **OPEN** | `feature-ui.ts:457-466` vs `edit-guard.ts:36-37,63-89`; no exemption in `hooks.ts:308-330` |
| **F19 `.sandcastle/` in user repos** | **OPEN** | `ticket-burner.ts:68,955`; no `.gitignore` write anywhere (only `smoke.ts:171`, own test repo) |

**`ambiguous:findings-citations`** — violation — **high** — *critical warning for every sibling scope*
**Two findings logs share the F1–F25 namespace.** The **96** `(findings F<N>)` comments in
`packages/**` and `apps/**` cite `docs/features/identify-random-issues-throughout-the-system/findings.md`,
**not** `E2E-FINDINGS.md` — verified by the orchestrator:
- `packages/core/src/schemas.ts:30` "blank page (findings F19)" ↔ `findings.md:82` *"F19 — Unknown `phase` value blank-screens the entire app"* ✅
- `E2E-FINDINGS.md:388` F19 = *"`.sandcastle/worktrees/` is written into your repo and is not gitignored"* ❌
`E2E-FINDINGS.md` is the more discoverable file (repo root) and is cited by nothing. Any agent that
read a `findings FN` comment and resolved it against `E2E-FINDINGS.md` drew a wrong conclusion.

**Live bugs to surface, ranked:** (1) **F11+F14** — one missing `idleTimeout` at `index.ts:105` kills
all SSE realtime on a ~13 s reconnect cycle. (2) **F18** — a feature advertised at `README.md:121-123`
is structurally impossible. (3) **F19** — `git add -A` (which burn agents run) sweeps a nested repo
into commits. (4) **F10** — db-per-branch broken on Windows by runcastle's own example. (5) **F16**.

---

## E. Wrong-tool & weak-typing findings

- **`no-schema-json-parse:scripts`** — violation — high — effort S. `JSON.parse` with no zod schema at
  `scripts/devtool.ts:401` (feeds a global `git config` write), `scripts/vendor-node-pty-prebuilds.ts:32`,
  `scripts/smoke.ts:151-155` (empty catch), `packages/server/scripts/build-package.ts:41` (`as PackageJson`).
  Shared module: **`readJsonFile(path, schema)`**. In a repo whose house rule is "zod is the schema lib".
- **`weak-typing:smoke-any`** — violation — high — effort M. `(x: any)` annotations in `scripts/smoke.ts`
  suppress tRPC inference and turn compile-time checks into runtime assertions.
- **`weak-typing:smoke-ctx-cast`** — violation — high — effort M. Five `as never` casts; importing
  `AppCtx` (`packages/server/src/db/types.ts`) as `scripts/devtool.ts:105` already does removes them all.
- **`weak-typing:release-shell-cast`** (`scripts/release.ts`) and **`weak-typing:devtool-index-cast`**
  (`scripts/devtool.ts`) — violations — high — effort S.
- **`stringly-typed:prebuild-bridge-action`** — judgement call — medium — effort S.
- **`unvalidated:template-placeholders`** — violation — high. `renderTemplate`
  (`workflows/ticket-burner.ts:181-191`) **fails open** on an unresolved `{{placeholder}}`: a typo in a
  burner template ships the literal token into a live agent prompt. Server owns the fix, skills own the
  templates — must not be fixed independently.

*Note: none of the above is caught by tooling — `scripts/**` is inside `tsc`'s reach only because it
has no tsconfig of its own; the smoke's `any`s are in a file nothing typechecks (§D7/D8).*

---

## F. Shallow modules / deletion-test candidates

- **`shallow:fix-feature-phase-script`** — violation — high. Deletion test: its capability is a strict
  subset of `devtool.ts:242-258 featurePhase()`, which is generalised *and* guarded. Removing it makes
  complexity vanish with nothing reappearing. See §B1.
- **`shallow:smoke-mcp-wrapper`** — judgement call — low — effort S.
- **Recorded as NOT shallow** (positive evidence): `scripts/dev.ts`'s `DEV_FILTERS`/`devArgs`/`devEnv`
  exports exist to be unit-testable (`packages/server/test/dev-script.test.ts:4`) — a legitimate seam.

---

## G. Deepening / consolidation / extraction opportunities — **ranked across all three leaves**

**G1. Add `idleTimeout` to `Bun.serve`** — value **very high**, effort **S**, risk low, confidence **high**
Key: `missing-idle-timeout:server`. `packages/server/src/index.ts:105`. One line restores all SSE
realtime (§D2, E2E F11+F14). Belongs to the server scope — **routing up, do not fix here.**

**G2. Extract `killProcessTree(pid)` and call it from `scripts/dev.ts:56`** — value high, effort **S**, risk low, confidence high
Keys: `redundant:process-teardown`, `leaked-process:dev-launcher`. The implementation already exists
and is documented (`packages/server/src/pty/dev-pane.ts:159-170`); this is a lift into a shared util
plus a one-line call-site change. Two real callers today → real seam. Fixes the orphaned-port bug.

**G3. Close the typecheck gap and add PR CI** — value high, effort **S**, risk low, confidence high
Key: `verification-gate-hole:root-typecheck`. Add the two missing `--filter`s to `package.json:17`, add
`test` to the `include` arrays in `packages/server/tsconfig.json` and `apps/web/tsconfig.json`, and add
a `pull_request` + `push:[main]` workflow. **Blast radius: the first run surfaces real errors across
~16.8k previously-unchecked lines and 94 test files** — that is the point, but land it as its own
change, and sequence it *after* the sibling scopes report so the errors land on characterised code.

**G4. Regenerate `site/assets/app-ui.css` and wire the generator** — value high, effort **S**, risk low, confidence high
Key: `stale:site-app-ui-css`. Run `node site/build-app-css.mjs` (it still works), then add it to a
script and a CI freshness check. 153 of 613 classes are currently missing (§D20). Pairs with G3 — the
same "no CI catches generated-artifact drift" root cause.

**G5. Reconcile the skill packs against the MCP/pipeline source** — value **high**, effort **M**, risk **medium**, confidence high
Keys: `contradiction:spec-sections-vs-later-laps`, `drift:review-verb-rethink`, `stale:tickets-emitted-event`,
`contradiction:waypoint-prototype-vs-edit-guard`, `drift:burner-branch-claim`,
`contradiction:complete-phase-refusal`, `drift:required-blockedby`. Nine prompt-level contradictions
(§D11–D18), each shipped into live agent sessions. Risk is medium because these are behavioural
prompts, not code — changing them changes what agents do, so they want review, not a bulk edit. The
durable fix is G6.

**G6. Generate the MCP cheat-sheet from the registered zod schemas** — value high, effort **M/L**, risk medium, confidence medium
Key: `duplication:mcp-cheat-sheet`. The tool contract is hand-authored in four places (§C6); every
finding in G5 is a symptom. Locality: "what are this tool's arguments" becomes one place. Speculative
until someone owns the renderer — but the second and third adapters already exist, so the seam is real.

**G7. Delete `scripts/fix-feature-phase.ts` and the stray `packages/server/~` artifact; add `.gitignore` guards** — value medium, effort **S**, risk low, confidence high
Keys: `dead-code:fix-feature-phase-script`, `stray-artifact:claude-transcript`. Value is
disproportionate to size: one removes an unguarded production-DB footgun, the other removes 278 KB of
an unrelated user project's session transcript that has already been committed **twice**.

**G8. Introduce `scripts/lib/` (`repoRoot()`, `log/step/ok/die`, `runScript(main)`, `readJsonFile(path, schema)`)** — value medium, effort S/M, risk low, confidence medium
Keys: `redundant:repo-root-resolution`, `redundant:script-logging`, `redundant:script-entry-epilogue`,
`no-schema-json-parse`. Individually thin; together 4 repo-root idioms (one unsound), 5 logging
front-ends, 3 entry conventions and 4 unvalidated `JSON.parse`s across 7 scripts plus 2 in
`packages/server/scripts/`.

**G9. Introduce a site template layer** — value medium, effort M, risk low, confidence high
Key: `redundant:site-page-chrome`. ~500 identical lines across 8 pages (§C5). Would also have
prevented §D21 and §D22 (the same claim hand-copied and drifting).

**G10. One consolidated doc-drift pass** — value medium, effort M, risk low, confidence high
Keys: `drift:doc-vs-code-counts`, `shotgun:pipeline-description`. See §H2/§H3 — better done once,
repo-wide, than as N per-leaf findings.

**G11. Type the smoke against `AppCtx`; await cancellation before its hard exit** — value low/medium, effort M, confidence medium
Keys: `weak-typing:smoke-ctx-cast`, `leaked-process:smoke-budget-guard`. Only pays off after G3.

---

## H. Cross-cutting candidates to pass UP

Ordered by how much they change what a sibling scope should do.

### H1. `verification-gate-hole:root-typecheck` — **tell every sibling** — violation, high
*Named independently by the scripts and site leaves.* Root `typecheck` covers 2 of 4 typed workspaces;
the only workflow (`release.yml`) fires on release tags only; 94 of 99 test files sit outside every
`tsc` `include`. **The briefing's "skip anything tooling enforces" rule is false for `apps/web`,
`packages/design-system`, and all test dirs** — findings those leaves discarded as tool-enforced are
live. The `apps/web` leaf in particular must know nothing typechecks its 15.6k lines.

### H2. `ambiguous:findings-citations` — **warn every sibling** — violation, high
`(findings F<N>)` in code resolves to `docs/features/identify-random-issues-throughout-the-system/findings.md`,
**not** root `E2E-FINDINGS.md`. **96** such comments span core, server, web and 10 test files. Siblings
that read one and resolved it against the root file drew wrong conclusions. Orchestrator-verified
collision: F19 = "unknown phase blank-screens the app" vs F19 = ".sandcastle not gitignored".
Treat my §D E2E table (0 fixed / 19 open) as the authoritative merge target.

### H3. `shotgun:pipeline-description` — judgement call, high — *named by 2 leaves*
Phases / gates / session-kinds are hand-written in **20 locations** across 5 formats (site ×8, docs ×5,
skill packs ×6, `feature-ui.ts` ×1) against one source (`packages/core/src/pipeline.ts` + `schemas.ts`).
**No single scope sees all 20 — this can only be resolved repo-wide.** Shared module: a generated
reference emitted from the pipeline/schema definitions.

### H4. `redundant:process-teardown` — violation, high — **highest-confidence shared module**
Shared module: **`killProcessTree(pid)`** (`taskkill /pid <pid> /T /F` on win32,
`process.kill(-pid, SIGTERM)` on POSIX). Sightings: `packages/server/src/pty/dev-pane.ts:159-170`
(correct, canonical) vs `scripts/dev.ts:56` (naive). The server owns several more process lifecycles —
the PTY registry, `services/drive-hooks.ts:165` (whose comment already talks about processes that
"survived the kill"), `workflows/ticket-burner.ts`, `workflows/research.ts`.
**Ask the server leaf how many independent kill paths exist.** If ≥2 more, this is a repo-wide extraction.

### H5. `drift:doc-vs-code-counts` — violation, high — *named by 3 leaves*
Hand-maintained inventories that have drifted from the thing they count. Confirmed instances:
`NOTICE.md:5-8` + `skills/README.md:7` + **the public** `site/compare/claude-code/index.html:149`
("five of six" vs 8 skills / 6 provenance headers); `plugin.json:3` ("4"); `packs/README.md:9-16,20-29,40`
("5"/"4"); `README.md:235` (typecheck scope); `CLAUDE.md` ("4 MCP tools" vs 14 registered —
build-era, noted in passing); `docs/research/POSIX-VERIFICATION.md:216` (fixed bug described as open).
**Likely also in `docs/SPEC.md`'s ownership table — flag for the docs/server leaves.**

### H6. `windows-path` (family key; sub-key per site) — violation, high
My sightings: `windows-path:vendor-script` (§D4), `posix-only:smoke-transcript-path` (§D6),
`windows-path:claude-config-dir` (the stray artifact — see Appendix). The repo has a research note on
this class, `docs/research/POSIX-VERIFICATION.md`, which itself lists live server-side items
(`services/git.ts:65-73` `canon()` lowercasing paths; six tests setting only `USERPROFILE`, not `HOME`,
so they read the developer's real `~/.runcastle`). **The note is stale item-by-item (§D24) — tell the
server leaf it exists and that each item needs re-verification.**

### H7. `no-schema-json-parse` — violation, high
Shared module: **`readJsonFile(path, schema)`** (zod). My sightings: `scripts/devtool.ts:401`,
`scripts/vendor-node-pty-prebuilds.ts:32`, `scripts/smoke.ts:151-155`,
`packages/server/scripts/build-package.ts:41`. The server reads config, prep manifests, MCP payloads,
hook payloads and sandcastle output as JSON — **match against the server leaf's `JSON.parse` inventory.**

### H8. `drift:review-verb-vocabulary` — violation, high
Rethink / Iterate / Fix / Merge-&-ship split across skills (`project:62`, `revisit:3,30`, `ideate:83`,
`converge:47`), web (`feature-ui.ts:1154,1169`, `vocabulary.ts:80-82`), server (`feature.ts:90`,
`artifacts.ts:265`) and docs (`CONTEXT.md` #15). Instructive contrast: **phase** labels *are*
centralised (`PHASE_LABELS`, `feature-ui.ts:207`) and consequently did not drift; review **verbs** are
not, and did. Shared module: user-facing verb vocabulary — `apps/web/src/lib/vocabulary.ts` is the
natural home. Ask web which labels ship and docs whether CONTEXT or the UI is canonical.

### H9. `drift:event-type-vocabulary` — violation, high
Skills instruct emitting `tickets.emitted` / `phase.completed`, which nothing consumes; services emit
`tickets.stored` / `phase.advanced` / `phase.complete_requested`. Shared module: an **`EventType` union
in `@runcastle/core`**. Ask the web leaf what the timeline actually renders.

### H10. `stale:generated-artifact-unwired-in-ci` — violation, high
`site/assets/app-ui.css` is the confirmed instance (§D20). **Check the same shape against
`packages/server/drizzle/`, `vendor/`, and any design-system token output** — with no push/PR CI
(H1), nothing anywhere catches generated-artifact drift.

### H11. `redundant:repo-root-resolution` / `assetPaths` — judgement call, high
Four idioms in my scope; `packages/server/scripts/build-package.ts:32-35` computes five root-relative
dirs independently, and the server resolves runtime-asset paths at boot (bundled vs checkout:
`RUNCASTLE_WEB_DIST`, skills packs, drizzle dir, `hook-client.ts`, `pty-host.cjs` — all listed at
`build-package.ts:79-95`). **This is likely one `assetPaths` module, not two.**

### H12. `inconsistent:prompt-rule-coverage` — violation, high
`noCodeRule` is injected at 2 of 6 renderers (`artifacts.ts:147`, `:357`) while `guardsEdits` denies
edits for 6 of 7 session kinds (`edit-guard.ts:36-38`). Entirely server-side; root cause of §D14.

### H13. `orphan-package:design-system` — judgement call, medium-high — **question for the root**
No importer outside `.design-sync/`; never built, never typechecked. Only the `apps/web` leaf can say
whether it is a migration target or residue. **Cross-check before anyone acts on it.**

### H14. `drift:context-md-decision-numbers` — violation, medium
`artifacts.ts:265` cites "CONTEXT decision #6" (actually Git topology); `features.ts:403/420` cites
"#7" (actually Phases). The charter was renumbered; citations were not. **Sweep every scope; cite by
name, not number.**

### H15. `unvalidated:template-placeholders` — violation, high
`renderTemplate` (`ticket-burner.ts:181-191`) fails open on an unresolved `{{placeholder}}`. Server
owns the fix, `packages/skills` owns the templates — **must not be fixed independently.**

### H16. `redundant:script-logging` — judgement call, medium
Console reporter (`log`/`step`/`ok`/`die`): 5 variants in `scripts/**`, plus
`packages/server/scripts/build-package.ts` and `packages/server/src/doctor/cli.ts`. Low individual
value; **promote only if a sibling names it too.**

---

## Appendix — the stray artifact `packages/server/~/.claude`

**What it is.** One tracked file, 284,541 bytes:
`packages/server/~/.claude/projects/C-Users-user-Projects-exam-forge/7e2f128f-b539-43ac-b115-5572eed7b3db.jsonl`
— a **Claude Code session transcript** in Claude Code's own on-disk layout
(`<config-dir>/projects/<flattened-cwd>/<session-uuid>.jsonl`). Read as data: Claude Code
`"version":"2.1.218"`, first entry `2026-07-28T10:40:07Z`, every record carrying
`"cwd":"C:\\Users\\user\\Projects\\exam-forge"` — **an unrelated user project, not runcastle**. Content
is a runcastle project-preparation agent run against that repo. No secrets observed in the head/tail;
the middle was not read, so treat it as **unreviewed third-party-project content**, not certified clean.

**How it got committed — twice.** `git log --diff-filter=A -- "packages/server/~"` → `a509d06`
(2026-07-28, the file present today) and `e25e128` (2026-07-19, three earlier transcripts under
`…/C-Users-user-Projects-_Active_-terminal-wait-game/`), with `e00d012` deleting that first batch. So
it was cleaned up once and recurred nine days later. Both times it rode in on a bulk `git add -A`-style
commit titled `latest` (`a509d06` touches 24+ files). `.gitignore` has 24 entries, none matching `~` or
`.claude/`.

**The cause — a genuine path bug.** Claude Code resolves its config dir as `CLAUDE_CONFIG_DIR` or else
`join(homedir(), '.claude')`. Landing at `packages/server/~/.claude/…` means it resolved to the
**literal relative string `~/.claude`**, which the OS resolved against the writing process's cwd —
`packages/server`, exactly the cwd of the dev server child. Two failures had to coincide: a home dir
expanding to a bare `~` (unset `HOME`+`USERPROFILE` in a spawned child on Windows) and a child whose
cwd was the server package. The original writer, `packages/server/src/workflows/project-prep.ts`, **no
longer exists** (removed in `b55ecbf`, *"retire the AFK preparation run"*).

What survives is the env-construction shape it used, still live at
`packages/server/src/workflows/ticket-burner.ts:1529-1532`:
```ts
const opts: ClaudeCodeOptions = {
  ...(token ? { env: { CLAUDE_CODE_OAUTH_TOKEN: token } } : {}),
  ...(onHost ? { permissionMode: 'bypassPermissions' as const } : {}),
}
```
This builds a **replacement** env of one variable — not a merge over `process.env`. If the agent runner
passes it through as the child's complete environment, the child has no `HOME` and no `USERPROFILE`,
which is precisely when `~` stops expanding. `buildBurnAgent` is used by both the burner
(`ticket-burner.ts:1839,2020`) and research (`research.ts:268`), so if the hypothesis holds it is
reachable today. **Artifact + provenance: high confidence. `env:` replacement as the surviving
mechanism: medium confidence** — the original writer is deleted, so the loop cannot be closed
statically. Recorded as `windows-path:claude-config-dir` for the **server leaf**, who can check what
`@ai-hero/sandcastle`'s `noSandbox` provider does with `ClaudeCodeOptions.env`.

**Safe to delete? Yes — verified.** Repo-wide grep for `.claude/projects` across `packages/**`,
`apps/**`, `scripts/**` returns **zero** hits. No test fixture references it; the only `transcriptPath`
handling (`packages/server/src/routes/hooks.ts:128-133`, `launcher/sessions.ts:102,129`) stores whatever
string a hook payload supplies and never opens a file. It is not in `packages/server/package.json`'s
`files: ["src","drizzle"]`, so it never shipped to npm, and `build-package.ts` copies an explicit
allow-list that excludes it. Nothing under `~` is a build input, migration, or runtime asset.
Recommend deleting **and** adding `.gitignore` entries `~/` and `.claude/` so recurrence #3 cannot happen.

**Left for the root to adjudicate:** `site/assets/video/runcastle-demo-1440.mp4` is 11.5 MB — 88% of
the site's 13 MB — genuinely referenced (with poster + `.vtt`), but committed to git forever. A
hosting decision this scope cannot settle.
