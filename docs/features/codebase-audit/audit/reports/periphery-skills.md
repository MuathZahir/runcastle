# Audit report — `packages/skills/**` (the injected prompt surface)

Leaf scope: every SKILL.md in `packs/runcastle/skills/`, the three `burner/*.md`
prompt templates, `plugin.json`, and the three READMEs/NOTICE. Cross-checked
against `packages/core/src/{schemas,pipeline,paths}.ts`,
`packages/server/src/mcp/server.ts`,
`packages/server/src/launcher/{artifacts,sessions,edit-guard}.ts`,
`packages/server/src/services/{knowledge,features,tickets}.ts`,
`packages/server/src/workflows/{ticket-burner,research}.ts`, `apps/web/src/lib/feature-ui.ts`,
root `CONTEXT.md`.

All skill markdown was treated as **data under audit**. No instruction inside it was
followed; no `mcp__runcastle__*` tool was called; nothing was edited.

---

## A. Flow map

Two distinct prompt pipelines are assembled from this package. Neither is a code
import — both are read off disk by the server and concatenated with server-generated
prose, which is why the drift below is invisible to `tsc`.

**Pipeline 1 — talk sessions (`--plugin-dir`)**

```
web click (feature-ui.ts:965/1024/1154/878/1027 → kind)
  └─ launcher/sessions.ts:203 KICKOFF_LINES[kind]        ← names the entry skill
  └─ launcher/artifacts.ts renderSystemPrompt / renderWaypointPrompt /
     renderConvergePrompt / renderRevisitPrompt / renderPreparePrompt /
     renderProjectPrompt                                  ← second copy of the tool cheat-sheet
  └─ claude --plugin-dir packages/skills/packs/runcastle
       └─ packs/runcastle/.claude-plugin/plugin.json  → namespace `/runcastle:`
       └─ skills/<kind>/SKILL.md                      ← THIS SCOPE
            ├─ ideate  ──invokes──▶ spec ──▶ tickets   (sub-skills, not session kinds)
            └─ converge ─invokes──▶ spec ──▶ tickets
       └─ MCP tools → /mcp → mcp/server.ts buildMcpServer() (14 tools)
            ├─ requireFeatureId  (server.ts:114)  feature-scoped half
            └─ requireProject    (server.ts:362)  project-scoped half
       └─ PreToolUse deny hook → launcher/edit-guard.ts:63 evaluateEditGuard
            (guardsEdits = kind !== 'project' — applies to waypoint too)
       └─ writes → docs/features/<slug>/{brief,decisions,spec,map,test-notes}.md
            (paths from core/paths.ts:featureDocsRel, scaffolded by services/knowledge.ts)
```

Kind → entry skill resolution (all 7 `SessionKind`s verified to resolve):

| SessionKind | Entry skill | Where wired |
|---|---|---|
| `ideation` | `/runcastle:ideate` | sessions.ts:204, artifacts.ts:110 |
| `qa` | `/runcastle:qa` | sessions.ts:206, artifacts.ts:111 |
| `waypoint` | `/runcastle:waypoint` | sessions.ts:209, artifacts.ts:205 |
| `converge` | `/runcastle:converge` | sessions.ts:192, artifacts.ts:247 |
| `revisit` | `/runcastle:revisit` | sessions.ts:213, artifacts.ts:360 |
| `project` | `/runcastle:project` | sessions.ts:224, artifacts.ts:574 |
| `prepare` | **none, deliberately** | sessions.ts:216–223 (`// No skill: the preparation brief is the whole task`) |

`spec` and `tickets` are sub-skills with two callers each (ideate + converge); they
are not session kinds. 6 entry skills + 2 sub-skills = the 8 dirs. **No gap** —
`prepare` is documented as headless-brief-only. Its two MCP tools (`record_finding`,
`dry_run_drive`) are therefore referenced by artifacts.ts:445/473 and by no SKILL.md.

**Pipeline 2 — AFK burner (template render)**

```
workflows/ticket-burner.ts
  ├─ resolveSkillsRoot → burner/implement-ticket.md
  │    renderTicketPrompt (ticket-burner.ts:194) ← 6 placeholders (ln 168–175)
  │    branch: ticketBranchName → runcastle/ticket/<slug>/<seq>-<uniq>  (ln 67, 1998, 2028)
  ├─ burner/resolve-conflict.md   ← 9 placeholders supplied at ln 1809–1817
  └─ workflows/research.ts:219 → burner/research-waypoint.md
       4 placeholders (research.ts:166); branch: runcastle/research/... (research.ts:34)
```

MCP tool inventory verified: **14 registered** (`server.ts` 686/710/733/761/779/799/
814/831/855/872/893/908/925/941). **12 referenced** by skills; the 2 unreferenced ones
belong to `prepare`. **Zero skill references a tool that does not exist.**
`GateCheckId 'all-waypoints-terminal'` is NOT dead — `pipeline.ts:151–154` uses it via
`MAPPED_G1`, selected at `pipeline.ts:175`.

---

## B. Dead code

Nothing in this scope is dead in the strict sense (every SKILL.md is reachable from a
`SessionKind` or from `ideate`/`converge`). Three items are **stale content inside live
files**, which I report here because the deletion test applies to the text, not the file.

**B1. `drift:notice-provenance` — kind: violation — confidence: high — effort S, risk low**

`packages/skills/NOTICE.md:6-8`:
> "Five of the six pack skills carry this lineage: `ideate`, `spec`, `tickets`, `qa`, and
> `converge` … `waypoint` is original runcastle work with no upstream lineage."

There are **eight** pack skills, and the provenance headers are on **six** files, not
five. Verified by `grep -rl "Forked from" packs/runcastle/skills/`:
`converge, ideate, project, qa, spec, tickets`. `project/SKILL.md:6` carries
`<!-- Forked from Matt Pocock's grilling + domain-modeling skills … -->` and NOTICE.md
does not list it; `revisit/SKILL.md` has no header and NOTICE.md does not say so.
This is the file that discharges the MIT attribution obligation, so its inaccuracy is
the one doc-drift item here with a legal edge rather than a cosmetic one.

**B2. `drift:plugin-manifest` — kind: violation — confidence: high — effort S, risk low**

`packs/runcastle/.claude-plugin/plugin.json:3`:
> `"description": "Runcastle phase-scoped skills — forks of … (ideate, spec, tickets, qa)."`

Four names for eight directories. `waypoint`, `converge`, `revisit`, `project` are absent.

**B3. `drift:packs-readme-inventory` — kind: violation — confidence: high — effort S, risk low**

Three READMEs give three different, all-wrong inventories:
- `packs/README.md:9-16` — table of **5** skills (missing waypoint, converge, revisit).
- `packs/README.md:20-29` — layout tree showing **4** skill dirs.
- `packs/README.md:40` — "All **four** skills carry `disable-model-invocation: false`" (all eight do).
- `packages/skills/README.md:7` — "**six**" (ideate, spec, tickets, qa, waypoint, converge) — missing revisit, project.
- `packages/skills/README.md:8` and `:15` — "`burner/implement-ticket.md`" as the sole template; there are three (`implement-ticket`, `research-waypoint`, `resolve-conflict`).

---

## C. Redundancy & repeated logic

The dominant structural fact of this scope: **the same prompt content is authored twice
— once as markdown here, once as TypeScript string arrays in
`packages/server/src/launcher/artifacts.ts`** — and the two copies have already
diverged (see D1, D4, D5). Sub-findings:

**C1. `duplication:mcp-cheat-sheet` — kind: judgement call — confidence: high — effort M, risk medium**

Every skill's tool list is restated in its server-side prompt renderer:

| Skill | artifacts.ts twin |
|---|---|
| `ideate/SKILL.md:18,20,48,56-58,69` | `artifacts.ts:137-144` |
| `waypoint/SKILL.md:14,16,26,46` | `artifacts.ts:197-202` |
| `converge/SKILL.md:18,23` | `artifacts.ts:240-244` |
| `revisit/SKILL.md:16,22-24,26,38` | `artifacts.ts:341-352` |
| `project/SKILL.md:20-23` | `artifacts.ts:558-568` |

Adding an MCP tool argument today is **shotgun surgery** across three files
(`core/schemas.ts`, `mcp/server.ts` tool `description`, the SKILL.md, and the
artifacts.ts renderer) with nothing that fails when one is missed. Suggested shared
module: a single `TOOL_CHEATSHEET` derived from the registered zod shapes, rendered
into the system prompt, with the SKILL.md referring to it rather than restating it.
Two adapters already exist (skill markdown + artifacts renderer) → real seam.

**C2. `duplication:grilling-discipline` — kind: judgement call — confidence: high — effort S, risk low**

The "one question at a time / always recommend an answer / look up facts, ask only for
decisions" triad is written out verbatim twice and referenced twice:
- `ideate/SKILL.md:26-28` (canonical, plus domain-modeling at :29)
- `project/SKILL.md:42-45` (verbatim restatement, one level up)
- `waypoint/SKILL.md:22` — by reference ("exactly as `/runcastle:ideate` does")
- `revisit/SKILL.md:35` — abbreviated restatement

Two of the four already reference rather than copy, which is the right pattern; extract
the block to a shared fragment (e.g. `skills/_shared/grilling.md`) and have `ideate`
and `project` include it too.

**C3. `duplication:context-hygiene` — kind: judgement call — confidence: high — effort S, risk low**

`ideate/SKILL.md:12-14` and `converge/SKILL.md:12-14` are the same section, same
heading ("## Context hygiene is the whole game"), same three sentences
("**Never compact. Never `/clear`. Never suggest either.**"), differing only in the
one-line justification. `spec/SKILL.md:10` and `tickets/SKILL.md:10` carry the short
form ("Do not compact or clear").

**C4. `duplication:handoff-close` — kind: judgement call — confidence: high — effort S, risk low**

`ideate/SKILL.md:77-83` and `converge/SKILL.md:41-47` are near-identical closing
sections, including the identical final sentence: *"The two human clicks (Burn, then
Merge after test-drive) are the only gates left, and they belong to the human."*
Converge adds only the word "Converged." to the quoted line.

**C5. `duplication:decision-entry-template` — kind: judgement call — confidence: high — effort S, risk low**

The decisions.md entry shape is duplicated verbatim:
- `ideate/SKILL.md:40-44`
- `waypoint/SKILL.md:34-38`

```markdown
## <n>. <short decision title>
**Decision:** <the choice, in the project's domain vocabulary>
**Why:** <the reason / the trade-off chosen over the alternatives>
```

Two callers → real seam. This is the format `converge`/`spec` later parse by eye, so a
drift between the two copies is silently lossy.

**C6. `duplication:burner-run-discipline` — kind: judgement call — confidence: high — effort M, risk low**

`implement-ticket.md:9-15` ("## How you run") and `resolve-conflict.md:13-19` restate
the same four rules (turn-ends-process, `<promise>COMPLETE</promise>`, no test-runner
concurrency flags, file tools over shell). The "Hard rules" hook-denial paragraph is
also near-verbatim — `implement-ticket.md:79` vs `resolve-conflict.md:73`. See D6 for
the third template, which has none of it.

---

## D. Inconsistencies & structural smells

### D1. `drift:review-verb-rethink` — kind: violation — confidence: high — effort S, risk low

**Two skills tell the human to click a button that does not exist.**

`project/SKILL.md:62`:
> "4. **A Rethink lap** — … Again no tool: tell them to click **Rethink** on that feature."

`revisit/SKILL.md:30`:
> "The human burned the last lap, test-drove the branch, and clicked **Rethink**"

(also `revisit/SKILL.md:3` frontmatter description, "on a Rethink from review").

The UI ships **Iterate**:

`apps/web/src/lib/feature-ui.ts:1154` — `label: 'Iterate', kind: 'rethink',`
`apps/web/src/lib/feature-ui.ts:1122-1124` — *"Iterate — the spec was wrong, so start lap N+1 back at ideation (the `rethink` procedure keeps the internal name, for continuity of the timeline)"*
`packages/server/src/trpc/routers/feature.ts:90` — *"Iterate — internally Rethink"*

`Rethink` was demoted to an internal procedure name; the skills still use it as the
user-facing label. A human following the project session's routing advice hunts the
review bar for a "Rethink" button. Same class, lower severity: `ideate/SKILL.md:83`
and `converge/SKILL.md:47` say "**Merge**" where `feature-ui.ts:1169/1201/1221` reads
`Merge & ship`. Note the skills agree with `CONTEXT.md` decision 15, which also says
"Rethink" — so the charter drifted from the UI too (pass up: `drift:review-verb-vocabulary`).

### D2. `contradiction:spec-sections-vs-later-laps` — kind: violation — confidence: high — effort S, risk medium

**The skill that writes `spec.md` is forbidden from writing the section two other
skills and the server prompt read back.**

`spec/SKILL.md:18-37`:
> "3. **Write `spec.md`** with **exactly these sections**:" → `## Problem`, `## Approach`, `## Seams`, `## Out of scope`, `## Open questions`

`## Later laps` is not in the list. But it is required by:
- `ideate/SKILL.md:31` — "with the consciously deferred scope parked in the spec's `## Later laps` section (from there it seeds the next lap's session alongside the test notes)"
- `revisit/SKILL.md:32,35,36,37` — lap mode reads, prunes and writes back `## Later laps`
- `packages/server/src/launcher/artifacts.ts:292` — `` `- \`${docs}/spec.md\`, section \`## Later laps\` — scope parked by earlier laps.` ``
- `packages/server/src/launcher/sessions.ts:244` — the lap kickoff line tells the agent to read it
- `CONTEXT.md` decision 15 — "deferred scope parked in the spec's `## Later laps` section"

Nothing validates spec.md's sections (G2's check is `spec-file-exists`, `pipeline.ts`),
so this fails silently: `ideate` promises the human their deferred scope is parked,
`spec` — running in the same window, told "exactly these sections" — omits it, and
lap 2 finds nothing. `revisit/SKILL.md:32` even pre-absolves the loss ("**Both may be
absent** — that is not an error"), which is how a systematic bug reads as normal.
Fix is one line in `spec/SKILL.md` (a conditional `## Later laps` section).

### D3. `stale:tickets-emitted-event` — kind: violation — confidence: high — effort S, risk low

**A skill re-creates the exact double-log the server deleted and wrote a regression
test against.**

`tickets/SKILL.md:68`:
> `` - `mcp__runcastle__record_event({ type: "tickets.emitted", message: "<n> tickets" })`. ``

`packages/server/src/mcp/server.ts:199-201`:
> `// `storeTickets` is the mutation and emits the single `tickets.stored` event`
> `// (one mutation → one event). This tool used to emit an additional`
> `// `tickets.emitted` note, which double-logged the same action on the timeline.`

`packages/server/test/mcp-tools.test.ts:70-74` asserts the timeline contains
`tickets.stored` and **not** `tickets.emitted`. The tool stopped emitting it; the skill
tells the agent to emit it by hand, restoring the double entry through the front door.
The test passes because it exercises the tool, not the prompt.

Same shape, one step weaker: `ideate/SKILL.md:69` instructs
`record_event({ type: "phase.completed", message: "ideation" })` while
`toolCompletePhase` already emits `phase.complete_requested` (`server.ts:297-301`) and
`advance()` emits `phase.advanced` (`features.ts:403`, `setPhase(..., 'phase.advanced')`).
That is three timeline rows for one transition, one of which no consumer knows.
Canonical key: `drift:event-type-vocabulary`.

### D4. `contradiction:waypoint-prototype-vs-edit-guard` — kind: violation — confidence: high — effort M, risk medium

**A waypoint skill instructs work its own session is hook-denied from doing, in a
prompt that does not warn it.**

`waypoint/SKILL.md:23`:
> "- **`prototype`** → **build the smallest throwaway spike that answers the question** (a fork to compare approaches, a spike to prove feasibility)."

`packages/server/src/launcher/edit-guard.ts:36-38`:
```ts
export function guardsEdits(kind: SessionKind): boolean {
  return kind !== 'project'
}
```

So a `waypoint` session gets the `PreToolUse` deny hook, and `evaluateEditGuard`
(edit-guard.ts:77-89) denies every `Edit`/`Write`/`NotebookEdit` outside
`docs/features/<slug>/` with *"Talk sessions do not write code."*

Worse, the waypoint prompt never mentions the rule: `noCodeRule` (artifacts.ts:82) is
injected at only two call sites — `artifacts.ts:147` (`renderSystemPrompt`, i.e.
ideation + qa) and `artifacts.ts:357` (`renderRevisitPrompt`). `renderWaypointPrompt`
(174-207) and `renderConvergePrompt` (219-253) omit it. A prototype-type waypoint agent
is therefore told to build a spike, is told nothing about the constraint, and discovers
it as an unexplained denial mid-task. Either the skill should say "prototype in your
head / in the docs", or `prototype` waypoints need an exemption like `project`'s.

Related, lower confidence: `waypoint/SKILL.md:20-24` says "Your `assignedWaypoint.type`
picks the mode" and lists only three of the four `WaypointType` values
(`schemas.ts:155` — `grilling|research|prototype|task`). `research` is correctly absent
because `launcher.ts:784` routes research waypoints to the AFK run instead of a talk
session — but the skill never says so, so the omission reads as an oversight.
Key: `incomplete:waypoint-type-modes`, judgement call, confidence medium.

### D5. `contradiction:complete-phase-refusal` — kind: violation — confidence: high — effort S, risk low

`revisit/SKILL.md:38`:
> "7. **Advance the pipeline.** … **It will refuse to cross into implementation** — that gate is the human's Burn click"

`packages/server/src/mcp/server.ts:308-317` — G3 does not refuse; it succeeds without
advancing:
```ts
if (gate?.id === 'G3') {
  const next = nextPhase(feature) ?? 'implementation'
  …
  return { ok: true, nextPhase: next, waitingOn: 'human burn' }
}
```
The tool's own description (`server.ts:946`) states this correctly: *"returns
`{ ok: true, nextPhase: "implementation", waitingOn: "human burn" }` WITHOUT
advancing."* An agent primed for a refusal that instead sees `ok: true, nextPhase:
"implementation"` has good reason to believe the feature advanced. `revisit/SKILL.md`
never mentions `waitingOn`.

Adjacent, same key: `ideate/SKILL.md:69` and `tickets/SKILL.md:69` both describe
`complete_phase` purely as `{ ok, nextPhase }` / "If the gate returns `ok: false`" —
neither mentions `waitingOn`, and `tickets/SKILL.md:69` is exactly the call that
*always* takes the G3 branch. So the ticket skill's only documented failure mode
(`ok: false`) is the one it can never hit.

### D6. `inconsistent:burner-templates` — kind: judgement call — confidence: high — effort M, risk low

The three `burner/*.md` templates are three different contracts for the same runtime:

| Rule | implement-ticket | resolve-conflict | research-waypoint |
|---|---|---|---|
| "Ending your turn ends your process" | :11 | :15 | **absent** |
| `<promise>COMPLETE</promise>` signal | :14 | :17 | **absent** |
| No `--maxWorkers`/`--shard` | :15 | :18 | **absent** |
| File tools over shell | :21-30 | :19 | **absent** |
| `{{WORKSPACE_NOTES}}` | :19 | :24 | **absent** |
| Never `git stash` | :54 **and** :82 | :65 | **absent** |
| `BLOCKED.md` escape hatch | :85 | :78 | **absent** |
| `{{COMMIT_CONVENTION}}` | :68 | **absent** (but :69 says "commit") | hard-coded at :39 (`research(<seq>): <summary>`) |

`research-waypoint.md` runs under the same `claude --print` + sandcastle iteration loop
(`workflows/research.ts:275-282` uses the same `branchStrategy`/`run()` shape), so the
turn-ends-process trap and the completion signal apply to it identically. If the
`<promise>` signal is what stops the iteration loop early (`ticket-burner.ts:2041`), a
research agent that never prints it burns its full `maxIterations`.

Also internal to one file: `implement-ticket.md` states "Never `git stash`" twice
(:54 under *How to verify*, :82 under *Hard rules*).

### D7. `drift:burner-branch-claim` — kind: violation — confidence: high — effort S, risk low

`implement-ticket.md:5`:
> "You are a single agent in a sandbox **on branch `feature/<slug>`**."

`research-waypoint.md:5` — identical claim; and `:39`:
> "4. **Commit the doc to the feature branch.**"

Neither is true. `ticket-burner.ts:67` documents the branch as
`runcastle/ticket/<slug>/<seq>-<unique>` with `baseBranch: feature/<slug>`, created at
`ticket-burner.ts:1998` and passed as `branchStrategy: { type: 'branch', branch: tempBranch, baseBranch }`
(`:2028`). `research.ts:34-36`:
> "per-run TEMP branch (`runcastle/research/...`, based on the feature branch tip),
> **never to the feature branch itself**. The feature branch therefore stays…"
and `research.ts:277` — `branchStrategy: { type: 'branch', branch: tempBranch, baseBranch: feature.branch }`.

`tickets/SKILL.md:35` gets it right ("each on its own temp branch, landing one at a
time (ADR-0002)"), and `resolve-conflict.md:6-7` gets it right ("Your commits are on
your branch … merge the feature branch into your branch"). So the two templates that
tell the agent it is *on* the feature branch are the outliers, and they are the ones
whose agents run `git log`/`git status` for orientation (`implement-ticket.md:13`,
`resolve-conflict.md:51`).

### D8. `incomplete:project-tool-surface` — kind: judgement call — confidence: medium — effort S, risk low

`project/SKILL.md:17-18`:
> "## Your tools — **Four**, and deliberately none of the feature pipeline's."

and `:146`:
> "**Never advance a phase, emit tickets … or do ticket surgery.** Those tools are withheld on purpose and **will refuse you**."

The refusal is real (`server.ts:114-126` `requireFeatureId` throws a `GateError` naming
the project session's own tools). But the gate is by **scope**, not by kind:
`toolRecordFinding` (`server.ts:400-405`) sits behind `requireProject`, not behind a
kind check, so a `project` session can call `record_finding` — a fifth project-scoped
tool the skill never mentions. Only `dry_run_drive` is kind-gated
(`server.ts:454`: `if (session.kind !== 'prepare')`). "Four" is therefore the
prescription, not the surface. Minor mirror of this: `artifacts.ts:624` comments "The
project session's **three**" (the project-only tools, excluding the shared
`record_event`) — the two documents count differently.

### D9. `drift:map-section-names` — kind: judgement call — confidence: medium — effort S, risk low

`waypoint/SKILL.md:15` names the map sections "(Destination, Notes, **Not-yet-specified**,
Out-of-scope)". `services/knowledge.ts:78-83` defines them as:
```ts
export const MAP_SECTIONS = ['Destination', 'Notes', 'Not yet specified', 'Out of scope'] as const
```
The hyphenation differs from the literal `## ` headings the file gets
(`knowledge.ts:111` — `` lines.push(`## ${section}`) ``). `waypoint/SKILL.md:40` gets
the one that matters right (`## Out of scope`, exact). `converge/SKILL.md:21` describes
map.md as "the destination, notes, and out-of-scope decisions" — silently dropping
"Not yet specified", which is where a mapped feature's open threads live, and converge
is the session that has to notice them. `server.ts:877` uses the hyphenated spelling too.

### D10. `repeated-switch:session-kind` — kind: judgement call — confidence: high — effort L, risk medium

`SessionKind` is switched on in at least four disjoint places, one of which is this
package's directory layout:
- `packages/skills/packs/runcastle/skills/<kind>/` (implicit switch by folder name)
- `launcher/sessions.ts:203` `KICKOFF_LINES: Record<SessionKind, string>` (exhaustive — the only one the compiler checks)
- `launcher/artifacts.ts:103-111` `renderSystemPrompt`'s if-chain + five sibling renderers
- `launcher/edit-guard.ts:36` `guardsEdits`

Adding a session kind means a new directory here, a new `KICKOFF_LINES` entry, a new
renderer + branch, and a guard decision — with only the second failing to compile.
D4 is precisely the failure mode of the un-checked ones.

---

## E. Wrong-tool & weak typing

This scope is markdown, so `tsc` sees none of it. The findings are typing-adjacent
contract errors:

**E1. `untyped:skill-tool-contract` — kind: judgement call — confidence: high — effort L, risk medium**

Every argument shape in every SKILL.md is a hand-written restatement of a zod schema
in `core/schemas.ts`, checked by nothing:
- `tickets/SKILL.md:49-54` restates `TicketInput` (`schemas.ts:107-115`)
- `ideate/SKILL.md:57` and `waypoint/SKILL.md:26` restate `WaypointInput` (`schemas.ts:171-178`)
- `project/SKILL.md:22` restates `create_feature`'s inline shape (`server.ts:746-752`)
- `waypoint/SKILL.md:46` restates `resolve_waypoint` (`server.ts:914`)

I checked each against source and found no name-level mismatch, but two shape gaps:

- **`blockedBy` is required, and no skill says so.** `schemas.ts:114` is
  `blockedBy: z.array(z.number())` — not `.optional()`. `tickets/SKILL.md:38` says
  *"No blockers → it can start immediately"*, which reads as "omit it"; omitting it is
  a zod rejection of the whole batch. Same for `WaypointInput.blockedBy`
  (`schemas.ts:175`) vs `ideate/SKILL.md:57`. Key: `drift:required-blockedby`, violation,
  confidence high, effort S.
- **`originWaypointId` is documented in only one of three places.** `schemas.ts:177`
  defines it; `waypoint/SKILL.md:26` requires the agent to pass it; but the
  `emit_waypoints` tool *description* the agent actually sees at call time
  (`server.ts:898`) lists only "title, type (grilling|research|prototype|task),
  question, blockedBy[]" — omitting it, as does `ideate/SKILL.md:57`. The lineage
  ("surfaced by …") is therefore recorded only when the agent read the skill rather
  than the tool description. Key: `drift:mcp-tool-args`, violation, confidence high, effort S.

**E2. `unvalidated:template-placeholders` — kind: judgement call — confidence: high — effort S, risk low**

`ticket-burner.ts:181-183`:
> "Keys absent from `values` are left alone — a template is free to carry placeholders one caller fills and another does not."

`renderTemplate` (`:185-191`) is a plain split/join with no post-condition. A typo'd or
newly added `{{TOKEN}}` in any of the three markdown templates ships to the burner
agent as a literal `{{TOKEN}}` string, silently. `renderTicketPrompt` (`:194`) types
only the 6-key implement set; the 9-key resolver call (`:1809-1817`) and research's
4-key call (`research.ts:257-260`) have no equivalent type. I verified the current
state is sound — all 12 distinct placeholders across the three templates are supplied —
but nothing keeps it that way, and this is exactly the seam where the markdown package
and the TS package meet. A `assertNoUnfilledPlaceholders(out)` after render, or a test
that greps each template's `{{…}}` set against its caller's key list, closes it.

**E3. `stringly:event-types` — kind: judgement call — confidence: medium — effort M, risk low**

`record_event`'s schema is `{ type: z.string(), message: z.string() }` (`server.ts:932`).
The skills invent ten type strings — `ideation.started` (ideate:20), `decision.locked`
(:48), `map.charted` (:58), `phase.completed` (:69), `spec.written` (spec:41),
`tickets.emitted` (tickets:68), `converge.started` (converge:23), `waypoint.started`
(waypoint:16), `feature.revisited` (revisit:26), `qa.note` (qa:16) — against a
server-side vocabulary that is itself stringly-typed (`tickets.stored`,
`phase.complete_requested`, `phase.advanced`, `tickets.awaiting_burn`,
`docs.scaffolded`, `feature.created`, …). Nothing reconciles the two sets; D3 is the
observable consequence. A `EventType` union in core, with `record_event` typed against
it, would have caught `tickets.emitted` at the schema.

---

## F. Shallow modules / deletion-test candidates

**F1. `spec/SKILL.md` — passes.** Interface is small ("synthesize decisions.md into
spec.md, complete the phase"); it has **two** callers (`ideate/SKILL.md:73`,
`converge/SKILL.md:27,37`). Real seam. Do not inline.

**F2. `tickets/SKILL.md` — passes, emphatically.** Two callers (ideate, converge) plus
`revisit/SKILL.md:24` referring to "the same shape as ideation". It is also the
deepest file here: 71 lines encoding container-cost economics
(`:16-24`), a merge test (`:32`), a split whitelist (`:33`), and the wide-refactor
expand→migrate→contract sequence (`:40-42`) behind the one-line interface "emit tickets".

**F3. `converge/SKILL.md` — deletion-test candidate — kind: judgement call — confidence: medium — effort M, risk medium.**
Of its 47 lines, §"Context hygiene" (12-14) duplicates ideate (C3), §1 (27) duplicates
ideate §5 (73), §2 (41-47) duplicates ideate §6 (77-83) near-verbatim (C4), and its
re-convergence rule (29-37) is duplicated *again* in prose at `artifacts.ts:250-251`.
Its genuinely load-bearing content is §0's "read ONLY map.md + decisions.md, never the
waypoint transcripts" (16-22) — roughly seven lines. Deleting it and giving `ideate`
a mapped-entry branch would remove the C3/C4 copies; keeping it and extracting the
shared blocks does the same with less blast radius. Single caller (`kind=converge`), so
the split is a judgement call, not an obvious win.

**F4. `qa/SKILL.md` (30 lines) — passes.** Nearly all of it is prohibitions
(`:20-22`) that no hook enforces (the edit guard blocks writes but nothing blocks
`complete_phase` for a qa session — `toolCompletePhase` has no kind check). The
prohibition is the value; it is not a pass-through.

---

## G. Deepening / consolidation / extraction opportunities (ranked)

1. **`extract:prompt-fragments`** — one home for the blocks currently written twice.
   Fixes C1–C5 and the root cause of D1/D2/D3/D5. Concretely: a `skills/_shared/`
   directory (or server-side constants the SKILL.md files reference by name) holding
   `grilling-discipline`, `context-hygiene`, `decision-entry-format`,
   `handoff-to-burn`, `mcp-cheat-sheet`. Locality: a vocabulary change becomes one
   edit instead of five. Leverage: the skills stop restating the tool contract.
   **Effort M, blast radius: 8 SKILL.md + artifacts.ts.** Two adapters exist → real seam.

2. **`extract:burner-preamble`** — hoist the C6 block (turn-ends-process, `<promise>`
   signal, no concurrency flags, file-tools-over-shell, stash ban, `BLOCKED.md`) into
   one fragment rendered into all three `burner/*.md`. Closes D6, which is a live
   behavioral gap for `research-waypoint.md`, not just tidiness. Two adapters already
   copy it → real seam. **Effort M, blast radius: 3 templates + 2 workflow render sites.**

3. **`extract:event-type-union`** — a `RuncastleEventType` union in `@runcastle/core`,
   with `record_event`'s zod input narrowed to it. Turns D3 and E3 into compile/runtime
   errors instead of prose drift. Also gives the web timeline a typed switch.
   **Effort M, blast radius: core + mcp/server.ts + every `emit()` caller + 6 SKILL.md.**
   Note the interaction: narrowing the schema would *reject* `tickets.emitted` from the
   skill — which is the desired outcome, but must land with the skill fix.

4. **`guard:template-placeholders`** — E2. Post-render assertion + a test that diffs
   each template's `{{…}}` set against its caller's key set. **Effort S, blast radius:
   `ticket-burner.ts` + `research.ts` + one test file.** Cheapest item on this list.

5. **`extract:skill-inventory`** — generate the three READMEs' skill tables and
   `plugin.json`'s description from the directory listing + frontmatter, or add a test
   that asserts they agree. Closes B1–B3 permanently. NOTICE.md's provenance list
   should be generated from `grep -l "Forked from"`. **Effort S, blast radius: docs + one test.**

6. **`unify:session-kind-registry`** — D10. One table keyed by `SessionKind` carrying
   `{ entrySkill, kickoffLine, promptRenderer, guardsEdits, projectScoped }`, so the
   compiler forces every axis when a kind is added. Speculative on its own (the
   renderers genuinely differ), but it is the structural fix behind D4 and the reason
   the waypoint prompt can lose `noCodeRule` without anything noticing.
   **Effort L, blast radius: launcher/*.**

---

## H. Cross-cutting candidates to pass UP

Ordered by how likely a sibling scope (server, web, docs) is holding the other half.

1. **`drift:review-verb-vocabulary`** — `Rethink` vs `Iterate` vs `Fix` vs
   `Merge` / `Merge & ship`. Present in **skills** (`project/SKILL.md:62`,
   `revisit/SKILL.md:3,30`; `ideate/SKILL.md:83`, `converge/SKILL.md:47`), **web**
   (`apps/web/src/lib/feature-ui.ts:1154,1169`, `apps/web/src/lib/vocabulary.ts:80-82`),
   **server** (`trpc/routers/feature.ts:90`, `artifacts.ts:265`), and **docs**
   (`CONTEXT.md` decision 15). The web scope should be asked which labels actually
   ship; the docs scope should be asked whether CONTEXT.md or the UI is canonical.
   Suspected shared module: a single user-facing **verb vocabulary** table
   (`apps/web/src/lib/vocabulary.ts` already exists and is the natural home).

2. **`duplication:mcp-cheat-sheet`** — the tool contract is authored in three places
   (`core/schemas.ts` zod, `mcp/server.ts` tool `description` strings, `SKILL.md`) and
   rendered from a fourth (`launcher/artifacts.ts`). The server scope will see the
   `description`↔`inputSchema` half of this (e.g. `server.ts:898` omitting
   `originWaypointId` that `schemas.ts:177` defines). Suspected shared module:
   **generated tool cheat-sheet** derived from the registered schemas.

3. **`drift:event-type-vocabulary`** — skills emit `tickets.emitted` /
   `phase.completed` that no server code emits or consumes, while services emit
   `tickets.stored` / `phase.advanced` / `phase.complete_requested`. The **web** scope
   should be asked what the timeline actually renders and whether unknown types
   degrade gracefully; the **server** scope holds the `emit()` call sites. Suspected
   shared module: **`EventType` union in `@runcastle/core`**.

4. **`stale:feature-size-full-collapsed`** — a removed concept still cited in three
   scopes. `packages/server/src/launcher/artifacts.ts:248` renders
   *"run `/runcastle:spec` (for a `full` feature)"* into every converge prompt;
   `docs/SPEC.md:39` still pins `FeatureSize = z.enum(['full','collapsed'])`;
   `CONTEXT.md` decision 7 says *"Small features may collapse Spec+Tickets"*. I found
   **no** `FeatureSize`/`size`/`'full'`/`'collapsed'` anywhere in `packages/core/src`
   or live `packages/server/src` (only a legacy column literal in
   `test/events-migration.test.ts:52`). Server and docs scopes hold the other halves.

5. **`drift:context-md-decision-numbers`** — two server comments cite CONTEXT.md
   decisions that say something else: `artifacts.ts:265` — *"surfaced as **Iterate**
   (CONTEXT decision #6)"* where decision 6 is "Git topology"; `features.ts:420` —
   *"the Iterate loop (CONTEXT.md decision #7)"* where decision 7 is "Phases". The
   charter was renumbered and the citations were not. Every scope that cites
   `CONTEXT.md decision #N` should be swept. Suspected fix: cite by **name**, not index.

6. **`inconsistent:prompt-rule-coverage`** — `noCodeRule` (`artifacts.ts:82`) is
   injected at 2 of 6 prompt renderers (`:147`, `:357`) while `edit-guard.ts:36`
   applies the deny to 6 of 7 kinds. This is the D4 root cause and is entirely
   server-side; the server scope should confirm whether `renderWaypointPrompt` /
   `renderConvergePrompt` / `renderPreparePrompt` omitting it is deliberate.
   Suspected shared module: **per-kind rule set** (see G6).

7. **`unvalidated:template-placeholders`** — E2. The `renderTemplate` fail-open
   contract lives in `packages/server/src/workflows/ticket-burner.ts:185`; the server
   scope owns the fix, this scope owns the templates. Flagging so the two are not
   fixed independently.

8. **`duplication:doc-inventory-tables`** — hand-maintained inventories that drifted
   (B1–B3 here). Likely the same smell in `docs/SPEC.md`'s file-ownership table and
   `CLAUDE.md`'s package/ownership tables (`CLAUDE.md` still says "4 MCP tools" against
   14 registered — known build-era drift, noted in passing per instructions). Suspected
   fix: generate or test-assert these tables.

---

### Verified-and-clean (recorded so a sibling does not re-raise them)

- All 12 MCP tool names referenced by skills exist with those exact names
  (`server.ts` registrations at 686–941). No phantom tools.
- All 7 `SessionKind`s resolve to an entry point; `prepare`'s lack of a skill dir is
  deliberate and documented (`sessions.ts:216-219`).
- `GateCheckId 'all-waypoints-terminal'` is live (`pipeline.ts:151-154,175`), not dead.
- All 8 SKILL.md files have well-formed frontmatter with `name` + `description` +
  `disable-model-invocation: false`, and every `name` matches its directory, so every
  `/runcastle:<name>` invocation in the prompts resolves.
- All 12 distinct `{{PLACEHOLDER}}` tokens across the three burner templates are
  supplied by their callers today (implement 6, research 4, resolve 9).
- Doc paths in the skills (`docs/features/<slug>/{brief,decisions,spec,map,test-notes}.md`,
  `docs/adr/`, `CONTEXT.md`) match `core/paths.ts:featureDocsRel`,
  `knowledge.ts:CHARTER_FILE`/`ADR_DIR_REL`, and `test-notes.ts:256`.
- `revisit/SKILL.md:30`'s claimed kickoff string `LAP <n> REVIEW ITERATION` matches
  `sessions.ts:242` exactly.
- **Unverifiable here:** whether `<promise>COMPLETE</promise>`
  (`implement-ticket.md:14`, `resolve-conflict.md:17`) is honoured by
  `@ai-hero/sandcastle@0.12.0` — `node_modules` is not installed in this worktree, and
  the only in-repo mention is a comment (`ticket-burner.ts:2041`). Not claimed as a
  finding.
