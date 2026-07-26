# Waypoint 2 — Audit Matt Pocock's skill library for what runcastle should adopt

**Answer.** Fork four things and fork them *for this feature*: `domain-modeling`
(+ `CONTEXT-FORMAT.md` / `ADR-FORMAT.md`) because it *is* the project-level memory
tier runcastle is missing and its three-part ADR test is a ready-made promotion
filter; triage's `.out-of-scope/` knowledge base because it is project-level memory
of the *rejected* decisions, checked at intake; `ask-matt`'s on-ramp taxonomy (the
model, not the router) because it names the three entry points runcastle lacks *and
each one's merge point back onto the main flow*; and `codebase-design`'s glossary
because runcastle already stores `tickets.seams` without ever defining "seam". Skip
`wayfinder`, `research`, `grilling`, `to-spec`/`to-tickets`, `implement`/`tdd`/
`code-review` and `setup-matt-pocock-skills` — all already forked or structurally
superseded — and skip `zoom-out`, which **no longer exists upstream**. The forks are
in good shape; the drift that matters is not in them but *around* them: runcastle's
root `CONTEXT.md` is not the artifact `docs/agents/domain.md` tells agents it is, and
`.sandcastle/fix-prompt.md` invokes a `diagnose` skill that exists neither in the
vendored pack nor upstream (renamed to `diagnosing-bugs`).

---

## Scope and method

The waypoint says "read `~/.claude/skills`". **That directory does not exist in this
sandbox** (`HOME=/home/agent`; `~/.claude/` contains only harness state). I read the
canonical upstream instead — `https://github.com/mattpocock/skills`, cloned and
unshallowed, pinned at **`ed37663` (2026-07-21)**, which is the same repo
`packages/skills/NOTICE.md:3-4` names as the forks' provenance.

Two consequences, stated plainly because they bound the confidence of everything below:

1. The human's local copy is the **skills.sh "copy into your project so you can hack
   on them"** install path (upstream `README.md`, "Two ways to install, two
   philosophies"), so it may carry personal edits I cannot see. Where a finding turns
   on exact upstream wording I cite the commit.
2. The local copy is demonstrably **behind** upstream — the waypoint asks for
   `zoom-out`, which upstream deleted (see below). Treat "what's in `~/.claude/skills`"
   and "what's in mattpocock/skills" as two different questions; I answered the second.

I read every skill the waypoint named, plus `grilling`, `grill-with-docs`, `to-spec`,
`to-tickets`, `prototype`, `setup-matt-pocock-skills`, `deprecated/qa`, and the
reference files `OUT-OF-SCOPE.md`, `DEEPENING.md`, `DESIGN-IT-TWICE.md`. On the
runcastle side I read all 7 pack skills, both burner prompts, `artifacts.ts`,
`mcp/server.ts`, `pipeline.ts`, `schemas.ts`, `knowledge.ts`, `docs/adr/`,
`docs/agents/`, `CONTEXT.md`, and the web entry points.

Where the question admitted two readings — "what should runcastle adopt" as *the
product* vs. *the repo* — **I took the product reading** and flag the repo-level
findings separately, because the map's destination is a product capability and
`packages/skills/packs/runcastle/` is the product's surface.

---

## Part 1 — Ranked adopt / skip

Ranked by value **to this feature** (project-level memory and project-level entry
points), not by general quality.

### Adopt

| # | Skill | One-line reason |
|---|---|---|
| 1 | `domain-modeling` + `CONTEXT-FORMAT.md` + `ADR-FORMAT.md` | Matt's entire answer to "knowledge that outlives a feature" is two artifacts — a glossary and ADRs, both written inline, both created lazily; this is the destination that decision #3's promotion needs. |
| 2 | `triage`'s `.out-of-scope/` KB | A concept-keyed, project-level record of *rejected* work checked at intake — runcastle buries out-of-scope prose per-feature in `map.md`, invisible to every later feature. |
| 3 | `ask-matt`'s on-ramp taxonomy (not the router) | Names the three on-ramps runcastle lacks *and* each one's merge point back onto the main flow, which is exactly the contract a project-level session needs to define. |
| 4 | `triage` (five-role machine + agent brief) | The on-ramp for work you didn't create; runcastle already vendored the label vocabulary at build time (`docs/agents/triage-labels.md`) and shipped no triage. |
| 5 | `codebase-design` (glossary only) | runcastle stores `tickets.seams` as a column and has `spec` sketch seams, but never defines "seam" — and the map wants cross-feature seam-collision detection, which needs one canonical meaning. |
| 6 | `improve-codebase-architecture` (scan + YAGNI scoping) | The upkeep on-ramp whose output is an *idea*, not a deliverable — the clearest demonstration of why a session must be able to exist without a feature. Skip its HTML report. |
| 7 | `diagnosing-bugs` | The strongest standalone discipline in the library, a natural `SessionKind`, and its Phase-1 completion criterion is gate-shaped; also the skill `.sandcastle/fix-prompt.md` already assumes exists. |
| 8 | `prototype` rule 6 (capture as primary source) | Upstream commits the spike to a throwaway branch and leaves a pointer; runcastle's waypoint prototype mode says "let it go" — that is knowledge loss, and this feature is about not losing knowledge. |
| 9 | `handoff`'s two rules | "Reference by path, don't duplicate" is prior art for the map's proposed-but-unlocked *link, never copy*; the "suggested skills" section is what a feature↔project handoff would need. |
| 10 | `DESIGN-IT-TWICE.md` | Parallel sub-agents designing one interface three radically different ways, then compared on depth/locality/seam — a ready-made second mode for the `prototype` waypoint type. |

### Skip

| # | Skill | One-line reason |
|---|---|---|
| 11 | `wayfinder` | Already forked as mapped ideation (ADR-0001) + `waypoint`/`converge`; re-forking would fight the fork — but three upstream refinements are worth back-porting (Part 2). |
| 12 | `research` | Already forked into `packages/skills/burner/research-waypoint.md`, and materially *better* than the 9-line upstream (pinned output path, doc structure, commit contract, scope rules). |
| 13 | `grilling` / `grill-me` / `grill-with-docs` | The primitive is already the spine of `ideate` §1 and `waypoint` §1; `grill-with-docs` is literally two lines ("run `/grilling`, using `/domain-modeling`"), so adopting it *is* adopting #1. |
| 14 | `to-spec` / `to-tickets` | Forked; the only post-fork upstream change (`ed37663`, 2026-07-21) deletes a line runcastle's fork never had. Nothing to do. |
| 15 | `implement` / `tdd` / `code-review` | All three already folded into `packages/skills/burner/implement-ticket.md` (its provenance header names exactly these three); a separate skill would duplicate the burner. |
| 16 | `setup-matt-pocock-skills` | A per-repo setup step is precisely the machinery runcastle's launcher replaces — the app injects tracker, tools, and doc paths per session via `--plugin-dir` / `--mcp-config`. |
| 17 | `zoom-out` | **Does not exist.** Deleted upstream in `47bde84` as "went unused in practice"; the recovered text is two sentences already covered by #1 and #5. |
| 18 | `deprecated/qa` | Deprecated upstream, and a *different thing* from runcastle's `qa` (it files bug reports as issues) — but see the naming-collision note below. |
| 19 | `resolving-merge-conflicts` | runcastle's git service and the human merge click own this territory; a real gap, but unrelated to project-level memory. |
| 20 | `teach`, `writing-great-skills`, `personal/*`, `misc/*`, `in-progress/*` | Out of domain. (`writing-great-skills` is worth *reading* when authoring new pack skills — a reference, not a fork.) |

---

## Findings behind the ranking

### 1. `domain-modeling` is the project-level memory tier, arriving pre-designed

Decision #2 in `decisions.md` says the gap is project-level memory. Matt's answer to
that exact gap is two artifacts and a discipline:

- `CONTEXT.md` — a **glossary and nothing else**. `CONTEXT-FORMAT.md` is emphatic:
  "totally devoid of implementation details… Do not treat `CONTEXT.md` as a spec, a
  scratch pad, or a repository for implementation decisions."
- `docs/adr/NNNN-slug.md` — one paragraph is a legitimate ADR: "The value is in
  recording *that* a decision was made and *why* — not in filling out sections."
- Both written **inline as decisions crystallise**, both **created lazily**.

Two details are directly load-bearing for this feature.

**The ADR test is the promotion filter.** Decision #3 says promotion moves "the durable
minority" of a feature's decisions up a tier, but does not say how to identify that
minority. `ADR-FORMAT.md` does, with a three-way AND: *hard to reverse* + *surprising
without context* + *the result of a real trade-off*. Adopt it verbatim as runcastle's
promotion criterion — it is battle-tested, it is short enough to sit in a skill, and it
is conservative in the right direction (`domain-modeling`: "Offer ADRs **sparingly**").
The list of what qualifies (architectural shape, integration patterns, lock-in
technology choices, boundary/scope decisions, deliberate deviations, invisible
constraints, non-obvious rejected alternatives) doubles as the promotion prompt.

**Inline beats batched, and runcastle already knows this.** `ideate` §2 already enforces
"append the moment a decision locks — immediately, one at a time, never batched at the
end," which is `domain-modeling`'s "Don't batch these up — capture them as they happen"
applied to `decisions.md`. Promotion should inherit the same rule rather than becoming a
ship-time batch job. Note the tension with decision #3's "it costs one tool call at ship
time": inline promotion and ship-time promotion are different designs, and the
inline-capture discipline runcastle already runs everywhere argues for inline.

**Adaptation required.** Matt's version writes files directly. runcastle's convention is
that every mutation goes through a service and emits an event (`CLAUDE.md`, Conventions:
"Every service function that mutates emits an event"). Promotion should therefore be an
MCP tool, not a file write — that is also what makes it indexable and what puts it on
the UI timeline.

### 2. `.out-of-scope/` is the sleeper, and it is a *new* idea for this feature

`triage/OUT-OF-SCOPE.md` describes a `.out-of-scope/` directory holding **one file per
rejected concept, not per issue**, serving two purposes: institutional memory of *why*
something was rejected, and **deduplication at intake** — "when a new issue comes in that
matches a prior rejection, the skill can surface the previous decision instead of
re-litigating it." Matching is by concept similarity, not keyword ("night theme" matches
`dark-mode.md`). It is read during triage step 1, and written only when an *enhancement*
is rejected — explicitly **not** when something is closed as already-implemented, because
that "would poison the dedup checks with false rejections."

This is the cheapest possible cross-feature knowledge, and runcastle has the *content*
already but in the wrong place. `MAP_SECTIONS` in `packages/server/src/services/knowledge.ts:59-64`
gives every mapped feature an `## Out of scope` section, and `waypoint/SKILL.md` §2 writes
dropped waypoints there. That prose is real project-level knowledge — "we ruled X out and
here's why" — and it is currently readable only by sessions on that one feature's map.

It also lands at exactly the right moment. The New Feature form is the single intake point
(`NewFeatureForm.tsx`, and the only work-creating action in `CommandPalette.tsx`), which is
precisely where a dedup check pays. Recommend: a project-level out-of-scope tier that
promotion writes to and feature creation reads from. Note that the map's parked idea
"a question-shaped `why(...)` tool returning cited answers" is the *search* half of the
same need; `.out-of-scope/` is the push half, and per decision #3 the push half wins.

### 3. `ask-matt`: adopt the taxonomy, skip the router

A router skill is redundant in runcastle — the launcher picks the entry skill from the
session `kind` (`artifacts.ts` `renderSystemPrompt` dispatches on kind; `SessionKind` is
`['ideation','qa','waypoint','converge','revisit']`, `packages/core/src/schemas.ts:40`).
The UI *is* the router. What is worth stealing is the shape of the space `ask-matt`
describes:

- **main flow** (idea → ship) — runcastle has this, and it is the whole product.
- **on-ramps** — *situations that generate work, then merge onto the main flow*: bugs
  piling up → `/triage`; something's broken → `/diagnosing-bugs`; a huge foggy effort →
  `/wayfinder`. runcastle has one on-ramp (New Feature) and one of these three
  (wayfinder, as mapped ideation).
- **codebase health** — `improve-codebase-architecture`, explicitly *not* feature work.
- **vocabulary underneath** — `domain-modeling` and `codebase-design`, model-invoked
  references that run beneath everything else.
- **crossing sessions** — `handoff` vs `/compact`.
- **standalone** — `prototype`, `research`, `teach`.

The sharpest part, and the reason to adopt the model rather than just the list: **every
on-ramp declares its merge point**. Triage "produces agent-ready issues, which
`/implement` later picks up." Architecture review "generates an idea you can take into the
main flow at `/grill-with-docs`." Wayfinder "hands off, it doesn't build: merge onto the
main flow at `/to-spec`." Translated into runcastle's terms, that is the missing contract
for the project-level session: *what does a non-feature session produce?* The answer is
per-ramp — triage produces a feature or an out-of-scope record; diagnosis produces a fix
or a feature; an architecture scan produces a seeded New Feature.

One structural rule worth noting: `ask-matt` is `disable-model-invocation: true`, and
upstream's README states the rule behind it — "A user-invoked skill may invoke
model-invoked skills, but never another user-invoked one." Every runcastle pack skill is
`disable-model-invocation: false`, including entry skills that invoke other entry-ish
skills (`ideate` → `spec` → `tickets`). This is a deliberate and probably correct
divergence — the launcher, not the model, chooses the entry skill, and the pack is
injected per-kind — but it means runcastle cannot borrow Matt's user/model split as a
design constraint if it starts adding skills. Worth stating explicitly somewhere.

### 4. `codebase-design`: runcastle already half-speaks it

`spec/SKILL.md` step 2 is a near-verbatim lift of `to-spec` step 2 ("prefer existing seams,
use the highest seam possible, the fewer the better, the ideal is one"), `tickets` carries
a `seams` field, and `tickets.seams` is a stored JSON column. But "seam" is never defined
anywhere in runcastle, and Michael Feathers' definition — *a place where you can alter
behaviour without editing in that place* — is not what most readers will assume.

`codebase-design` is pure vocabulary with no process: module, interface, depth, seam,
adapter, leverage, locality, plus four principles (the deletion test; the interface is the
test surface; one adapter = hypothetical seam, two = real; depth is a property of the
interface). It even has a *Rejected framings* section explaining why not "boundary"
(overloaded with DDD) and why not Ousterhout's lines-ratio definition of depth.

Adopting this is itself an act of `domain-modeling` on runcastle's own vocabulary, and it
has a concrete downstream payoff: the map parks "cross-feature conflict detection on
overlapping ticket `seams`" as an idea. Collision detection over a free-text field only
works if every feature's tickets name seams the same way. Adopt as a reference doc in the
pack that `spec` and `tickets` cite — and mirror the terms into whatever glossary
finding #1 produces.

### 5. `improve-codebase-architecture`: take the idea-generator, leave the report

Two halves. The scan half is genuinely useful and its YAGNI scoping rule (`45afd80`,
2026-07-13) is smart: walk `git log --oneline` for hot spots and weight the scan toward
recently-changed code, "because deepening a module pays off by making future changes to it
easier." runcastle can do this *better* than Matt can, because it has the feature index and
the burn history — the hot spots are already in SQLite.

The report half — a self-contained Tailwind+Mermaid HTML file written to `$TMPDIR` and
opened with `xdg-open` — is a workaround for not having a UI. runcastle has one. Skip it.

The reason this ranks as high as #6 despite not being memory plumbing: it is the on-ramp
that most cleanly proves the project-level session is needed. It operates on the codebase,
not on a feature; it produces an idea, not a deliverable; and there is nowhere in runcastle
today for either of those to live.

### 6. `diagnosing-bugs`: gate-shaped, and already assumed to exist

Phase 1 is the skill — "if you have a tight pass/fail signal for the bug, you will find the
cause… If you don't have one, no amount of staring at code will save you" — with ten ranked
ways to construct a loop and an explicit stop: "If you catch yourself reading code to build
a theory before this command exists, **stop**. No red-capable command, no Phase 2."

Its completion criterion is unusually machine-checkable: name one command, that you have
**already run at least once** (paste the invocation and its output), that is red-capable,
deterministic, fast, and agent-runnable. That is a gate in runcastle's sense — enforced,
overridable with a reason, seatbelt-not-cage. Its post-mortem also feeds the architecture
on-ramp ("what would have prevented this bug? If the answer involves architectural change…
hand off to `/improve-codebase-architecture`"), closing the loop `ask-matt` describes.

**And runcastle already depends on it without shipping it** — see Part 2, finding D.

---

## Part 2 — Fork drift

Short version: the six forks are in **good shape**. Only one substantive divergence from
upstream is worth correcting on its own merits (A); the rest are small (B, C). The findings
worth acting on are mostly *around* the forks (D, E, F).

### A. The map has no low-resolution decisions index — and the gist already exists, unpersisted

Upstream's map body has five sections; runcastle's has four. The missing one is
`## Decisions so far`, upstream's **index**: "one line per closed ticket: enough to judge
relevance, then zoom the link for the detail the ticket holds." Upstream is explicit that
this is the point of the map — "the map is an **index**, not a store… Sessions load the map
at low resolution and zoom into tickets on demand."

This was a considered divergence, not an accident: `docs/adr/0001-mapped-ideation.md:36`
says "wayfinder's 'Decisions so far' index is that file [`decisions.md`], not a new
artifact," and `docs/SPEC.md:258-265` locks the four sections. But `decisions.md` is
**full decision prose**, not a low-res index. `converge/SKILL.md` §0 has to read all of it,
which is fine for a five-waypoint map and defeats the compression on a twenty-waypoint one
— the exact failure mapped ideation exists to prevent.

The sharp part: **the index already exists and is simply not durable.**
`resolve_waypoint({id, disposition, summary})` takes a one-line `summary` described in
`waypoint/SKILL.md` §3 as "the one line shown on the map card." That is the gist. It lands
in SQLite and the UI, and never reaches the repo. So an agent reading only
`docs/features/<slug>/` — which is exactly what a *cross-feature* reader does, and exactly
what decision #1 says the merged case relies on — cannot get the low-res view at all.

**Recommendation:** have `resolve_waypoint` append its `summary` (plus a link to the
decision) to a `## Decisions so far` section of `map.md`. This is a one-line-per-waypoint
change that makes the map self-describing on disk, restores upstream's index/store split,
and — most relevant here — creates the cheapest possible cross-feature artifact: a
gist-level table of contents another feature can skim without loading anyone's full
`decisions.md`. It should be reconciled against ADR-0001 decision 2 and SPEC §13.4 rather
than done unilaterally.

### B. Waypoint types carry no HITL/AFK label

Upstream classifies each ticket type on a second axis: research is **AFK**, grilling and
prototype are **HITL**, task is either. The changelog says this fixed a reported bug where
`/wayfinder` grilled *itself* instead of the human — "a grilling agent that answers its own
questions has, by definition, broken HITL."

runcastle *implements* the axis structurally — research waypoints spawn an unattended run
(this document is one), grilling waypoints open a terminal — but neither `WaypointType`
(`packages/core/src/schemas.ts:87`) nor `waypoint/SKILL.md` §1 ever names it. The structure
makes the bug much harder to hit than upstream's, so this is low urgency. But naming the
axis in the skill costs a sentence and makes the invariant legible to the agent, which is
the condition upstream warns about.

### C. Two small vocabulary drifts

- **"design tree" vs "decision tree."** Upstream renamed this across all skills in
  `3bb587f` (2026-07-13), one day *before* the `ideate` fork. `ideate/SKILL.md` says
  "design tree" in three places (lines 24, 30, 50). Trivial in isolation — but it is a
  vocabulary term, and if runcastle adopts `domain-modeling`'s glossary discipline it
  should not ship a skill using the deprecated word.
- **`revisit` has no provenance header.** All six other pack skills carry one on line 6.
  `revisit` is original runcastle work with no upstream, which is fine — but `waypoint`
  handles that same case by *saying so* (`<!-- runcastle mapped-ideation waypoint session
  (ADR-0001 §13.5) -->`). Match the pattern rather than leaving it blank, so "no header"
  never reads as "we forgot to credit someone."

### D. `.sandcastle/fix-prompt.md` invokes a skill that exists in neither place

`.sandcastle/fix-prompt.md:19` says "**Diagnose with the `diagnose` skill**," and
`.sandcastle/implement-prompt.md:29` lists "**diagnose**" among the skills to reach for.
Two independent problems:

1. **It isn't vendored.** `packages/skills/` ships `packs/runcastle/skills/*` and two
   burner prompt templates — no diagnose skill. A sandcastle sandbox gets only what is
   mounted, so the instruction resolves to nothing.
2. **The name is dead upstream too.** `47bde84` renamed `diagnose` → `diagnosing-bugs`,
   breaking-change flagged: "invoke it as `/diagnosing-bugs` — the old `/diagnose` name no
   longer exists." So even a host with Matt's skills installed would not resolve it.

This is the most concrete correctable finding in the audit, and it is the strongest
argument for adopt #7: the burner already believes this discipline exists.

### E. `CONTEXT.md` is not the artifact `docs/agents/domain.md` says it is

`docs/agents/domain.md` in this repo is **byte-identical** to upstream's
`setup-matt-pocock-skills/domain.md` template — it was generated by running the setup skill
and never edited. It instructs agents: read root `CONTEXT.md` as the glossary, "use the
term as defined in `CONTEXT.md`," and treat a missing concept as a signal.

runcastle's root `CONTEXT.md` is not a glossary. It is a vision statement, 14 numbered
locked decisions, three design principles, and a deferred-threads list — no `## Language`
section, no terms, no `_Avoid_` lines. Compare Matt's own repo's `CONTEXT.md`, which is
exactly the prescribed shape (`## Language` / `## Relationships` / `## Flagged
ambiguities`). By `CONTEXT-FORMAT.md`'s own rule — "`CONTEXT.md` should be totally devoid
of implementation details… It is a glossary and nothing else" — runcastle's is closer to a
long-form ADR set than a glossary.

Nothing is broken today, because no skill in the shipped pack reads `CONTEXT.md` at all.
But it becomes a real conflict the moment adopt #1 lands, and it forces an explicit choice
that belongs in a later waypoint or the converge session:

- **Follow the format** — make `CONTEXT.md` a glossary, and move the 14 locked decisions
  to ADRs or a separate `VISION.md`. Honest, and it makes runcastle's own repo a working
  demo of the tier the product is about to ship. Costly and disruptive.
- **Fork the format deliberately** — say in `docs/agents/domain.md` that runcastle's
  `CONTEXT.md` is a decisions doc, and pick a different home for the glossary. Cheap;
  requires editing a file that is currently upstream-verbatim.

The same observation cuts the other way and is worth carrying into the design: runcastle
*already* keeps its durable project knowledge in exactly Matt's two buckets — a root
context doc and `docs/adr/0001–0006`. The tier the product is missing is one the repo has
had all along. That is the strongest available evidence that the tier is the right shape.

### F. Stale internal docs around the pack (repo hygiene, not fork drift)

Four counts of the same pack are given in four places and three are wrong:
`packages/skills/NOTICE.md:3-5` says "five of the six pack skills"; `packages/skills/README.md`
lists six and omits `revisit`; `packages/skills/packs/README.md` says "Four phase-scoped
skills" and shows four in its layout tree; `packs/runcastle/.claude-plugin/plugin.json`
describes the pack as "(ideate, spec, tickets, qa)". There are **seven**. Separately,
`CLAUDE.md` line 66 still says "4 MCP tools" where `mcp/server.ts` registers **nine**.

Not urgent, but it bears directly on this feature's thesis: these are exactly the
"documents that decay against the code" the map warns about, and they are the argument for
`spec.md`-style intent docs being excluded from cross-feature reads. A promotion mechanism
that copied these would propagate four stale facts.

### G. Naming collision worth knowing about

Upstream has a `qa` skill in `skills/deprecated/`. It is a *different thing* from
runcastle's `qa`: upstream's is an interactive bug-reporting session where the human
describes problems and the agent files issues; runcastle's is read-only Q&A over an existing
feature. runcastle's `qa` provenance header correctly credits `grilling + domain-modeling`,
not this — so the fork is not mislabelled. But the deprecated skill's *content* is a decent
model for the map's parked "non-feature intake" question (conversational reporting →
issues, with a single/breakdown scope assessment and honest blocking edges). If runcastle
builds that, **do not call it `qa`** — the name is taken, in both codebases, for something
else.

---

## Sources

**Upstream** — `github.com/mattpocock/skills`, commit `ed37663` (2026-07-21), read from a
local clone:

- `skills/engineering/ask-matt/SKILL.md` — flow taxonomy, on-ramps, merge points, context hygiene / smart zone
- `skills/engineering/domain-modeling/{SKILL,CONTEXT-FORMAT,ADR-FORMAT}.md` — glossary + ADR discipline, three-part ADR test
- `skills/engineering/wayfinder/SKILL.md` — map-as-index, five map sections, ticket types + HITL/AFK, fog vs out-of-scope
- `skills/engineering/improve-codebase-architecture/SKILL.md` — deepening scan, YAGNI scoping, HTML report
- `skills/engineering/codebase-design/{SKILL,DEEPENING,DESIGN-IT-TWICE}.md` — deep-module glossary, rejected framings, parallel design pattern
- `skills/engineering/triage/{SKILL,OUT-OF-SCOPE}.md` — five-role state machine, `.out-of-scope/` KB
- `skills/engineering/diagnosing-bugs/SKILL.md` — six-phase loop, Phase-1 completion criterion
- `skills/engineering/{research,to-spec,to-tickets,prototype,setup-matt-pocock-skills}/SKILL.md`
- `skills/productivity/{handoff,grilling}/SKILL.md`, `skills/engineering/grill-with-docs/SKILL.md`
- `skills/deprecated/qa/SKILL.md`
- `README.md`, `CONTEXT.md`, `CHANGELOG.md` (lines 89-98: `zoom-out`/`caveman` removal; `diagnose` → `diagnosing-bugs`)
- Git history: `3bb587f` design→decision tree (2026-07-13), `45afd80` YAGNI scoping, `2602257` research subagents, `7d694b7` decision tickets, `e74fee8` ask-matt wayfinder routing, `47bde84` removals + rename, `ed37663` to-tickets trim (2026-07-21)
- `zoom-out` recovered via `git show e112a6b^:skills/engineering/zoom-out/SKILL.md`

**runcastle** (this repo, branch `feature/feature-grouping-forking-and-referencing`):

- `packages/skills/packs/runcastle/skills/{ideate,spec,tickets,qa,converge,waypoint,revisit}/SKILL.md`
- `packages/skills/burner/{implement-ticket,research-waypoint}.md`; `packages/skills/{NOTICE,README}.md`, `packages/skills/packs/README.md`
- `packages/server/src/launcher/artifacts.ts` (`renderSystemPrompt`, lines 59-286); `packages/server/src/mcp/server.ts` (9 tools, lines 298-461)
- `packages/server/src/services/knowledge.ts:58-91` (`MAP_SECTIONS`, `scaffoldMapDoc`); `packages/server/src/services/features.ts:443-468` (`escalateToMap`)
- `packages/core/src/schemas.ts:40` (`SessionKind`), `:87` (`WaypointType`), `:99-110` (`WaypointInput`); `packages/core/src/pipeline.ts` (phases, G1-G5)
- `apps/web/src/components/{NewFeatureForm,CommandPalette}.tsx` (the single on-ramp)
- `docs/adr/0001-mapped-ideation.md` (esp. line 36); `docs/SPEC.md:258-278` (§13.4-13.5)
- `docs/agents/{domain,issue-tracker,triage-labels}.md`; `CONTEXT.md`; `CLAUDE.md`
- `.sandcastle/{fix-prompt,implement-prompt}.md` (the `diagnose` reference)
- `docs/features/feature-grouping-forking-and-referencing/{decisions,map}.md`

---

## Open questions

Noted, not chased — each belongs to another waypoint or to converge.

1. **Does the human's `~/.claude/skills` differ from upstream?** Unresolvable here (the
   directory is absent). It matters only if a local edit is the thing worth forking; the
   `zoom-out` evidence says the local copy is *behind*, not ahead, so the risk is low.
2. **Glossary or vision doc — which is `CONTEXT.md`?** Finding E forces this choice, and it
   is a decision, not a fact. It belongs to whichever waypoint owns knowledge tiers.
3. **Inline promotion or ship-time promotion?** Decision #3 says "one tool call at ship
   time"; `domain-modeling` and `ideate` §2 both say never batch. Both are defensible; the
   tension is real and unresolved. Owner: the promotion waypoint.
4. **Should `resolve_waypoint`'s `summary` land in `map.md`?** Finding A recommends yes, but
   it touches ADR-0001 decision 2 and SPEC §13.4, so it needs an amendment, not a patch.
5. **Which on-ramps does the project-level session actually get?** Finding #3 supplies the
   candidates (triage, diagnosis, architecture) and the merge-point contract; picking and
   sizing them is the project-level-session waypoint's job.
6. **Does `.out-of-scope/`-style dedup want an agent or an index?** Upstream matches "by
   concept similarity, not keyword," which upstream can do because a triage agent reads
   every file. runcastle's intake is a form, not a session. Whether the check runs as a
   background agent, an embedding index, or a prompt in the first ideation turn is a design
   question this research did not close.
