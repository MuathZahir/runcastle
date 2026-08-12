# periphery-site — audit report

**Scope:** `site/` (8 HTML pages, CSS, generator), root `README.md`, `E2E-FINDINGS.md`.
**Method:** static analysis only. Every claim cross-checked against `packages/core/src/pipeline.ts`,
`packages/core/src/schemas.ts`, `CONTEXT.md`, `docs/SPEC.md`, `package.json`,
`.github/workflows/release.yml`, and the actual server/web source.

**Headline:** the site and README are in *better* shape than expected — the phase
vocabulary, ports, paths, gate table and install path all check out. The two real
problems are (1) `E2E-FINDINGS.md` is a **19-finding backlog with zero findings
fixed**, several of them live bugs, sitting in the repo root looking like
documentation; and (2) it **collides numerically** with the findings log the code
actually cites, so every `(findings FN)` comment in the codebase is ambiguous.

---

## Corrections to the parent's pre-supplied mechanical results

Three items handed down need amending before they are merged upward. I verified each.

1. **The "orphaned screenshots" list is wrong for 3 of 5 files.** The parent's grep
   covered `site/**` only. The **root `README.md`** references them:
   - `mock-strip.png` → `README.md:100`
   - `mock-term.png`, `mock-review.png` → `README.md:123`
   - `mock-shell.png` → `README.md:40` (in addition to the og:image use)
   - `banner.png` → `README.md:2` (so it is **not** "referenced only from site/README.md")

   **Genuinely orphaned, repo-wide:** `site/assets/screens/mock-ledger.png` (98 KB),
   `site/assets/screens/mock-shipped.png` (26 KB), `site/assets/logos/npm.svg`,
   `site/assets/logos/typescript.svg`. ≈124 KB, not ~305 KB.

2. **`all-waypoints-terminal` is NOT an unused `GateCheckId`.** It is the check on
   `MAPPED_G1`, `packages/core/src/pipeline.ts:151-155`:
   ```ts
   const MAPPED_G1: GateDef = { id: 'G1', description: 'Every waypoint resolved or dropped before converging', check: 'all-waypoints-terminal' }
   ```
   returned by `nextGate` when `feature.mapped` (`pipeline.ts:175`). Not dead.

3. **The `build` vs `implementation` "vocabulary split" is deliberate and correct —
   the site is not the odd one out.** `apps/web/src/lib/feature-ui.ts:207-214`:
   ```ts
   export const PHASE_LABELS: Record<Phase, string> = { …, implementation: 'build', … }
   ```
   `implementation` is the internal `Phase` id; **`build` is the shipped user-facing
   label**. The site (`site/docs/pipeline/index.html:104`), the README
   (`README.md:31`) and the product UI all say "build" consistently. **No finding.**
   Likewise `site/docs/pipeline/index.html` naming zero `G[1-5]` ids is deliberate
   page separation — it carries a callout linking to `/docs/gates/`
   (`site/docs/pipeline/index.html:260-262`), and the gates page carries the ids.

---

## A. Flow map

Two independent flows meet in this scope.

**Site build / publish flow**
```
apps/web/src/styles.css  (product stylesheet, 3859 lines, hand-edited by app work)
      │  node site/build-app-css.mjs   ← MANUAL. In no package.json script, no CI job.
      ▼
site/assets/app-ui.css   (generated, 3263 lines, committed, NOT gitignored)
      │  <link rel="stylesheet">  from all 8 pages
      ▼
site/index.html + site/{docs,compare}/**/index.html   ← embed real UI as live markup under .rc-app
      └─ site/styles.css (43 KB, page chrome) + site/content.css (8 KB)
      └─ site/assets/{video,screens,logos,fonts}/
      └─ site/sitemap.xml / robots.txt (8 URLs = 8 pages ✓)
```

**Release / install flow (what the site advertises vs what ships)**
```
scripts/release.ts  →  pushes annotated v<version> tag
      ▼
.github/workflows/release.yml  →  typecheck → test → "Build publishable package"
      →  verifies built manifest name === "runcastle" (release.yml:79)
      →  npm publish --provenance --access public (release.yml:91)
      ▼
`bun add -g runcastle`  ← what README.md:50 and site/docs/index.html:119 tell users
```
Root `package.json` is `"private": true, "version": "0.0.0"` — that is **by design**
(`release.yml:6`: "package.json stays 0.0.0 by design"); CI assembles a separate
publishable package. **The advertised install path is real. No finding here.**

**Findings-log citation flow (broken — see D)**
```
packages/**, apps/** code comments  ──cite──▶  "(findings FN)"
                                                 │
                    ┌────────────────────────────┴───────────────────────────┐
                    ▼                                                        ▼
docs/features/identify-random-issues-throughout-the-system/findings.md   E2E-FINDINGS.md
  F1–F25 (+ sub-ids F10.7, F17.3, F25.3)  ← the one actually cited         F1–F19 ← same ids, different bugs
```

---

## B. Dead code

**`dead:site-orphan-assets`** — kind: violation — confidence: high — effort S, risk low.
Four committed assets with zero references anywhere in the repo (verified by
basename grep across `*.md,*.html,*.css,*.js,*.mjs,*.ts,*.tsx`, excluding
`node_modules` and the audit's own reports):

| File | Size |
|---|---|
| `site/assets/screens/mock-ledger.png` | 98 KB |
| `site/assets/screens/mock-shipped.png` | 26 KB |
| `site/assets/logos/npm.svg` | 332 B |
| `site/assets/logos/typescript.svg` | 1.3 KB |

**`stale:site-app-ui-css-orphan-rules`** — kind: violation — confidence: high.
19 class selectors exist in the committed `site/assets/app-ui.css` that no longer
exist in `apps/web/src/styles.css` at all — dead CSS shipped to every visitor:
`.converge-bar .converge-blocked .converge-btn .converge-fog .converge-fog-icon
.converge-fog-text .converge-override .drive-pane-empty .feature-flag .map-panel
.map-section-body .map-sections .mini-check .needs-burn .needs-ship .tb-dot
.wp-lineage .wp-summary .wp-work`. (Method: `grep -o "^\.rc-app \.[cls]"` on the
generated file vs `grep -o "^\.[cls]"` on the product sheet, sorted + `comm`.)

Nothing else in `site/` is dead. All 8 pages are in `sitemap.xml`; the video,
poster and VTT are all referenced from `site/index.html`; no unused CSS files.

---

## C. Redundancy & repeated logic

### C1. `redundant:site-page-chrome` — kind: judgement call — confidence: high — effort M, risk low

The `<header>`/nav block is **byte-identical** (modulo leading whitespace) across
all 7 sub-pages, and so is the `<footer>`. Verified by md5 of the extracted blocks:

```
header (<header>…</header>)  32 lines  md5 697fa20bc7cd2c13151c73147d27f84e  × 5 checked, all equal
footer (<footer>…EOF)        25 lines  md5 1f795b4c943f62a2adf522b55b4f7c42  × 4 checked, all equal
```
`site/docs/gates/index.html:58-89` and `site/compare/claude-code/index.html:63-94`
are the same 32 lines. Plus, in every `<head>`, the same 6-line font-preload +
stylesheet block (`site/docs/gates/index.html:31-36`).

**Duplication budget:** (32 header + 25 footer + ~6 head) × 8 pages ≈ **500 lines**
of hand-maintained identical markup, out of 3623 total site HTML lines — **~14% of
the site is copy-pasted chrome.** Adding one nav item is an 8-file edit; the nav
already carries 6 links (`Pipeline · Parallel work · Gates · Local-first · Docs ·
Compare`) plus GitHub + "Get started", and the footer 6 more.

**Name the module:** a `site/partials/{head,header,footer}.html` set plus a
~40-line `site/build.mjs` that inlines them — the site *already* has a build step
(`site/build-app-css.mjs`), so this is extending an existing seam, not inventing
one. Two real adapters exist today (the docs sub-nav and the compare sub-nav are
each duplicated 3–4×), so this is a real seam, not speculative.

### C2. `redundant:compare-page-template` — kind: judgement call — confidence: high — effort M, risk low

The three product-compare pages (`site/compare/{claude-code,conductor,t3-code}/index.html`,
429 + 398 + 426 = 1253 lines) share, beyond the chrome above:
- the compare sub-nav pill row — `compare/claude-code/index.html:116`,
  `compare/conductor/index.html:119`, `compare/t3-code/index.html:118`,
  `compare/index.html:175` (4 copies, differing only in which link carries
  `aria-current="page"`);
- an identical `<meta property="og:image">` (`:23` in all three);
- the same page skeleton: breadcrumb → h1 → "The verdict, up front" → sub-nav →
  side-by-side table → "checked on <date>" provenance footer → next-links.

A `diff` of the first ~95 lines of `compare/claude-code` vs `compare/conductor`
shows only **31 differing lines** — the rest is template.

**Name the module:** `site/partials/compare-page.html` + a per-competitor data
block (name, verdict, table rows, checked-on date, source links), rendered by the
same `site/build.mjs` as C1.

### C3. `shotgun:pipeline-description` — kind: judgement call — confidence: high — effort L, risk med

The pipeline (6 phases), the gates (G1–G5) and the session kinds are **hand-written
prose in 20 places**, against exactly one machine-readable source
(`packages/core/src/pipeline.ts`). Enumerated by grep for the phase vocabulary:

| # | Location | What it hand-repeats |
|---|---|---|
| 1 | `packages/core/src/pipeline.ts` | **the source of truth** (PIPELINE, GateDef) |
| 2 | `apps/web/src/lib/feature-ui.ts:207-224` | `PHASE_LABELS` + `PHASE_TIP` (user labels) |
| 3 | `README.md:31, :106-114` | phase list + phase table |
| 4 | `CONTEXT.md:38` | decision 7, phase list |
| 5 | `CLAUDE.md` | (build-era) pipeline references |
| 6 | `docs/SPEC.md` | contract-level phase/gate spec |
| 7 | `docs/UI-SPEC.md` | UI-level phase references |
| 8 | `docs/adr/0001-mapped-ideation.md` | mapped-G1 variant |
| 9 | `docs/adr/0010-laps.md` | lap loop-backs |
| 10 | `site/index.html` | landing pipeline strip |
| 11 | `site/docs/index.html:216+` | "The loop" |
| 12 | `site/docs/pipeline/index.html:103-181` | the six-phase table |
| 13 | `site/docs/gates/index.html:152-188` | the G1–G5 table |
| 14 | `site/compare/index.html` | phase list |
| 15 | `site/compare/conductor/index.html` | phase list |
| 16 | `site/compare/t3-code/index.html` | phase list |
| 17 | `site/compare/claude-code/index.html:346` | "Ideation → spec → tickets → build → review → shipped" |
| 18–20 | `packages/skills/packs/runcastle/skills/{ideate,spec,tickets,converge,revisit,waypoint}/SKILL.md` | phase rules in agent prompts (6 files) |
| + | `packages/skills/README.md:7` | the skill roster |

**One pipeline change → up to 20 hand edits, in 5 different file formats, none of
which any tool checks against `pipeline.ts`.** This is the single largest
consistency liability in the periphery, and it is exactly how the skill-count
drift in D2 happened. Minimum viable fix: generate the site's phase and gate
tables from `pipeline.ts` at build time (the build step already exists), which
retires rows 10–17 — 8 of the 20.

---

## D. Inconsistencies & structural smells

### E2E-FINDINGS.md status

**Method note (important):** the parent's hint that code comments corroborate
these findings is **wrong**, and following it would have produced false FIXED
verdicts. `grep -rn "findings F[0-9]"` resolves to a **different document** —
`docs/features/identify-random-issues-throughout-the-system/findings.md` — whose
F-numbers mean different bugs. Proof:

| citation | resolves to `identify-random-issues/findings.md` | `E2E-FINDINGS.md` says |
|---|---|---|
| `packages/core/src/schemas.ts:30` "rendered the whole app as a blank page (findings F19)" | `findings.md:82` **F19 — Unknown `phase` value blank-screens the entire app** ✅ exact match | F19 = `.sandcastle/worktrees/` not gitignored ❌ |
| `packages/core/src/pipeline.ts:91` "(findings F24)" | `findings.md:107` **F24 — Gate override silently advances the phase, cannot be undone** ✅ | E2E has no F24 (stops at F19) ❌ |
| `packages/server/src/services/features.ts:558` "(findings F3)" | `findings.md:49` F3 — Rethink during a test drive wedges the feature ✅ | F3 = git-identity Continue button ❌ |

So **E2E-FINDINGS.md is cited by no code at all.** Every verdict below was
established by reading the current source directly.

| # | Short title | Status | Evidence (current code) |
|---|---|---|---|
| F1 | doctor probe reads boot-time `process.env`, so a just-captured token still reads "unset" | **STILL OPEN** | `trpc/routers/setup.ts:30-33` passes only `exec` + `imageName`; `doctor/doctor.ts:281` `const processEnv = env.env ?? process.env`; the merge helper `doctor/cli.ts:22-34 envWithToken()` is used only by the CLI (`cli.ts:61`) |
| F2 | token messages hardcode `~/.runcastle/.env` while writing to `envPath()` | **STILL OPEN** | `services/setup.ts:299,308,322,327`; `doctor/doctor.ts:270`; `workflows/ticket-burner.ts:79`; `workflows/research.ts:53` — 7 literals |
| F3 | git-identity Continue greys out with no inline reason | **STILL OPEN** | `FirstRunWizard.tsx:163` `const valid = name.trim() !== '' && email.includes('@')` — gates the button; no error node rendered near `:188-194` |
| F4 | AFK token in a plaintext input | **STILL OPEN** | `EnableAfkCard.tsx:218-222` `<input id="afk-token-input" className="op-input mono" …>` — no `type="password"` |
| F5 | `claude setup-token` terminal never torn down after capture | **STILL OPEN (lower conf.)** | no kill/close path found in `EnableAfkCard.tsx`; only a card-level dismiss (`:18`). Not conclusively traced through the PTY registry |
| F6 | prepare session double-consents every command | **STILL OPEN — now deliberate** | `launcher/artifacts.ts:668-670` `sessionBashAllowRules` returns git-only rules; `:641-642` comment now states *"Deliberately git-only — nothing here loosens beyond git + the runcastle MCP tools"*. Behaviour unchanged; it has been reclassified as a decision, not fixed |
| F7 | no `{{port}}` drive variable → one test drive at a time on fixed-PORT projects | **STILL OPEN** | `services/drive-env.ts:59-65` `driveVars` returns `{ slug, branch, id }` only |
| F8 | `dev:tool onboarding git clear` refuses to run before the dev DB exists | **STILL OPEN** | `scripts/devtool.ts:95-100` the `!existsSync(dbPath())` bail runs for every command except `reset`; `git clear` dispatches later at `:133` |
| F9 | a live prep session waiting on you is invisible from the project view | **STILL OPEN** | `apps/web/src/lib/project-workspace.ts:152-181` `prepRailRow(view: { prepared; pendingCount; staleCount })` — still no live-session input |
| F10 | db-per-branch recipe is POSIX-only, breaks on Windows | **STILL OPEN** | `launcher/artifacts.ts:418-421` still emits `driveSetupCommand: createdb "$DB_NAME" && npm run migrate`; `services/drive-hooks.ts:84` still spawns `process.env.ComSpec ?? 'cmd.exe'` on Windows; hook command strings still un-templated |
| F11 | `Bun.serve` has no `idleTimeout`, so any request >10 s is dropped | **STILL OPEN** | `packages/server/src/index.ts:105-112` — `Bun.serve({ port, fetch, websocket })`, no `idleTimeout`; `services/drive-hooks.ts:24` `DRIVE_HOOK_TIMEOUT_MS = 10 * 60_000` |
| F12 | the word "verified" means two things on the same row | **STILL OPEN (mitigated)** | `PreparationWorkspace.tsx:386` still renders literal `'verified'` for `source === 'session'`; `:339` `VerificationBadge` separately renders verified/unverified. Only `title=` tooltips were added (`:333-337`, `:373-381`) — the two words still coexist |
| F13 | re-recording a key silently drops its verification stamp | **STILL OPEN** | `services/findings.ts:100` `const UNVERIFIED = { verifiedAt: null, verifiedSha: null }`; no "changed since it was proven" affordance in `PreparationWorkspace.tsx` |
| F14 | SSE stream reaped by Bun before its own heartbeat can fire | **STILL OPEN** | `routes/stream.ts:31` `HEARTBEAT_MS = 25_000` vs the missing `idleTimeout` at `index.ts:105` (Bun default 10 s). Same one-line defect as F11 |
| F15 | burn sandboxes get no database | **STILL OPEN** | `driveEnv` appears **nowhere** in `workflows/ticket-burner.ts` (grep: 0 hits); still host-only |
| F16 | `detectDbDrift` asserts something false for db-per-branch projects | **STILL OPEN** | `services/git.ts:1983-2012` — no `driveEnv` condition; `:2005` still emits *"anything you migrated during the drive is still applied to your dev database"* and offers the destructive `resetCommand` |
| F17 | nothing tells you a long burn finished; `notify off` is the default | **STILL OPEN** | `apps/web/src/lib/use-notifications.ts:36-42` `readPref()` returns `localStorage.getItem(STORAGE_KEY) === 'on'` → **false by default**; `lib/notifications.ts:65-66` `state: 'off', label: 'notify off'` |
| F18 | "Resolve with agent" cannot resolve anything — its own hook denies the write | **STILL OPEN** | `apps/web/src/lib/feature-ui.ts:457-466` `mergeConflictKickoff` still orders *"resolve every conflict … and commit the merge"* to a `revisit` session; `launcher/edit-guard.ts:36-37` `guardsEdits(kind) { return kind !== 'project' }`; `edit-guard.ts:63-89` denies any path outside `docs/features/<slug>/` — **no conflict exemption exists** in `edit-guard.ts` or `routes/hooks.ts:308-330`. Same for `ticketConflictKickoff` (`feature-ui.ts:482-500`) |
| F19 | `.sandcastle/worktrees/` written into the user's repo and not gitignored | **STILL OPEN** | `workflows/ticket-burner.ts:68` *"Sandcastle's `branch` strategy keys its `.sandcastle/worktrees/<branch>`"*, `:955` `BURN_WORKTREE_PATH = /[\\/]\.sandcastle[\\/]worktrees[\\/]/i`. **No code anywhere writes a project `.gitignore`** (repo-wide grep for `gitignore` in `packages/server/src`, `apps/web/src`, `scripts` → only `scripts/smoke.ts:171`, which writes one for its own throwaway test repo). runcastle's *own* `.gitignore:24` has the entry — a self-fix that does not help any user project |
| — | 5 "minor paper cuts" (session chip label, "Burn N tickets" count, not-ready banner, wizard step rail, Established list vanishing) | **UNVERIFIABLE STATICALLY** | each is a rendered-state/timing observation; the underlying components exist but the symptom needs a running app |

**Headline count: 0 fixed / 19 still open / 5 paper cuts unverifiable.**

**Still-open list the parent must surface (live bugs, ranked by blast radius):**

1. **F11 + F14 — missing `Bun.serve` `idleTimeout`** (`packages/server/src/index.ts:105`).
   One line. Kills every SSE live update on a ~13 s reconnect cycle and drops any
   tRPC/MCP call over 10 s, while the drive-hook budget next door is 10 **minutes**
   (`drive-hooks.ts:24`). Highest value-per-effort item in this entire report.
2. **F18 — agent-assisted conflict resolution is structurally impossible.**
   Advertised on `README.md:121-123` and pictured in `mock-review.png`. The
   kickoff orders a write the guard unconditionally denies.
3. **F19 — `.sandcastle/worktrees/` is swept into user commits by `git add -A`**
   (which the burn agents themselves run).
4. **F10 — database-per-branch is broken out of the box on Windows**, because
   runcastle's own prompt hands the agent a `$VAR` recipe that `cmd.exe` passes
   through literally.
5. **F16 — the db-drift banner asserts the opposite of what happened** on
   db-per-branch projects and offers a destructive rebuild for a non-problem.
6. **F1, F7, F9, F15, F17** — user-visible correctness/UX defects, all confirmed present.

### D1. `stale:e2e-findings` — kind: violation — confidence: high — effort S, risk low

`E2E-FINDINGS.md` (26 KB, root of the repo, last touched `03f6af4` on 2026-08-06)
is a **100%-unactioned backlog masquerading as documentation**. Nineteen findings,
three self-labelled HIGH, **zero fixed**, no status column, no issue links, no
"open/closed" marker anywhere. It sits beside `README.md` and `CONTEXT.md` — files
that describe how things *are* — while describing things that are *wrong*. A
reader cannot tell which of its 19 claims still hold without doing the work I just
did. Either its findings become GitHub issues (`docs/agents/issue-tracker.md` says
issues live in GitHub Issues via `gh`) and the file gets a status column, or it
moves under `docs/features/` where the other findings log already lives.

### D2. `ambiguous:findings-citations` — kind: violation — confidence: high — effort S, risk low

**Two findings logs share one numbering space**, and 60+ code comments cite the
namespace without qualifying which:

- `docs/features/identify-random-issues-throughout-the-system/findings.md` — F1–F25 + sub-ids. **This is the cited one.**
- `E2E-FINDINGS.md` — F1–F19. **Cited by nothing.**

A maintainer reading `packages/server/src/services/features.ts:558`
(`// bumped (findings F3)`) and opening the root-level, more discoverable
`E2E-FINDINGS.md` reads *"Git-identity step disables Continue with no reason
shown"* — nonsense for that code. Citations F20–F25 (`pipeline.ts:91`,
`gates.ts:210`, `git.ts:734`, `feature.ts:135,182`, `Inspector.tsx:26,125`,
`MergeFeatureDialog.tsx:6`, and 10 test files) have **no match at all** in
`E2E-FINDINGS.md`. Fix: prefix the namespace at every citation
(`findings/random-issues F19`) or renumber one log.

### D3. `stale:skill-attribution` — kind: violation — confidence: high — effort S, risk low

The public attribution claim is wrong, and it is wrong in the file the site links
to as proof. There are **8** skills on disk:

```
packages/skills/packs/runcastle/skills/{converge,ideate,project,qa,revisit,spec,tickets,waypoint}/SKILL.md
```

**6 of the 8** carry a `<!-- Forked from Matt Pocock's … -->` provenance header —
including `project`:
```
project/SKILL.md: <!-- Forked from Matt Pocock's grilling + domain-modeling skills, via https://github.com/mattpocock/skills, 2026-07-14, adapted for runcastle's project-level session -->
```
`revisit` and `waypoint` have none. But three documents say "six skills, five forks":

- `packages/skills/NOTICE.md:5-8` — *"Five of the six pack skills carry this lineage: `ideate`, `spec`, `tickets`, `qa`, and `converge` … `waypoint` is original runcastle work"* — **wrong count (8 not 6), omits the forked `project`, omits `revisit` entirely.**
- `packages/skills/README.md:7` — *"our forked skills (ideate, spec, tickets, qa, waypoint, converge)"* — same six, omits `project` and `revisit`.
- `site/compare/claude-code/index.html:149-157` — repeats it **verbatim to the public**: *"Five of runcastle's six skill pack skills … Only `waypoint` is original work"*, and links to `NOTICE.md` at `:155-156` as the citation.

`NOTICE.md` is the MIT-attribution document. Under-crediting an actual fork in it,
and then pointing the public at it as proof, is the one finding here with a legal
edge. Corroborated by ground truth: `packages/core/src/schemas.ts:58` SessionKind
= 7 kinds (`ideation, qa, waypoint, converge, revisit, prepare, project`) — the
`project` and `revisit` kinds each have a skill; the docs were written when they
did not.

### D4. `drift:site-prerequisites` — kind: violation — confidence: high — effort S, risk low

`site/compare/claude-code/index.html:210-215`:
> *"runcastle's **interactive phases need only Bun, Git, and Claude Code**, but unattended ticket-burning needs Docker or Podman…"*

Contradicted by `README.md:71`:
> *"**Node.js 22+** — **Windows only.** The embedded terminal uses a `node`-hosted PTY sidecar… **Windows without `node` on PATH gets terminals that instantly exit.**"*

and by `site/docs/index.html:168-172`, which lists Node.js 22+ correctly. The
compare page is the one that is wrong, and it is wrong in the exact paragraph
addressed to *"you work on someone else's locked-down machine"* — the reader
least able to install Node. A Windows visitor who believes it gets terminals that
instantly exit.

### D5. `drift:site-drive-port` — kind: judgement call — confidence: medium — effort M (fix the code) / S (fix the copy), risk low

Four surfaces promise a per-drive port:
- `README.md:112` — *"you test drive the branch **on its own port**"*
- `site/docs/pipeline/index.html:239` — *"starts it **on its own port**"*
- `site/docs/gates/index.html:208-209` — *"starts it **on its own port**"*
- `site/compare/claude-code/index.html:313` — same

But `services/drive-env.ts:59-65` exposes only `{ slug, branch, id }` — there is
**no `{{port}}` variable**, so a project whose dev server takes a fixed `PORT` can
only ever have one drive up (this is E2E F7, which cites the README promise by
name). "Its own port" is defensible as "the project's dev-server port, not your
main checkout's" — hence judgement call, not violation — but it reads as
port-per-drive, and the parallelism the same pages sell (`site/docs/pipeline/index.html:251-255`
*"Several features, same loop"*) makes that reading the natural one.

### D6. `stale:site-app-ui-css` — kind: violation — confidence: high — effort S, risk low

**Confirmed and quantified.** `site/assets/app-ui.css` is generated from
`apps/web/src/styles.css` by `site/build-app-css.mjs` (banner at
`build-app-css.mjs:157-162`: *"GENERATED by site/build-app-css.mjs, do not edit by
hand… Regenerate after changing app styles"*).

- Last regenerated in `ca416e1` (**2026-07-25**). `apps/web/src/styles.css` has
  changed in **47 commits since** (`git log --oneline ca416e1..HEAD -- apps/web/src/styles.css | wc -l` → 47).
- **Not gitignored** — `.gitignore` has no `site/` or `app-ui` entry, so the stale
  artifact is committed and diffs on every regeneration.
- **Wired into nothing.** Referenced only from `site/README.md:10` and `:166`. Not
  in any of root `package.json`'s 7 scripts (`dev, dev:tool, typecheck, test,
  test:watch, release, postinstall`), and the repo's only workflow
  (`.github/workflows/release.yml`) never invokes it.

**Is the drift visible? Yes, and it is large.** Comparing top-level class
selectors:

| | count |
|---|---|
| classes in `apps/web/src/styles.css` | 613 |
| classes in `site/assets/app-ui.css` | 479 |
| **in the product, MISSING from the site copy** | **153** |
| in the site copy, GONE from the product | 19 |

**~25% of the product's class surface is absent** from the stylesheet that styles
the landing page's "real runcastle UI". Missing families include the entire
directory picker (`.dir-list .dir-item .dir-crumbs .dir-rail .dir-picker-*` — ~15
classes), `.app-frame`/`.app-frame-body`, `.conflict-head`/`.conflict-when`,
`.cmdk-item-current`, `.act-detail`/`.act-more`, `.afk-verdict-fix`. Any mockup
using those renders unstyled.

**Would the generator still run correctly today? Yes.** Its stated correctness
invariant (`build-app-css.mjs:14`: *"The product sheet is flat (no nesting, only
`@keyframes` and `@media`)"*) still holds: `apps/web/src/styles.css` has **0**
nesting markers and its only top-level at-rules are `@keyframes` (×9) and
`@media` (×1) — both handled at `build-app-css.mjs:133,139`. So this is pure
neglect, not a broken tool. **Fix is one line**: add
`"site:css": "node site/build-app-css.mjs"` to root `package.json` and either run
it in CI with a `git diff --exit-code` check, or drop `site/assets/app-ui.css`
from git and generate it at deploy.

### D7. `divergent:site-readme-overlap` — kind: judgement call — confidence: high — effort M, risk low

`README.md` and `site/docs/index.html` are **the same document in two formats**,
maintained by hand:

| Content | README.md | site/docs/index.html |
|---|---|---|
| one-line positioning | `:13` | `:101-104` |
| 3-line install block | `:49-53` | `:119-121` |
| `--version` / update-banner paragraph | `:55-57` | `:123-127` |
| prerequisites table | `:66-72` | `:137-177` |
| platform baselines | `:73` | `:179-181` |
| AFK token + container paragraph | `:75-81` | `:184-198` |
| first-run 3 steps | `:83-93` | `:201-213` |
| the loop / phase table | `:106-114` | `:216+` |
| "how it works" 5 bullets | `:190-206` | `:236-243` |
| troubleshooting (AFK auth) | `:347-354` | `:267` |

They have **already diverged** once (D4: the compare page dropped the Node
requirement the README carries). This is where the next drift will come from.
Given C1/C2 already argue for a `site/build.mjs`, the cheap consolidation is to
make the shared blocks partials sourced from one markdown file.

### D8. `inconsistent:npm-in-a-bun-repo` — kind: judgement call — confidence: medium — effort S, risk low

`CLAUDE.md` conventions: *"Bun everywhere (`bun add`, `bunx`); never npm/yarn/pnpm."*
Adjacent to my scope, the release path uses `npm publish` (`release.yml:91`),
`npm view`-style checks (`:84-88`) and `node -p` (`:77-78`). `npm publish` for
registry publication is defensible (Bun's publish path has different provenance
support), and `site/build-app-css.mjs` is deliberately `node`-run so the site
builds without Bun — but neither exception is written down anywhere, so it reads
as a convention violation to any reader of `CLAUDE.md`. One line in `CLAUDE.md`
retires the ambiguity. Flagged low-confidence because the sibling scope owning
`.github/` should adjudicate.

---

## E. Wrong-tool & weak-typing findings

Not applicable in any meaningful way — `site/` contains exactly one JS file
(`build-app-css.mjs`, 169 lines, plain ESM, `node:fs`/`node:path` only, no `any`,
no deps) plus `site/main.js` (11 KB). `build-app-css.mjs` is a hand-rolled CSS
parser rather than a real one (`postcss`), which is normally a wrong-tool finding
— but it explicitly states and depends on a checked invariant
(`build-app-css.mjs:14`, *"the product sheet is flat"*), handles comments and
strings when tracking brace depth (`:67-79`), and I verified the invariant still
holds. **Correct call for a zero-dependency site build. No finding.**

One nit, `weak:build-css-invariant` — kind: judgement call — confidence: high —
effort S, risk low: the invariant is enforced by nothing. If someone adds
`@layer` or `@container` to `apps/web/src/styles.css`, `transform()` falls through
the `@keyframes|@media` guards at `:133,139` into `scopeRule()`, which will emit
`.rc-app @layer foo { … }` — silently invalid CSS, no error. A 3-line assertion
(reject any top-level `@` that is not in the known set) makes the invariant
self-enforcing.

---

## F. Shallow modules / deletion-test candidates

Nothing in `site/` qualifies. `build-app-css.mjs` passes the deletion test
decisively: delete it and the alternative is hand-maintaining a 3263-line scoped
copy of a 3859-line stylesheet forever. It has a one-line interface
(`node site/build-app-css.mjs`) behind real transformation work — a deep module.
Its problem is that **nothing calls it** (D6), not that it is shallow.

---

## G. Deepening / consolidation / extraction opportunities (ranked)

| # | Opportunity | Key | Why | Effort | Blast radius |
|---|---|---|---|---|---|
| 1 | **Wire `build-app-css.mjs` into `package.json` + CI drift check** | `stale:site-app-ui-css` | Trivially small, converts a silent 47-commit rot into a build failure. 153 missing classes today. Two callers already exist conceptually (dev regeneration + release) | **S** | `package.json`, `release.yml`, one regenerated asset |
| 2 | **`site/build.mjs` + `site/partials/` for head/header/footer/sub-navs** | `redundant:site-page-chrome`, `redundant:compare-page-template` | ~500 lines of byte-identical chrome across 8 pages (~14% of site HTML); nav edits are 8-file edits today. **Extends the build step that already exists** — no new tooling | **M** | all 8 pages, no runtime change (static output identical) |
| 3 | **Generate the phase + gate tables from `packages/core/src/pipeline.ts`** | `shotgun:pipeline-description` | Retires 8 of 20 hand-written pipeline locations (site rows 10–17). With #2's build step in place this is a data-in-template change, not new machinery | **M** | `site/docs/{pipeline,gates}/`, `site/index.html`, `site/compare/*` |
| 4 | **Fix `NOTICE.md` / `skills/README.md` / compare page to the real 8 skills / 6 forks** | `stale:skill-attribution` | Attribution accuracy on an MIT-lineage document the public page cites as proof. Pure text | **S** | 3 files |
| 5 | **Give `E2E-FINDINGS.md` a status column and namespace the F-ids** | `stale:e2e-findings`, `ambiguous:findings-citations` | 19 open findings currently indistinguishable from fixed ones; 60+ code comments cite an ambiguous namespace | **S** (status) / **M** (renumber) | 1 doc, or 1 doc + ~60 comments |
| 6 | **Single-source README ↔ `site/docs/index.html`** | `divergent:site-readme-overlap` | 10 duplicated content blocks that have already drifted once (D4). Depends on #2 | **M** | `README.md`, `site/docs/index.html` |
| 7 | Delete the 4 orphaned assets | `dead:site-orphan-assets` | 124 KB, verified repo-wide | **S** | 4 files |
| 8 | Assert the flat-CSS invariant in `build-app-css.mjs` | `weak:build-css-invariant` | 3 lines; prevents silently-invalid generated CSS | **S** | 1 file |

**Deliberately excluded from this ranking:** the 11.5 MB
`site/assets/video/runcastle-demo-1440.mp4` committed to git. It is genuinely
referenced from `site/index.html` and 11.5 MB is a defensible price for a landing
demo; whether it belongs in git rather than a CDN is a hosting decision this scope
cannot adjudicate. Flagging for the parent as `judgement call`, confidence medium:
**88% of the site's 13 MB is that one file**, and every clone of the repo pays for
it forever.

---

## H. Cross-cutting candidates to pass UP

These are the ones I expect sibling scopes to have hit independently. Matched by
canonical key.

1. **`shotgun:pipeline-description`** — kind: judgement call — confidence: high.
   The 6 phases / 5 gates / 7 session kinds are hand-written prose in **20
   locations** across 5 file formats (site ×8, docs ×5, skill packs ×6,
   `feature-ui.ts` ×1) against one source (`packages/core/src/pipeline.ts`).
   **Any scope auditing `packages/skills`, `docs/`, or `apps/web` will name a
   subset of this list.** Suspected shared module: a generated
   phase/gate/session-kind reference emitted from `pipeline.ts` + `schemas.ts`.
   Promote to a repo-wide finding — no single scope sees all 20.

2. **`ambiguous:findings-citations`** — kind: violation — confidence: high.
   Two findings logs share the F1–F25 namespace; **60+ `(findings FN)` comments
   across `packages/core`, `packages/server`, `apps/web` and 10 test files** cite
   it unqualified, and the root-level `E2E-FINDINGS.md` is the more discoverable
   of the two while being the wrong one. Every sibling scope is reading these
   comments; several will have taken them at face value. **Warn siblings
   explicitly: `(findings FN)` resolves to
   `docs/features/identify-random-issues-throughout-the-system/findings.md`, NOT
   `E2E-FINDINGS.md`.**

3. **`stale:e2e-findings`** — kind: violation — confidence: high. 19 findings,
   **0 fixed**, 6 of them live bugs (F11/F14, F18, F19, F10, F16 + the F1/F7/F9/F15/F17
   cluster). The server, web and core scopes will each independently rediscover
   *some* of these — F11/F14 (`server/src/index.ts:105`) and F18
   (`launcher/edit-guard.ts` ↔ `apps/web/src/lib/feature-ui.ts:457`) are
   **cross-scope by construction**, since the defect spans server and web. The
   parent should treat my table as the authoritative merge target so the same bug
   is not filed three times under three names.

4. **`redundant:page-chrome` / `redundant:template-boilerplate`** — kind:
   judgement call — confidence: medium for the cross-cut. Inside `site/` this is
   copy-pasted HTML; the equivalent smell in `apps/web` would be repeated
   page-shell/panel scaffolding, and in `packages/skills` repeated SKILL.md
   preamble blocks. **Worth asking the skills and web leaves whether they saw a
   duplicated header/preamble block** — if yes, this becomes one repo-wide
   "no template layer anywhere" finding rather than three local ones.

5. **`stale:generated-artifact-uncheckedin-ci`** — kind: violation — confidence:
   high. `site/assets/app-ui.css` is a committed generated file whose generator is
   in no script and no CI job, 47 commits stale. **The general shape — "generated
   artifact committed, generator unwired, no drift check" — is worth checking
   against `packages/server/drizzle/` (migrations/meta), `vendor/`, and any
   design-system token output.** If a sibling found a second instance, this is a
   repo-wide CI gap: the repo has exactly one workflow (`release.yml`) and **no CI
   on push/PR at all**, so nothing anywhere catches generated-artifact drift.

6. **`drift:doc-vs-code-counts`** — kind: violation — confidence: high. The
   "5 of 6 skills" claim is wrong in three files at once (`NOTICE.md:5-8`,
   `skills/README.md:7`, `compare/claude-code/index.html:149`) because a
   hand-counted roster was never updated when `project` and `revisit` were added.
   **Any scope auditing docs should grep for hand-counted inventories** — phase
   counts, gate counts, skill counts, session-kind counts, MCP tool counts
   (`CLAUDE.md` says "4 MCP tools"; the live server exposes ~15). That last one
   is outside my scope but visible from the tool list — **flagging it for the
   server/docs leaf as a likely second instance of the same smell.**

---

*Section I omitted — nothing is being removed.*
