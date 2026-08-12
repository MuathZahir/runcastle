# Audit report — doc/contract drift (leaf scope: `docs/**`, `CLAUDE.md`, `README.md`, `CONTEXT.md`, `packages/skills/**` markdown)

Scope: documents that claim to pin contracts, verified against actual source.
Every claim below was checked in code. `file:line` is given on both sides.

**Ruling convention used throughout** (per assignment): SPEC names are law, so a
code name differing from SPEC is a CODE finding *unless* an ADR or
`docs/research/CORRECTIONS.md` overrides it. In practice **no ADR or CORRECTIONS
entry covers any of the tRPC/MCP/schema divergences below** — but SPEC.md carries
its own self-demotion at `docs/SPEC.md:3-6`:

> "**Build-time document.** … it may describe states the code has since moved
> past. **The code and README are authoritative for current behavior.**"

That header is the repo's own override of "names are law", and it is the single
most important fact in this report: it converts almost every finding here from
"code violates the contract" into "doc wrong (code is current)" — while
simultaneously meaning **the repo currently has no living contract document at
all**. Section H carries that up as the headline cross-cutting item.

---

## A. Flow map

How contract knowledge is supposed to flow, and where it actually flows:

```
INTENDED (per CLAUDE.md:7-13, SPEC.md:8)
  CONTEXT.md (vision + locked decisions)
        │  is higher law than
        ▼
  docs/SPEC.md (names are law: schemas, tRPC map, gates, MCP tools, ownership)
        │  format details overridden by
        ▼
  docs/research/*.md ──(record the correction)──► docs/research/CORRECTIONS.md
        │
        ▼
  code (packages/core contracts → server → apps/web)

ACTUAL (verified)
  CONTEXT.md ────────────► still tracks code well (decisions 7/9/13/15 all hold)
  docs/adr/0001..0010 ───► track code well; SPEC §13/§14/§15 were written FROM them
  docs/SPEC.md §0-§12 ───► M1-era; ~40% of its named contracts no longer exist
  docs/UI-SPEC.md ───────► v2-era; superseded by the pipeline-first redesign
  CLAUDE.md ─────────────► build-wave document; its ownership table is fiction
  docs/research/CORRECTIONS.md ─► frozen at C1/C2/C3 (M1); records ZERO of the
                                   ~35 post-M1 divergences below
  README.md ─────────────► THE most accurate document in the repo; but it renames
                            a pinned enum value (implementation → "build")
  packages/skills/**.md ─► fully current: every MCP tool it names exists
```

**Key structural observation:** `CORRECTIONS.md` is the designated drift ledger
(`CLAUDE.md:12-13`, `SPEC.md:8`) and it has three entries, all from wave A/B of
M1. Everything shipped since (mapped ideation, prep, laps, projects, quick-change,
per-ticket burn controls, setup wizard, archive/delete, test notes) landed with no
correction recorded. The mechanism the repo designed to prevent exactly this drift
was never used after M1.

**Second observation:** the docs that stayed accurate are the ones written *from*
decisions (`CONTEXT.md`, `docs/adr/*`) or *for users* (`README.md`,
`packages/skills/**`). The docs that rotted are the ones written *for build
coordination* (`SPEC.md`, `UI-SPEC.md`, `CLAUDE.md`). That is a clean signal about
which document genres are worth maintaining here.

---

## B. Dead code (docs describing things that no longer exist at all)

### B1. `FeatureSize` / `size` / `collapsed` — an entire pinned concept, deleted
`violation` · key `dead-doc:feature-size` · confidence **high**

- Doc: `docs/SPEC.md:39` — `FeatureSize = z.enum(['full','collapsed'])` (collapsed = small feature, skips `spec` phase)
- Doc: `docs/SPEC.md:46` — `Feature { … size, … }`
- Doc: `docs/SPEC.md:58` — `nextPhase(feature: {phase, size}): Phase | null` respecting collapsed skipping `spec`
- Doc: `docs/SPEC.md:117` (§4 `feature.create({ title, oneLiner, size, baseBranch? })`), `:199` ("size toggle")
- Doc: `docs/UI-SPEC.md:41` ("size toggle"), `:44` ("collapsed size renders spec as skipped")
- Doc: `docs/SPEC.md:232` (§13.1) — "`Feature` gains `mapped: boolean` … independent of `size`"
- Doc: `packages/skills/packs/runcastle/skills/converge/…` reachable prose via `packages/server/src/launcher/artifacts.ts:248` — "run `/runcastle:spec` (for a `full` feature)"
- Code: `packages/core/src/schemas.ts` — **no `FeatureSize` export exists**; `grep -rn "FeatureSize" packages/` returns zero hits outside tests.
- Code: `packages/core/src/pipeline.ts:79` — `export function nextPhase(feature: { phase: Phase }): Phase | null` — no `size` param, no collapsed skip.
- Code: `packages/server/src/trpc/routers/feature.ts:22-28` — `create` input is `{ projectId, title, oneLiner, baseBranch? }`; **no `size`**.
- Proof of deliberate removal: `packages/server/test/feature-size-drop.test.ts:16-19` — *"The `size`/`collapsed` concept was removed (ticket 1). Migration 0008 drops … no collapsed skip remains."*

**Which way it drifts: doc wrong (code is current).** The removal is deliberate,
tested, and migration-backed. Six separate doc sites still describe it.
Note the stale reference reaches *runtime*: `artifacts.ts:248` injects the phrase
"for a `full` feature" into every converge session's system prompt, so an agent is
told about a feature attribute that cannot exist.

### B2. `NotImplementedError` wave-B stub protocol — never constructed
`violation` · key `dead-doc:wave-ownership` · confidence **high**

- Doc: `CLAUDE.md:21` — "`NotImplementedError` stubs are wave-B sockets — replace, don't redesign."
- Doc: `CLAUDE.md:46` — "A1 creates B-owned files as typed stubs (`throw new NotImplementedError('B1')`) so typecheck + the UI work end-to-end before wave B lands."
- Doc: `CLAUDE.md:61` — `src/trpc/*` … "B-owned behavior throws NotImplementedError"
- Doc: `docs/SPEC.md:97` (§3 ownership tree) and `docs/SPEC.md:110` (§3, same sentence); `docs/SPEC.md:212` (§12, same convention)
- Code: `new NotImplementedError` = **0 hits** repo-wide (confirmed by orchestrator; re-verified).
- Stale comments left behind in code: `packages/server/src/trpc/routers/feature.ts:55` ("B1 behavior — the stub throws NotImplementedError('B1')"), `:168` ("B2 behavior — the git stub throws NotImplementedError('B2')").
- Dead "B2 tolerance" block: `packages/server/src/services/projects.ts:166-190`.

**Which way it drifts: doc wrong (code is current)** — the waves finished. But note
the code side also carries the fossil (two comments + one dead block), so this is a
two-sided cleanup, catalogued here as one cluster per the assignment.

### B3. `project.get` / `project.init` — the two procedures SPEC opens §4 with
`violation` · key `dead-doc:trpc-project` · confidence **high**

- Doc: `docs/SPEC.md:116` — `project.get(): Project | null`
- Doc: `docs/SPEC.md:117` — `project.init({ repoPath: string }): Project`
- Doc: `docs/SPEC.md:206` — smoke walk "→ project.init → feature.create →"
- Doc: `docs/SPEC.md:199` — "Home: project init form (repoPath input) if none"
- Code: `packages/server/src/trpc/routers/project.ts:13-113` — the router has `list, roots, browse, branches, open, close, rename, talkToPrep, prepSession, talkToProject, projectSession, prep, dryRunStop`. **Neither `get` nor `init` exists.** `open` (`project.ts:40`) is the successor to `init`; `list` (`project.ts:13`) is the successor to `get`.

**Which way it drifts: doc wrong (code is current).** The rename is the
multi-project move (CONTEXT.md "Deferred / open threads" — *"Multi-project — in
flight via the publish wayfinder map"*), which the code has since landed. Singular
`project.get()` is structurally incompatible with the multi-project workspace the
app now is, so this is not recoverable as a code fix.

### B4. `feature.testNote` / `feature.promoteNote` — moved to a router SPEC does not name
`violation` · key `dead-doc:trpc-notes` · confidence **high**

- Doc: `docs/SPEC.md:397` — `feature.testNote({ featureId, text }): { ok }`
- Doc: `docs/SPEC.md:400` — `feature.promoteNote({ featureId, lap, index }): { ticketId }`
- Doc: `docs/SPEC.md:451`, `:457` (§15.6 UI amendments call both by those names)
- Code: `packages/server/src/trpc/routers/feature.ts` — **no `testNote`, no `promoteNote`.**
- Code: `packages/server/src/trpc/router.ts:24` — `notes: testNotesRouter`
- Code: `packages/server/src/trpc/routers/test-notes.ts:24,28,32,36,40,46` — `list, add, edit, remove, toggle, promote`.

**Which way it drifts: ambiguous — needs a human.** SPEC §15 is the *newest*
section of the spec (ADR-0010, accepted 2026-07-28) and it names these on the
feature router. The code moved them to a `notes` router and *grew* the surface
(`edit`, `remove`, `toggle` did not exist in §15 at all). Given §15's recency this
looks like a real post-spec redesign nobody wrote down, not decay — but there is no
ADR or CORRECTIONS entry recording the move, so a human should decide whether the
spec section gets amended or the router renamed. The file/format contract from
§15.2 (`docs/features/<slug>/test-notes.md`, `## Lap N` headings) *is* honoured —
`packages/server/src/services/test-notes.ts` exists. Only the wire names moved.

### B5. UI-SPEC's "Pop out ↗ (relaunches in Windows Terminal)"
`violation` · key `dead-doc:pop-out` · confidence **high**

- Doc: `docs/UI-SPEC.md:52` — terminal tab strip has "`Pop out ↗` (relaunches in Windows Terminal — the old path)".
- Contradicted by the same document: `docs/UI-SPEC.md:59` — "embedded is the only mode — the legacy `window`/`wt.exe` mode is removed, see CONTEXT.md decision 13".
- Contradicted by `CONTEXT.md` decision 13 — "the legacy `wt.exe` window mode is removed".
- Code: `grep -rn "Pop out\|wt.exe\|Windows Terminal" apps/web/src packages/server/src` → the only hits are three *negative* comments in `packages/server/src/launcher/launcher.ts:66,199,928` ("cross-platform; no `wt.exe`"). No pop-out control exists in `apps/web/src`.

**Which way it drifts: doc wrong (code is current)** — and UI-SPEC is
self-contradictory *within one document*, seven lines apart.

### B6. `RUNCASTLE_LAUNCH_MODE` — an env var no code reads
`violation` · key `dead-doc:launch-mode-env` · confidence **high**

- Doc: `docs/research/POSIX-VERIFICATION.md:173` — names `RUNCASTLE_LAUNCH_MODE`.
- Code: repo-wide enumeration of `RUNCASTLE_[A-Z_]+` in `packages/`, `apps/`, `scripts/` yields 33 vars; `RUNCASTLE_LAUNCH_MODE` is **not among them**.

**Which way it drifts: doc wrong (code is current)** — collateral of the same
`window`-mode removal as B5.

---

## C. Redundancy

### C1. Four documents restate the same conventions list, and they have diverged
`judgement call` · key `redundant:conventions-block` · confidence **high**

The identical seven-bullet conventions block is maintained in three places:

| Source | Lines |
|---|---|
| `docs/SPEC.md:209-216` (§12, header at `:209`) | canonical |
| `CLAUDE.md:15-29` | verbatim restatement, plus ports/data-dir |
| `docs/features/codebase-audit/audit/BRIEFING.md:40-46` | third restatement |

They have already drifted: `SPEC.md:212` and `CLAUDE.md:21` both still carry the
dead `NotImplementedError` bullet (B2); `CLAUDE.md:29` adds "Ports: server 4512,
web 4513. Data dir: `~/.runcastle/`" which SPEC keeps at `:30-31` instead. Three
copies is why the dead bullet survived — fixing it requires three edits nobody
made. **Seam:** `CLAUDE.md` should point at SPEC §12 rather than copy it (two real
adapters exist: CLAUDE.md and the briefing).

### C2. Package map duplicated between SPEC §0 and CLAUDE.md — both now incomplete
`violation` · key `redundant:package-map` · confidence **high**

- Doc: `docs/SPEC.md:20-27` — tree lists `packages/core`, `packages/server`, `packages/skills`, `apps/web`. **Four.**
- Doc: `CLAUDE.md:33-38` — table lists the same four.
- Code: `package.json:6-9` — `workspaces: ["packages/*", "apps/*"]`; `packages/` actually contains **five** packages — `core`, `server`, `skills`, `design-system`, `web`-adjacent. `packages/design-system` (~1.2k TS lines per BRIEFING.md:27) is in **neither** doc.
- Also absent from both: `site/` and `scripts/` (`scripts/dev.ts`, `scripts/devtool.ts`, `scripts/release.ts`, `scripts/smoke.ts`, `scripts/postinstall-node-pty.ts` — all referenced by `package.json:14-20`).

**Which way it drifts: doc wrong (code is current).** Two copies, both stale in the
same way — a new package landed and neither map was touched.

---

## D. Inconsistencies & structural smells — the drift tables

### D1. tRPC procedure map: three-way table
`violation` · key `inconsistent:trpc-map-vs-spec` · confidence **high**

Doc side: `docs/SPEC.md:112-135` (§4, the pin — *"apps/web builds against exactly
this"*), plus §13.2 additions at `:243-253` and §15.2 additions at `:385-417`.
Code side: `packages/server/src/trpc/router.ts:18-29` mounts exactly
`project, feature, run, ticket, notes, events, docs, settings, setup, system`.
Verified count: **59 procedures** across `packages/server/src/trpc/routers/*.ts`
(docs 1, events 2, feature 21, project 13, run 3, settings 2, setup 5, system 2,
test-notes 6, ticket 4).

**(a) Spec-only — named in SPEC, absent from code (drift direction: doc wrong)**

| SPEC name | Doc | Code reality |
|---|---|---|
| `project.get()` | `SPEC.md:116` | gone → `project.list` (`routers/project.ts:13`) |
| `project.init({repoPath})` | `SPEC.md:117` | gone → `project.open` (`routers/project.ts:40`) |
| `feature.testNote({featureId,text})` | `SPEC.md:397` | moved → `notes.add` (`routers/test-notes.ts:28`) |
| `feature.promoteNote({featureId,lap,index})` | `SPEC.md:400` | moved → `notes.promote` (`routers/test-notes.ts:46`) |
| `feature.create({… size …})` | `SPEC.md:117` | input has no `size` (`routers/feature.ts:22-28`) — see B1 |

**(b) Code-only — exist on the wire, named nowhere in SPEC (drift: doc incomplete)**

**34 of 59 procedures are undocumented.** Grouped:

| Router | Undocumented procedures | Code |
|---|---|---|
| `project` (11 of 13) | `list, roots, browse, open, close, rename, talkToPrep, prepSession, talkToProject, projectSession, dryRunStop` | `routers/project.ts:13,23,26,40,44,48,72,79,89,94,113` |
| `feature` (8 of 21) | `quickChange, endSession, undoGateOverride, archive, unarchive, delete, commitCount` (+`driveInfo`, which *is* named — only in §7 prose at `SPEC.md:172`, not in the §4 map) | `routers/feature.ts:36,123,138,145,149,158,185,179` |
| `run` (2 of 3) | `agentTranscript, cancel` | `routers/run.ts:17,24` |
| `ticket` (4 of 4 — **whole router**) | `retry, stop, cancel, edit` | `routers/ticket.ts:30,34,48,52` |
| `notes` (6 of 6 — **whole router**) | `list, add, edit, remove, toggle, promote` | `routers/test-notes.ts:24,28,32,36,40,46` |
| `setup` (5 of 5 — **whole router**) | `doctor, runtimeGuide, gitIdentity, afkToken, startTerminal` | `routers/setup.ts:29,37,40,45,55` |
| `system` (2 of 2 — **whole router**) | `version, checkUpdate` | `routers/system.ts:11,12` |
| `events` (1 of 2) | `listByProject` | `routers/events.ts:13` |

Four entire routers (`ticket`, `notes`, `setup`, `system` — 17 procedures) do not
appear in SPEC §4/§13.2/§15.2 in any form. `feature.endSession` and `run.cancel`
are the interesting case: `docs/UI-SPEC.md:79` explicitly authorises them
("tRPC additions allowed (additive only): `feature.endSession({sessionId})`,
`run.cancel({runId})`") — so those two are *documented, just not in SPEC*, which is
itself a symptom (the pin lives in two files now).

**(c) Both-but-different — same job, different name/shape**

| SPEC | Code | Difference |
|---|---|---|
| `project.get(): Project \| null` | `project.list(): Project[]` (`routers/project.ts:13`) | singular→plural; a *shape* change forced by multi-project, not a rename |
| `project.init({repoPath})` | `project.open({…})` (`routers/project.ts:40`) | verb changed; `browse`/`roots` (`:23,:26`) now front it |
| `feature.testNote` | `notes.add` (`routers/test-notes.ts:28`) | moved routers |
| `feature.promoteNote` | `notes.promote` (`routers/test-notes.ts:46`) | moved routers |
| `feature.launchSession({featureId,kind,kickoffLine?})` | `routers/feature.ts:59` | ✅ present; SPEC `:120` matches |
| `feature.merge` / `testDrive` / `burn` / `advance` / `overrideGate` / `resendKickoff` / `get` / `list` | `routers/feature.ts:194,169,162,127,131,116,51,47` | ✅ all present and named per SPEC |
| `feature.workWaypoint` / `converge` / `rethink` | `routers/feature.ts:74,84,100` | ✅ present per §13.2/§15.2 |
| `project.branches` / `project.prep` | `routers/project.ts:36,103` | ✅ present per SPEC `:118,:119` |
| `settings.get` / `settings.update` / `docs.read` / `events.list` / `run.get` | `routers/settings.ts:13,17`; `routers/docs.ts:7`; `routers/events.ts:7`; `routers/run.ts:8` | ✅ all present |

**Verdict:** 25 of 59 procedures are spec-covered; 34 are not; 5 spec names have no
implementation. Given `SPEC.md:3-6`'s self-demotion, ruling is **doc wrong (code is
current)** for all of (a) and (b), with **B4/(the notes move) flagged ambiguous**.
The router file itself still claims the pin holds — `packages/server/src/trpc/router.ts:14-17`:
*"The app router (SPEC §4). apps/web builds against exactly this shape via
`AppRouter` — keep the procedure names/inputs aligned with §4."* That comment is
false as written and is the one code-side change I'd argue for.

### D2. Gates: doc vs `pipeline.ts` / `gates.ts`
`judgement call` · key `inconsistent:gates-doc` · confidence **high**

Doc side: `docs/SPEC.md:49-58` (§1 pipeline), amended by `:234-238` (§13.1) and
`:369-380` (§15.1). Code side: `packages/core/src/pipeline.ts:9-74` and
`packages/server/src/services/gates.ts:26-91`.

| Gate | SPEC says | Code says | Verdict |
|---|---|---|---|
| G1 → `spec` | `decisions-file-exists`; "(or `tickets` when collapsed)" (`SPEC.md:53`); §13.1 (`:234`) makes it conditional on `mapped` → `all-waypoints-terminal` | `pipeline.ts:34-40` id G1, check `decisions-file-exists`, desc "Decisions captured before writing a spec"; `gates.ts:28,31` implements **both** `decisions-file-exists` and `all-waypoints-terminal` | ✅ matches, **except** the "(or `tickets` when collapsed)" clause is dead (B1) |
| G2 → `tickets` | `spec-file-exists`, "auto-satisfied for collapsed" (`SPEC.md:54`) | `pipeline.ts:42-49`; `gates.ts:49` | ✅ matches; "auto-satisfied for collapsed" dead (B1) |
| G3 → `implementation` | `tickets-approved` (human Burn click) (`SPEC.md:55`); §15.1 (`:375-377`) scopes it to ≥1 `pending` ticket **in the current lap** | `pipeline.ts:51-58`; `gates.ts:52` | ✅ matches |
| G4 → `review` | `all-tickets-terminal` (`SPEC.md:56`) | `pipeline.ts:60-67`; `gates.ts:64` | ✅ matches |
| G5 → `shipped` | `human-merge` (`SPEC.md:57`) | `pipeline.ts:69-73`; `gates.ts:80` | ✅ matches |

**Gates are the healthiest contract in the repo** — all five ids, all six
`GateCheckId` values, and both amendments landed exactly as specified, including
the `GateCheckId`-as-identifier discipline that keeps core IO-free
(`pipeline.ts:5-7` restates the rule).

Two real divergences:

1. **`nextPhase` signature** — `SPEC.md:58` pins
   `nextPhase(feature: {phase, size}): Phase | null` *"respecting collapsed skipping
   `spec`"*; code is `pipeline.ts:79` `nextPhase(feature: { phase: Phase })` with a
   plain linear walk. **Doc wrong (code is current)** — B1.
2. **Backward transitions are undocumented in §1** — `pipeline.ts:105` exports
   `REVIEW_LOOP_BACK`, `pipeline.ts:~120` `rethinkPhase`/`RETHINK_LOOP_BACK`, and
   `pipeline.ts:96` `previousPhase`. `RETHINK_LOOP_BACK`/`rethinkPhase` *are* named
   in `SPEC.md:370-372` (§15.1) ✅. `REVIEW_LOOP_BACK` is named only in CONTEXT.md
   decision 7 prose, never in SPEC §1. `previousPhase` is named nowhere in any doc
   — its own docstring at `pipeline.ts:84-95` cites *"findings F24"* (an audit
   findings file) as its rationale, i.e. the contract for it lives in a findings
   doc, not the spec. `judgement call` · key `undocumented:pipeline-backward-transitions`.

### D3. MCP tools: 14 real vs 4-then-7 documented
`violation` · key `inconsistent:mcp-tool-count` · confidence **high**

Doc side: `docs/SPEC.md:151` — **"## 6. MCP server (B1) — 4 tools, zod-validated"**,
enumerating 4 at `:155-158`. Amended by `docs/SPEC.md:254` — **"### 13.3 MCP
amendments (§6) — 3 new tools (7 total)"**, enumerating 3 at `:256-260`. Further
`docs/SPEC.md:418` — "### 15.3 MCP amendments (§6) — no new tools". So the spec's
final count is **7**. `CLAUDE.md:66` still says **"4 MCP tools, zod-validated (§6)"** —
CLAUDE.md never absorbed §13.3 at all.

Code side: `packages/server/src/mcp/server.ts` registers **14**:

| # | Tool | `registerTool` line | Documented? |
|---|---|---|---|
| 1 | `record_finding` | `mcp/server.ts:686` | ❌ nowhere in SPEC |
| 2 | `dry_run_drive` | `mcp/server.ts:710` | ❌ nowhere in SPEC |
| 3 | `create_feature` | `mcp/server.ts:733` | ❌ nowhere in SPEC |
| 4 | `get_project_context` | `mcp/server.ts:761` | ❌ nowhere in SPEC |
| 5 | `get_work_record` | `mcp/server.ts:779` | ❌ nowhere in SPEC |
| 6 | `get_feature_context` | `mcp/server.ts:799` | ✅ `SPEC.md:155` |
| 7 | `emit_tickets` | `mcp/server.ts:814` | ✅ `SPEC.md:156` |
| 8 | `update_ticket` | `mcp/server.ts:831` | ❌ nowhere in SPEC |
| 9 | `cancel_ticket` | `mcp/server.ts:855` | ❌ nowhere in SPEC |
| 10 | `escalate_to_map` | `mcp/server.ts:872` | ✅ `SPEC.md:256` (§13.3) |
| 11 | `emit_waypoints` | `mcp/server.ts:893` | ✅ `SPEC.md:257` (§13.3) |
| 12 | `resolve_waypoint` | `mcp/server.ts:908` | ✅ `SPEC.md:258` (§13.3) |
| 13 | `record_event` | `mcp/server.ts:925` | ✅ `SPEC.md:157` |
| 14 | `complete_phase` | `mcp/server.ts:941` | ✅ `SPEC.md:158` |

**7 of 14 tools are undocumented (50%).** All 7 documented tools exist under their
documented names — no renames, no shape breaks found. The undocumented 7 are the
project-session / prep / ticket-surgery generation (`create_feature`,
`get_project_context`, `record_finding`, `dry_run_drive`, `get_work_record`,
`update_ticket`, `cancel_ticket`) — i.e. exactly the features shipped after §13/§15
were written.

Behavioural contracts that **did** hold, verified:
- `SPEC.md:156` + `CORRECTIONS.md` C3 — `emit_tickets` emits the single event
  `tickets.stored`, not a second `tickets.emitted`. ✅ (C3's resolution is the
  authority; SPEC prose was corrected there.)
- `SPEC.md:158` + C3 — `complete_phase` never crosses G3. ✅ C3 documents the
  `mcp/server.ts#toolCompletePhase` short-circuit.
- `SPEC.md:261` — "Claiming is NEVER agent-callable" — no `claim_waypoint` tool
  exists among the 14. ✅

**Which way it drifts: doc wrong (code is current)** for the 7 additions;
**CLAUDE.md:66 is doubly wrong** (it says 4 where the spec itself says 7 and the
code has 14).

### D4. MCP tool names in `packages/skills/**` — all verified present
`violation` (as a *negative* finding: nothing wrong) · key `verified:skills-mcp-names` · confidence **high**

Enumerated every `mcp__runcastle__*` reference in `packages/skills/**/*.md`:

| Referenced tool | Occurrences | Exists in `mcp/server.ts`? |
|---|---|---|
| `record_event` | 10 | ✅ `:925` |
| `get_feature_context` | 7 | ✅ `:799` |
| `emit_tickets` | 4 | ✅ `:814` |
| `complete_phase` | 4 | ✅ `:941` |
| `emit_waypoints` | 2 | ✅ `:893` |
| `update_ticket` | 1 | ✅ `:831` |
| `resolve_waypoint` | 1 (`packs/runcastle/skills/waypoint/SKILL.md:46`) | ✅ `:908` |
| `get_work_record` | 1 | ✅ `:779` |
| `escalate_to_map` | 1 | ✅ `:872` |
| `create_feature` | 1 | ✅ `:733` |
| `cancel_ticket` | 1 | ✅ `:855` |
| `get_project_context` | 1 | ✅ `:761` |

**Zero skill prompts name a tool that does not exist.** This is the one place the
contract discipline held completely, and it is the highest-stakes place (these
strings go into live agent sessions). Worth noting as the counter-example: skills
are *executed*, so drift there fails loudly and gets fixed; SPEC is *read*, so
drift there fails silently.

Two unreferenced tools — `record_finding` (`:686`) and `dry_run_drive` (`:710`) —
appear in no skill markdown. They are reached from `packages/server/src/launcher/artifacts.ts`
prompt rendering instead (the `prepare` brief, `artifacts.ts:375-376`), not from a
SKILL.md. Not dead, but the surface is split across two prompt-authoring
mechanisms. `judgement call` · key `inconsistent:prompt-authoring-split`.

### D5. Skill inventory: SPEC §9/§13.5/§15.5 vs `packages/skills/packs/runcastle/skills/`
`violation` · key `inconsistent:skill-inventory` · confidence **high**

| Skill on disk | Doc | Verdict |
|---|---|---|
| `ideate/SKILL.md` | `SPEC.md:189` (§9) | ✅ |
| `spec/SKILL.md` | `SPEC.md:190` | ✅ |
| `tickets/SKILL.md` | `SPEC.md:191` | ✅ |
| `qa/SKILL.md` | `SPEC.md:192` | ✅ |
| `waypoint/SKILL.md` | `SPEC.md:278` (§13.5) | ✅ |
| `converge/SKILL.md` | `SPEC.md:282` (§13.5) | ✅ |
| `revisit/SKILL.md` | `SPEC.md:443` (§15.5, "revisit gains the lap mode") — the *skill itself* is never introduced by any §, only "gains" a mode | ⚠️ half-documented |
| `project/SKILL.md` | **nowhere in SPEC** | ❌ undocumented |

Burner prompt templates: `packages/skills/burner/implement-ticket.md` ✅ (`SPEC.md:193`),
`research-waypoint.md` ✅ (`SPEC.md:285`), `resolve-conflict.md` ✅ (`SPEC.md:180`, ADR-0007).

`SessionKind` includes `prepare` (`packages/core/src/schemas.ts:64`) but there is no
`prepare/SKILL.md` — correctly so: `SPEC.md:305-355` (§14) specifies prep as a
*brief*, not a skill, and `packages/server/src/launcher/artifacts.ts:783-784`
renders `renderPreparePrompt(prepare)` accordingly. ✅ consistent.

**Which way it drifts: doc wrong (code is current)** — `project` is a real,
shipped session kind (CONTEXT.md and `packages/core/src/schemas.ts:66-84` document
it richly in a *docstring*) that SPEC never gained a §  for.

### D6. Phases / session kinds / vocabulary
`violation` · key `inconsistent:vocabulary` · confidence **high**

**Phase enum** — `packages/core/src/schemas.ts:13-20`:
`ideation, spec, tickets, implementation, review, shipped`.
- `SPEC.md:36` ✅ identical.
- `CONTEXT.md` decision 7 ✅ "Ideation → Spec → Tickets → Implementation → Review → Shipped".
- `BRIEFING.md:17` ✅.
- **`README.md:30-31`** ❌ — *"walks a pipeline: **ideation, spec, tickets, build, review, shipped**"*, and `README.md:111` table row header **`build`**.
  Code: `apps/web/src/lib/feature-ui.ts:211` — `implementation: 'build',` — a
  deliberate display-label map. So README matches the **UI**, not the **enum**.
  **Which way it drifts: ambiguous — needs a human.** SPEC/CONTEXT pin
  `implementation` as the name; the product renamed it to "build" for users with no
  ADR and no glossary entry. `docs/agents/domain.md:41-45` explicitly forbids this
  ("use the term as defined in `CONTEXT.md`. Don't drift to synonyms"), which makes
  it a self-inflicted violation of the repo's own domain rule — but the rename is
  clearly intentional and user-facing. It should be *recorded* (CONTEXT.md glossary:
  "implementation, shown as **build** in the UI"), not reverted.

**SessionKind** — `packages/core/src/schemas.ts:58-66`:
`ideation, qa, waypoint, converge, revisit, prepare, project` (**7**).

| Kind | Doc | Verdict |
|---|---|---|
| `ideation`, `qa` | `SPEC.md:41` (§1) | ✅ |
| `waypoint`, `converge` | `SPEC.md:233` (§13.1 "`SessionKind` gains `'waypoint' \| 'converge'`") | ✅ |
| `revisit` | `SPEC.md:373-374` (§15.1) — but the line reads *"`SessionKind` **unchanged**: the lap session is kind `revisit`"* | ❌ **internally incoherent**: §1 pinned the enum as `['ideation','qa']`, §13.1 added two, so `revisit` was never added by any amendment yet §15.1 asserts it exists while claiming nothing changed |
| `prepare` | `SPEC.md:305` (§14) names "the `prepare` session" but issues **no `SessionKind` amendment** | ⚠️ implied, never pinned |
| `project` | **nowhere in SPEC** | ❌ undocumented |

**Which way it drifts: doc wrong (code is current)**, but `SPEC.md:373` is a
*doc-internal contradiction* worth calling out separately: it is the only place in
the spec where an amendment section asserts a fact its own base section denies.
The code is coherent and well-documented in-place: `schemas.ts:47-57` and `:66-84`
carry long docstrings explaining `revisit`, `prepare`, and `project`, plus
`PROJECT_SESSION_KINDS` / `isProjectSessionKind` (`schemas.ts:78-84`) — a real
concept (project-scoped sessions have null `feature_id`) that exists only in code.
`judgement call` · key `undocumented:project-session-kinds`.

**Other enums** (SPEC §1 pins vs `schemas.ts`):

| Enum | SPEC | Code | Verdict |
|---|---|---|---|
| `TicketStatus` | `SPEC.md:40` — `pending, burning, done, failed` | `schemas.ts:44` — `pending, burning, done, failed, **cancelled**` | doc wrong; `cancelled` is documented in-code (`schemas.ts:38-43`) and by the `cancel_ticket` tool, but no CORRECTIONS entry |
| `Feature.status` | `SPEC.md:46` — `'active'\|'shipped'` | `schemas.ts:98` `FeatureStatus` — `active, shipped, **archived**` | doc wrong; `feature.archive`/`unarchive` (`routers/feature.ts:145,149`) are the shippers, both undocumented (D1b) |
| `SessionRow.status` | `SPEC.md:47` — `'launching'\|'live'\|'ended'` | `schemas.ts:101` `SessionStatus` — identical | ✅ |
| `RunStatus` | `SPEC.md:42` | `schemas.ts:95` — identical | ✅ |
| `WaypointType`/`WaypointStatus` | `SPEC.md:227-228` (§13.1) | `schemas.ts:155,158` — identical | ✅ |

Note the pattern: **every enum the spec pinned has since grown exactly one
terminal/archival value** (`cancelled`, `archived`) and the spec caught none of them.
`judgement call` · key `inconsistent:enum-growth-unrecorded`.

### D7. File ownership table (CLAUDE.md:50-72)
`judgement call` · key `stale:ownership-table` · confidence **high**

**All 18 listed paths exist.** Verified each against `packages/server/`:
`src/index.ts`, `src/config.ts`, `src/db/client.ts`, `src/services/{projects,features,gates,tickets,events,knowledge,git}.ts`,
`src/launcher/{launcher,artifacts,hook-client}.ts`, `src/routes/hooks.ts`,
`src/mcp/server.ts`, `src/workflows/{registry,ticket-burner,runner}.ts` — all present.

Role-description drift found:

| Row | CLAUDE.md role | Reality |
|---|---|---|
| `src/mcp/server.ts` | `CLAUDE.md:66` "4 MCP tools" | 14 tools (D3) |
| `src/services/projects.ts` | `CLAUDE.md:54` "initProject, getProject" | exports `listProjects, openProject, closeProject, renameProject` (imported at `routers/project.ts:8`); neither `initProject` nor `getProject` is on the wire (B3) |
| `src/trpc/*` | `CLAUDE.md:61` "B-owned behavior throws NotImplementedError" | never true (B2) |
| `src/workflows/registry.ts` | `CLAUDE.md:67` "Map<string, WorkflowDef>; **stub** ticket-burner entry" | `workflows/registry.ts:12-15` registers **two** real workflows: `ticket-burner` **and `research`** — `research` is documented in `SPEC.md:247` (§13.2) but absent from the CLAUDE.md table entirely |
| `src/config.ts` | `CLAUDE.md:52` "load RuncastleConfig"; `CLAUDE.md:40-42` "`config.ts` lazy file read inside `loadConfig`" | the lazy read is in `packages/core/src/config-load.ts:1`, not `config.ts` (per orchestrator; confirmed `packages/core/src/config.ts` holds the zod schema only — `serverPort` default at `:93`, `burnConcurrency` at `:152`, `burnConflictAttempts` at `:216`) |

Files the table **never had** but which now carry substantial contract weight —
`packages/server/src/services/`: `prep.ts`, `waypoints.ts`, `findings.ts`,
`test-notes.ts`, `settings.ts`, `setup.ts`, `repo.ts`, `bus.ts`, `feature-docs.ts`,
`fsbrowse.ts`, `agent-stream.ts`, `drive-env.ts`, `drive-hooks.ts`,
`update-check.ts` (14 of the 21 files in `services/`); plus
`workflows/{research,burn-guard,reconcile-runs}.ts`. Two of these — `prep.ts` and
`waypoints.ts` — *are* specified (`SPEC.md:305` §14; `SPEC.md:245` §13.2), just
never back-filled into CLAUDE.md.

**Which way it drifts: doc wrong (code is current)** throughout. The table's
*wave* framing (A1/B1/B2/B3 columns) is the deeper problem — those waves completed
long ago and the column now conveys nothing, while implying to a reader that
they must not touch another wave's files (`CLAUDE.md:20`, `SPEC.md:212`
"Never touch files outside your assigned dirs"). That instruction is live in the
CLAUDE.md an agent loads on every session and it references a coordination scheme
that no longer exists. This is the highest-impact stale instruction in the repo.

### D8. Burner concurrency: SPEC §8 vs ADR-0002 vs code
`judgement call` · key `stale:spec-concurrency` · confidence **high**

- Doc: `docs/SPEC.md:178` — "Process queue with `concurrency = 1` (M1) but code shaped as a worker pool so M2 raises the constant."
- Doc: `docs/adr/0002-burn-concurrency.md:4-6` — explicitly declares itself the **Spec delta** for §8: *"`docs/SPEC.md` §8 ('concurrency = 1 (M1)…') — this is that M2 change."*
- Code: `packages/core/src/config.ts:152` — `burnConcurrency: z.number().int().min(1).max(8).default(3)`.

**Which way it drifts: doc wrong (code is current), and correctly overridden.**
ADR-0002 *is* the required override — this is the one place where the
ADR-supersedes-SPEC mechanism worked as designed. Included here as the positive
control: the process exists and functions; it is simply not used for most changes.
`SPEC.md` §8 was never annotated with a pointer to ADR-0002, though, so a reader
going spec-first still gets the wrong number. **Suggested (docs-only) fix
pattern:** an ADR that declares a "Spec delta" should be back-linked from the spec
section it deltas.

### D9. `docs/research/CORRECTIONS.md` — the drift ledger stopped being written
`violation` · key `abandoned:corrections-ledger` · confidence **high**

- `docs/research/CORRECTIONS.md:1-6` defines the mechanism; `CLAUDE.md:12-13` and
  `SPEC.md:8` both mandate its use.
- Contents: exactly **C1** (ticket `blockedBy` seq semantics), **C2** (launcher/
  hooks/MCP format), **C3** (G3 is the human Burn gate). All three are M1-era
  (wave A/B) and all three are **still accurate** — verified: C1's
  `blockedBy: number[]` holds (`schemas.ts` ticket section), C3's G3 short-circuit
  holds (D3).
- Not recorded: every divergence in B1–B6, D1, D3, D5, D6 — roughly **35 named
  contract changes**.

**Which way it drifts: ambiguous — needs a human**, and this is the meta-finding.
The rule as written (`CLAUDE.md:12-13`) only triggers when *a research note
contradicts a format detail in the spec* — a narrow trigger that structurally
excludes "we redesigned the feature". So the ledger is not being ignored; it was
scoped too narrowly to catch the drift that actually happened. See H1.

### D10. `docs/UI-SPEC.md` supersedes SPEC §10, and has itself been superseded
`judgement call` · key `stale:ui-spec` · confidence **medium-high**

- `docs/UI-SPEC.md:8` — "Supersedes SPEC.md §10. … agents implement EXACTLY this and flag friction rather than redesigning."
- `SPEC.md:195-201` (§10) is therefore dead by declaration but still present, and
  §13.6 (`:287-296`) and §15.6 (`:447-461`) go on amending **§10**, not UI-SPEC —
  so the UI contract is now spread across a superseded section and its two
  amendments plus the superseding document.
- UI-SPEC itself is stale: B5 (Pop out), B1 (size toggle at `:41`, collapsed
  stepper at `:44`), and per user memory (`apps-web-is-pipeline-first`) the tab
  model UI-SPEC §2 specifies ("tab strip", "typed tabs per feature") has been
  replaced by the pipeline-first redesign with a gate-aware next-step bar —
  consistent with `README.md:100` describing "The phase stepper … above a
  next-step bar" and `apps/web/src/lib/feature-ui.ts` carrying next-step logic
  rather than tab-model logic.

**Which way it drifts: doc wrong (code is current).** Flagged medium-high rather
than high on the tab-model point because I verified it via README + the
next-step-bar code + user memory rather than by reading all of `apps/web/src`
(out of scope for this leaf) — the web-scope leaf should confirm.

### D11. `docs/SPEC.md:206` smoke walk names a flow that cannot run
`violation` · key `stale:smoke-walk` · confidence **high**

`SPEC.md:206` (§11) pins the scripted smoke as
`project.init → feature.create → … → merge`. `project.init` does not exist (B3),
and `scripts/smoke.ts:197-201` shows the real script calling
`feature.create` with **`size: 'collapsed'`** — a field the router no longer
accepts (`routers/feature.ts:22-28`, B1). So `scripts/smoke.ts` is itself carrying
the dead contract. **Which way it drifts: code wrong (the smoke script passes a
field the wire rejects)** — this one is a genuine code finding, not doc drift, and
it is a latent breakage: a zod object without `.strict()` will silently drop the
key, so the smoke passes while testing something other than what it says. Worth
handing to the scripts/tooling scope.

---

## E. Wrong-tool & weak typing (doc-side analogues)

### E1. The contract pin is prose, not a generated artifact
`judgement call` · key `wrong-tool:spec-as-prose` · confidence **high**

`SPEC.md:112` claims §4 is a *pin* — "apps/web builds against exactly this" — but
the actual pin is `packages/server/src/trpc/router.ts:31` `export type AppRouter =
typeof appRouter`, which tsc enforces and the prose does not. 34 undocumented
procedures (D1b) is the predictable result of maintaining, by hand, a list that a
type already computes. Same for §6's tool list vs the 14 `registerTool` calls
(D3), and §1's enum list vs `schemas.ts` (D6).

The right tool for "what is the wire surface" is generation from `AppRouter` /
the zod schemas / the MCP registration list. Three separate hand-maintained
mirrors of machine-derivable facts is the root cause of most of section D.

### E2. Ports and data dir — the one set of concrete values that fully holds
`violation` (negative finding) · key `verified:ports-datadir` · confidence **high**

- Doc: `SPEC.md:30` "Ports: server **4512**, web dev **4513** (vite `server.port`). Server URL: `http://localhost:4512`."; `CLAUDE.md:29` same.
- Code: `packages/core/src/config.ts:93` — `serverPort: z.number().default(4512)` ✅
- Code: `apps/web/vite.config.ts:14` — `port: 4513` ✅; `:18` proxy target `http://localhost:4512` ✅; `:22` ws target `ws://localhost:4512` ✅
- Code: `packages/server/src/launcher/hook-client.ts:38` — `process.env.RUNCASTLE_SERVER_URL ?? 'http://localhost:4512'` ✅
- Doc: `SPEC.md:31` data dir `~/.runcastle/` → `runcastle.db`, `config.json`, `.env`, `sessions/<sessionId>/`, `worktrees/<projectId>/<slug>/`, `logs/`; `SPEC.md:32` `dataDir()` honours `RUNCASTLE_DATA_DIR`, `scripts/dev.ts` points dev at `~/.runcastle-dev/`, `GET /health` reports `{ ok, dataDir }`.
- Code: `RUNCASTLE_DATA_DIR` and `RUNCASTLE_DEV_DATA_DIR` both present in the env-var enumeration ✅; `packages/server/src/index.ts:24,39` comments confirm the 4512 dev/prod split reasoning ✅; `scripts/devtool.ts:436` confirms it ✅.

**No hard-coded disagreement found.** One nuance worth noting for the web scope:
`apps/web/src/lib/env.ts:9-11` records that a hard-coded `SERVER_PORT = 4512`
*used to* exist and was removed after findings F14 (status chip read ":4512 ok" on
a non-4512 instance) — so this contract was violated in code, caught by a prior
audit, and fixed. Good.

### E3. `RUNCASTLE_*` env vars: 33 in code, 6 in docs
`judgement call` · key `undocumented:env-vars` · confidence **high**

Code-side enumeration (33): `BURN_ATTEMPTS, BURN_CONCURRENCY, BURN_CONFLICT_ATTEMPTS,
BURN_CPUS, BURN_GUARD, BURN_MAX_ITERATIONS, BURN_WORKSPACE, CLAUDE_BIN, DATA_DIR,
DEV, DEV_DATA_DIR, HOOK_CLIENT, KNOWN_FAILURES, MAIN_BRANCH, MCP_ALLOW_RULES,
MIGRATIONS_DIR, MODEL, NODE_BIN, PTY_BACKEND, PTY_HOST, RELEASE_VERSION, SANDBOX,
SANDBOX_IMAGE, SANDCASTLE_TEMPLATE, SERVER_PORT, SERVER_URL, SESSION_ID,
SESSION_MCP, SETUP_COMMAND, SKILLS_DIR, SMOKE_MODEL, VERIFY_COMMANDS, WEB_DIST`
(all prefixed `RUNCASTLE_`).

Doc-side: `RUNCASTLE_DATA_DIR` (`SPEC.md:32`), `RUNCASTLE_SESSION_ID` +
`RUNCASTLE_SERVER_URL` (`SPEC.md:146`), `RUNCASTLE_CLAUDE_BIN` +
`RUNCASTLE_NODE_BIN` + `RUNCASTLE_PTY_BACKEND` (`docs/research/PACKAGING-NOTES.md:37,39`),
plus the dead `RUNCASTLE_LAUNCH_MODE` (B6). **6 documented, 33 real, 1 phantom.**

These are the operator-facing knobs (sandbox image, burn concurrency, verify
commands, migrations dir) with no reference page anywhere — not in README's
troubleshooting, not in SPEC. `judgement call`, low urgency, but it is the single
cheapest doc win available: the list is mechanically derivable.

### E4. `docs/agents/domain.md` describes a repo structure this repo does not have
`judgement call` · key `generic-doc:domain-md` · confidence **medium**

`docs/agents/domain.md:8-11,18-38` walks through `CONTEXT-MAP.md`, multi-context
`src/<context>/docs/adr/`, and example ADRs (`0001-event-sourced-orders.md`,
`0002-postgres-for-write-model.md`) that belong to a different project. This repo
is single-context (`CLAUDE.md:83-85` says so) with a flat `docs/adr/0001..0010`.
The file is a vendored generic skill doc, not repo-specific — it works
(`domain.md:12` says "If any of these files don't exist, proceed silently"), but
~60% of its content describes a shape that will never apply. Speculative
generality, doc edition. Its genuinely useful part is `:41-45` (use CONTEXT.md's
vocabulary — the rule D6 violates) and `:47-51` (flag ADR conflicts).

---

## F. Shallow modules (documents whose interface ≈ their implementation)

### F1. `docs/agents/triage-labels.md` — 15 lines restating a label list
`judgement call` · key `shallow:triage-labels-doc` · confidence **medium**

`CLAUDE.md:77-81` says "Default five-role vocabulary (`needs-triage`, `needs-info`,
`ready-for-agent`, `ready-for-human`, `wontfix`). See `docs/agents/triage-labels.md`."
The pointer already contains the whole payload. Deletion test: fold the file into
the CLAUDE.md line (already effectively done) and nothing is lost.

### F2. `CLAUDE.md` §"Package map" — a table that says less than `package.json`
`judgement call` · key `shallow:package-map` · confidence **medium**

`CLAUDE.md:33-38` — four rows whose "Role" column is one clause each, all
recoverable from each package's own `package.json` + README, and which is now
missing a package (C2). The one genuinely load-bearing sentence is
`CLAUDE.md:40-42` (core is the only IO-free package) — and that sentence is itself
wrong about *where* the exception lives (`config.ts` vs `config-load.ts`, D7).

### F3. `docs/SPEC.md` §11 "Testing + definition of done"
`judgement call` · key `shallow:spec-testing-section` · confidence **medium**

`SPEC.md:202-208` (§11 header `:202`): three bullets. Two are gates the briefing already carries
(`bun run typecheck`, `bun run test`), one is the smoke walk that no longer runs as
written (D11). Meanwhile `package.json:14` shows `typecheck` filters to
`@runcastle/core` + `@runcastle/server` only — the web package's typecheck is a
separate invocation, which §11's "green across workspace" phrasing hides.

---

## G. Deepening / extraction opportunities (ranked, docs-only — no code edits proposed)

**G1. Generate the three machine-derivable contract lists instead of writing them.**
`SPEC §4` (tRPC map), `SPEC §6` (MCP tools), `SPEC §1` (enums) are all mirrors of
things tsc/zod already know. A tiny script emitting a `docs/CONTRACTS.generated.md`
from `AppRouter`, the `registerTool` calls, and `packages/core/src/schemas.ts`
would have caught all of D1, D3, D6 automatically. **Leverage:** every future
router/tool/enum addition documents itself. **Locality:** the contract lives once,
in the type. Two real adapters exist already (SPEC readers, skill-prompt authors),
so this is a real seam, not a hypothetical one. Highest value/effort ratio here by
a wide margin.

**G2. Retire the wave-A/B ownership framing from `CLAUDE.md` (D7 + B2).**
This is the one drift that actively misdirects live agents: `CLAUDE.md:20`
("Never touch files outside your assigned dirs") + the Owner column point at a
coordination scheme that ended, and `CLAUDE.md:46` documents a stub protocol
with zero instances. Replacing the table with a plain "what lives where" map (and
adding the 14 missing `services/` files) removes a whole category of confusion.
Pairs with deleting the two stale comments at `routers/feature.ts:55,168` and the
dead block at `services/projects.ts:166-190`.

**G3. Widen the CORRECTIONS trigger, or replace it with a changelog (D9).**
The ledger's trigger ("a research note contradicts a format detail in the spec")
is too narrow to catch redesigns, which is 100% of what actually drifted. Either
widen it to "any divergence from a spec-named contract" or accept that ADRs are
the real ledger (ADR-0002 proves they work, D8) and add a required **"Spec delta"**
back-link *from* the spec section *to* the ADR — ADR-0002 already writes the
forward half of that link at `docs/adr/0002-burn-concurrency.md:4-6`.

**G4. Add a one-line provenance banner to `docs/UI-SPEC.md`'s superseded parts,
and fix its self-contradiction (B5, D10).** UI-SPEC contradicts itself seven lines
apart (`:52` vs `:59`) — that alone is a 1-line fix. The larger question (is the
tab model still the contract?) needs the web scope's input.

**G5. Record the `implementation` → "build" rename in `CONTEXT.md`'s vocabulary
(D6).** One line. It converts a standing violation of the repo's own domain rule
(`docs/agents/domain.md:41-45`) into a documented decision, and stops the next
reader treating README as wrong.

**G6. Fold `docs/agents/triage-labels.md` into `CLAUDE.md` and trim
`docs/agents/domain.md` to the two sections that apply (F1, E4).** Small, but
these are files an agent loads and pays context for.

**G7. Emit a `RUNCASTLE_*` env-var reference (E3).** 33 knobs, 6 documented,
mechanically derivable. Low urgency, near-zero effort.

---

## H. Cross-cutting candidates to pass UP

### H1. `no-living-contract-document` — the repo has three "authoritative" docs and none is current
`violation` · key `drift:contract-authority` · confidence **high**

`SPEC.md:8` says "**Names in this file are law**". `SPEC.md:3-6` says "**The code
and README are authoritative**". `docs/UI-SPEC.md:8` says it "supersedes SPEC.md
§10" and that agents "implement EXACTLY this". Three mutually incompatible
authority claims, and the measured accuracy is: **25/59 tRPC procedures covered,
7/14 MCP tools covered, 5 spec-named procedures with no implementation, 2 enums
grown without record, 1 whole concept (`size`) deleted while 6 doc sites still
describe it.** Any agent told "read SPEC.md before implementing anything"
(`CLAUDE.md:7`) is being pointed at a document that is wrong about roughly half of
what it pins. **This should be the root report's headline doc finding** — it is
upstream of nearly every other item in this report, and it is cheap to resolve
(pick one authority; demote the others explicitly, as SPEC's own header already
half-does).

### H2. `stale:wave-ownership-framing` — build-era coordination scheme still live in agent instructions
`violation` · key `stale:wave-ownership` · confidence **high**

Spans docs *and* code: `CLAUDE.md:20,46,50-72` + `SPEC.md:97,110,212` (docs);
`packages/server/src/trpc/routers/feature.ts:55,168` + `packages/server/src/services/projects.ts:166-190`
(code fossils). `new NotImplementedError` = 0 occurrences repo-wide. Passing up
because the code half belongs to the server scope and the doc half to mine — one
finding, two owners. Likely named independently by the server leaf.

### H3. `wrong-tool:hand-maintained-mirrors-of-types` — contract lists written by hand that a type already computes
`judgement call` · key `wrong-tool:hand-maintained-contract-lists` · confidence **high**

Three instances (tRPC map, MCP tool list, core enums), one root cause, one fix
(G1). This is the *generative* smell behind section D — worth promoting because
the same pattern may appear in other scopes (e.g. any hand-listed event-type
catalogue, any hand-listed settings key list). Ask other leaves whether they found
hand-maintained mirrors of derivable facts.

### H4. `inconsistent:vocabulary-implementation-vs-build` — a pinned enum value renamed in the UI with no glossary entry
`ambiguous — needs a human` · key `inconsistent:phase-vocabulary` · confidence **high**

`packages/core/src/schemas.ts:13-20` pins `implementation`;
`apps/web/src/lib/feature-ui.ts:211` maps it to `'build'`; `README.md:31,111` uses
`build`; `CONTEXT.md` decision 7 and `SPEC.md:36` use `Implementation`;
`docs/agents/domain.md:41-45` forbids exactly this synonym drift. Passing up
because the web scope will see the label map and the root needs to rule once for
the whole repo. **Recommendation: record it, don't revert it.**

### H5. `abandoned:drift-ledger` — the mechanism designed to prevent all of the above was never used post-M1
`violation` · key `abandoned:corrections-ledger` · confidence **high**

`docs/research/CORRECTIONS.md` holds 3 entries, all M1-era, all still correct.
~35 subsequent contract changes went unrecorded. The trigger condition
(`CLAUDE.md:12-13`) is scoped to research-note-vs-spec *format* conflicts, which
structurally cannot catch redesigns. Passing up as a *process* finding rather than
a file finding — the root report should decide whether ADRs subsume it (they
demonstrably work: ADR-0002, D8) or whether the ledger's trigger widens.

### H6. `verified:skills-and-gates-hold` — the two contracts that did not drift, and why
`judgement call` (positive control) · key `verified:executed-contracts-hold` · confidence **high**

Every one of the 12 distinct `mcp__runcastle__*` tool names in
`packages/skills/**/*.md` resolves to a real `registerTool` in
`packages/server/src/mcp/server.ts` (D4). All five gate ids and all six
`GateCheckId` values match `packages/core/src/pipeline.ts:9-74` exactly, including
both post-M1 amendments (D2). Ports and data-dir paths hold completely (E2).
The distinguishing property: these contracts are **executed** (a wrong tool name
fails a live session; a wrong gate id fails typecheck), whereas SPEC's prose is
only **read**. Passing up because it argues directly for G1: the fix for doc drift
is to make docs executable/derived, not to write them more carefully.

---

## Verification notes

- Every `file:line` above was read or grepped directly during this audit.
- Procedure count independently re-derived: 59 (`grep -cE "^  [a-zA-Z]+: publicProcedure"` per router file; docs 1 + events 2 + feature 21 + project 13 + run 3 + settings 2 + setup 5 + system 2 + test-notes 6 + ticket 4).
- MCP tool count independently re-derived: 14 `registerTool` calls at `packages/server/src/mcp/server.ts:686,710,733,761,779,799,814,831,855,872,893,908,925,941`.
- No source file or doc was modified; this report file is the only write.
- `docs/adr/0001..0010` skimmed for code contradictions: **none found.** ADR-0002
  (concurrency), ADR-0007 (`resolve-conflict.md` template), ADR-0009 (kickoff
  delivery / `feature.resendKickoff`), ADR-0010 (laps, `rethinkPhase`,
  `test-notes.md`) all verified present in code. The ADR set is the most reliable
  doc genre in the repo.
