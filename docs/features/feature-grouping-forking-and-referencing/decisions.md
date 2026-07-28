# Decisions — Feature grouping, forking, and referencing

## 1. The primary case is chaining onto *merged* work, not in-flight work
**Decision:** Cross-feature knowledge access is designed for features whose branch
has already merged into the base (shipped work). Reading the docs of an *in-flight*
feature across branches is not the driving requirement.
**Why:** A merged feature's `docs/features/<slug>/` is already present on disk in any
later feature's worktree (verified: `docs/features/streamlining-user-experience/` is
readable from this worktree because that branch was merged). So the merged case needs
only discovery — a pointer and an index — not cross-branch machinery. Designing for
the in-flight case would have forced server-side reads out of other features'
worktrees for a case the human does not actually hit.

## 2. The real gap is project-level memory, not three separate conveniences
**Decision:** Grouping, forking, and referencing are not the feature. They are three
symptoms of one gap: runcastle has **feature-level memory but no project-level
memory**. The feature's north star is project-level knowledge and project-level entry
points — ADRs, cross-feature access, a session that is not bound to a feature,
relations between features, and a way in for work that does not deserve a feature.
**Why:** Chasing the three named conveniences separately would have produced three
mechanisms that each half-solve the same thing. Naming the shared gap lets one
coherent set of primitives cover all three, and keeps the design honest about what
is actually missing.

## 3. Promotion beats search
**Decision:** The primary mechanism for making past knowledge available is
**promotion** — the durable minority of a feature's decisions is moved up to a
project-level location that every session reads by default. Cross-feature **search**
is the fallback for the long tail, not the primary path.
**Why:** Search is pull: the agent must know to look, guess a query, and sift dozens
of feature directories — and it silently returns nothing when the agent doesn't think
to ask. Promotion is push: it costs one tool call at ship time and then works for
free, forever, with no agent initiative required. Both are wanted; the ordering is
what matters.

## 4. Escalate to a map rather than grill on
**Decision:** This feature is charted as a waypoint map instead of being ground
through in one ideation window.
**Why:** The scope resolved into six-plus independent areas (knowledge tiers,
promotion, cross-feature access, the project-level session, non-feature intake,
feature relations), each its own session's worth of grilling. Continuing in one window
would have meant going deep on one area and leaving the rest untouched — exactly the
rabbit-hole the escalation branch exists to prevent.

## 5. Maps decompose *within* a feature; the project-level session decomposes *into* features
**Decision:** These are different tools for different shapes of bigness, and the map
is the right one here only because runcastle cannot yet do the other. A waypoint map
splits one feature into questions worked in sequence and converging back to one spec.
A project-level session would instead have spawned this scope as **several independent
features**, each shippable on its own.
**Why:** Recognised during this very session — this scope is genuinely several
features, not one big one, and the only reason it becomes a map is that runcastle has
no way to create features from anywhere but the New Feature form. That is itself
evidence for the project-level session, and it is the sharpest argument for building
it early.

## 6. Five knowledge tiers, separated by write mode and scope
**Decision:** A runcastle project has exactly five knowledge tiers. This is the
vocabulary every other waypoint on this map uses; none of them may redefine it.

1. **Charter** — `CONTEXT.md` at the repo root. What the project is, the words it
   uses (a `## Language` glossary section in Matt's format), and the design
   principles it will not violate. Project scope. **Rewritten in place** — it always
   describes the present, never the past.
2. **Decision log** — `docs/adr/NNNN-<slug>.md`. Project-scope decisions.
   **Append-only**: an overturned ADR is marked superseded, never edited away.
3. **Feature decisions** — `docs/features/<slug>/decisions.md`. Why *this* feature is
   shaped the way it is. Feature scope, append-only, durable after ship.
4. **Feature spec** — `docs/features/<slug>/spec.md`. Feature scope, true at exactly
   one moment (see 8).
5. **Working docs** — `brief.md`, `map.md`. The seed and the navigation for one
   ideation. Feature scope, ephemeral: dead the moment the feature ships.

The load-bearing axis is **rewritten-in-place vs append-only**, not importance — it
is the rule that tells an agent whether to edit a file or add to it.

**Why:** Matt's `CONTEXT.md` is a *glossary* (ubiquitous language, terms with
`_Avoid_` lists); runcastle's own `CONTEXT.md` is a *charter* (vision, locked
decisions, principles) with no glossary in it at all. Two documents, one filename —
the product would have inherited that collision. One file with two sections resolves
it without adding a third project-level doc (less-mechanism principle), and both
halves share identical read semantics: always injected, always current. The glossary
earns its place in runcastle specifically because **agents** author the docs here —
vocabulary drift across twenty sessions ("waypoint" in one, "map node" in the next)
is the most likely way cross-feature knowledge rots, and it rots silently.

## 7. An ADR is a feature decision that outgrew its feature
**Decision:** Matt's three-part filter (hard to reverse / surprising without context /
result of a real trade-off) is a **quality** filter, not the ADR boundary — most
`decisions.md` entries pass all three. The boundary is **blast radius**: an ADR is a
decision that a stranger working on an unrelated part of the codebase must obey
*without ever reading this feature's docs*. If it only makes sense while reading this
feature's code, it stays in `decisions.md`. A promotion candidate must pass Matt's
three **and** the blast-radius test.

Corollary on lineage: **every ADR is born as a `decisions.md` entry.** A feature
session never hand-writes into `docs/adr/` — it nominates. Direct project-level
authoring, if it exists at all, belongs to the project-level session (waypoint 5's
call). The promotion *mechanism* — who fires it, at which pipeline moment, and what
happens to a superseded ADR — is waypoint 3's; this waypoint fixes only what is
eligible.

**Why:** if the test were quality, both files would collect the same entries and the
split would be arbitrary. Scope is objectively checkable by an agent — "would someone
who never opens this feature need this?" — where "is this important?" is not. Routing
all project knowledge up through the feature record also keeps one unbroken provenance
chain: every ADR can point back at the grill that produced it.

## 8. `spec.md` decays and is never read across features
**Decision:** `spec.md` is a **build order, not a record**. It is true at the moment
tickets are emitted; from the first merged burn onward, the code is the truth. It is
read by this feature's burners and its review pass and by nothing else — never carried
into another feature's context, never indexed for cross-feature access. A later
feature that needs to know how something works reads the **code** (what it does) and
the ADR / `decisions.md` (why it is that way). At ship, `spec.md` gets a decay stamp in
its header marking it superseded by the code.

**Why:** runcastle already proved this by hand. Its own `CLAUDE.md` opens with
"Build-time document… some references describe build-era states the code has since
moved past" — a stamp a human had to write *after* being misled by it. Carrying a
decayed spec across features is worse than carrying nothing: it reads authoritative,
is silently wrong, and an agent has no cheap way to tell.

## 9. Findings are not a tier
**Decision:** Research output — version pins, API shapes, competitor sweeps, the
adopt/skip list a `research` waypoint returns — is an **input**, not a knowledge tier.
A finding either becomes a **decision** (promoted to whichever tier it earns), or a
**constraint** (stated in the charter or an ADR: "we are pinned to X because Y"), or it
is scratch that dies with the feature — folded into `map.md` Notes as "facts
established, do not re-derive", which this very map already does. runcastle does not
create a `docs/research/` tier in user projects.

**Why:** findings decay faster than specs and accumulate faster than anything else, so
a findings tier would be the first thing to rot and the largest thing to index. A
finding that actually matters is always expressible as a decision or a constraint; one
that resists both expressions was never durable. runcastle-the-repo's own
`docs/research/*` is a bootstrapping artifact of building the stack, not a pattern to
ship to users.

## 10. Single-context by default; no subsystem tier
**Decision:** A runcastle project has one `CONTEXT.md` and one `docs/adr/`. Matt's
multi-context shape (`CONTEXT-MAP.md` plus per-context `CONTEXT.md` and `docs/adr/`)
is recognised as the growth path but is not built: there is no per-subsystem knowledge
tier between project and feature.
**Why:** it is purely additive later — a `CONTEXT-MAP.md` appearing at the root is the
signal, exactly as in Matt's format — and nothing else on this map depends on it.
Building it now would double the "where does this go?" decision every promotion has to
make, for a shape no dogfooded project has needed yet.

## 11. Nomination is a field on the decision, written by the session that decides
**Decision:** A `decisions.md` entry marks itself as a promotion candidate with a third
field on the entry itself:

```markdown
## 7. An ADR is a feature decision that outgrew its feature
**Decision:** …
**Why:** …
**Scope:** project
```

Absent the line, the entry is feature scope — the default is "stays here." The session
that writes the entry applies decision 7's eligibility test (Matt's three **and** blast
radius) and adds the line. Nomination is a **property of the entry, not an event at a
pipeline moment**: any later session — a review-phase `revisit`, the converge pass — may
add or remove the line on an existing entry until ship freezes it. There is no
nomination tool call and no nomination pass.

**Why:** decision 7 made eligibility a judgement ("would a stranger who never opens this
feature need to obey this?"), and the only moment that judgement is cheap is while the
argument is still in context. A later auditing pass reads frozen prose and has to
reconstruct the rejected alternatives, the reversibility cost, and who else the decision
binds — all of which the grilling session had in front of it. Decisions 6 and 7 in this
very file are legible as project-scope only because they happen to *argue* about scope;
an auditor reading 1 and 4 would be guessing. Making it a prose field rather than a tool
costs literally nothing (one line in text the agent is already writing) and keeps the
"less mechanism" principle intact. The escape hatch for blast radius that only becomes
visible after implementation is the editability rule above — late nomination needs no
new machinery because nomination was never an event.

## 12. Promotion is automatic at merge, visible beforehand, opt-out per item
**Decision:** Promotion fires as part of the **Merge** click, server-side, as one
promote-then-merge action on the feature branch:

1. for each `**Scope:** project` entry not already promoted, write
   `docs/adr/NNNN-<slug>.md` (next free number);
2. stamp the source entry with `→ promoted to ADR-NNNN`;
3. commit both to the feature branch;
4. merge as today.

The review pane lists what will be promoted and lets the human uncheck an item, but the
merge is **never blocked** on dispositioning that list — promotion is a default that
fires, not a gate. No new session kind is introduced.

Three consequences, stated so they are not rediscovered later:

- **Promotion copies, deliberately.** `map.md` carries "link, never copy," but that rule
  governs documents that get *edited*. Both sides here are append-only and frozen at ship
  (decision 6), so there is no drift channel; and a pure link would defeat decision 7's
  blast-radius test, which says the reader must not have to open the feature's docs. The
  copy carries `source: docs/features/<slug>/decisions.md#N` so provenance survives.
- **The transform needs no LLM.** An ADR is "1–3 sentences: context, what we decided, and
  why" (`ADR-FORMAT.md`); a `decisions.md` entry is already title + Decision + Why. The
  mapping is mechanical.
- **`DOCS_PATHSPEC` must widen.** `commitDocs` stages only `docs/features`
  (`packages/server/src/services/git.ts`), so promotion either extends the pathspec to
  `docs/adr` or takes its own commit. This is the one place the feature touches existing
  git machinery.

**Why:** there is no agent at ship — session kinds are `ideation | qa | waypoint |
converge | revisit`, and G5 (`human-merge`) is a button calling `mergeFeature`. So
"the shipping session promotes" was never available; the choice was really between
inventing a session and making the step mechanical. Because nomination (decision 11)
already carried the judgement, what remains at ship is a transform, and a transform can
run inside the merge action. Beyond mechanics: runcastle is serial HITL, so the human was
*present* for every decision being nominated — a confirm dialog at ship asks them to
re-adjudicate weeks later with less context than they had the first time. And the errors
are asymmetric: a wrong promotion is visible and cheap to reverse (supersede it, which the
format is built for), while a missed promotion is invisible forever. The known risk is
over-nomination bloating an always-read tier; the pre-merge list is the pressure valve,
and the fix for a persistently wrong count is tightening the eligibility prose in the
skill, not adding a gate. Writing the ADR on the feature branch *before* the merge is what
makes "this feature's knowledge became the project's knowledge" a single atomic commit
rather than a merge plus a stray commit to the base branch.

## 13. A superseded ADR is stamped in place and leaves the default context, never disk
**Decision:** When a later decision overturns a live ADR:

- the overturning entry nominates with its target — `**Scope:** project (supersedes
  ADR-0004)` — so the same mechanical transform does two writes: the new ADR carries
  `supersedes: 0004`, and ADR-0004's status flips to `superseded by ADR-0009`;
- **the status line is the only permitted edit to a shipped ADR.** It changes a *pointer*,
  not a *claim* — the body stays exactly as written. Any other edit to a shipped ADR is a
  bug, and this is the sole exception to decision 6's append-only rule for this tier;
- **it does not move.** No `superseded/` subdirectory, no renumbering — ADRs cite each
  other by path, and moving a file breaks every inbound pointer to buy tidiness;
- **it leaves the always-read set but stays reachable.** The injected/indexed set is live
  ADRs only; superseded ones remain on disk, marked, and reachable on demand by the
  cross-feature access tool (waypoint 4).

Promotion targets `docs/adr/` and only `docs/adr/`. A decision that overturns something in
the charter is explicitly **not** handled here — the charter is the one rewritten-in-place
tier and its edit lifecycle is waypoint 8's question.

**Why:** the value of knowing a decision was overturned is carried by the **link**, not by
the superseded record's presence in every session's context. ADR-0009 states what it
supersedes and why, and a reader who asks "did we ever consider X?" follows the chain back
to the intact original argument. Keeping superseded records in the default set would make
the always-read tier grow monotonically with the project's history of changing its mind —
a project that reverses course three times on one question should cost one ADR of context,
not four — which is the same size pressure decision 12 already has to manage. The accepted
trade-off: a session that never follows the chain can re-propose something already tried,
since the rejection is not in front of it. That is the right side to err on, because a
*reasoned* reversal is recorded in the new ADR's "why", and the on-demand path exists for
the reader who asks directly.

## 14. Cross-feature access is a navigator, not an oracle
**Decision:** runcastle does **not** build a question-shaped `why(...)` that returns a
synthesised cited answer. It builds a navigator in four parts:

1. **Injected, full text** — the charter and the **live** ADRs, rendered into the session's
   system prompt at launch from live state (decision 13 already fixed the membership; this
   fixes the delivery). Not a committed index file, so it cannot drift.
2. **Injected, one line each** — a **project index** generated at launch from the features
   table: slug, one-liner, status (`shipped` / `in flight`), and the path to that feature's
   docs. In-flight features appear by title only.
3. **On demand, no new tool** — every other doc (`decisions.md`, briefs, superseded ADRs) is
   read with the session's ordinary `Read`/`Grep`. The index says where; the file gives the
   unabridged argument.
4. **On demand, one MCP tool** — the records that live only in SQLite (decision 15).

Burners get part 1 and nothing else: the injected set is appended to
`packages/skills/burner/implement-ticket.md`'s context, because decision 7's blast-radius
test — "a stranger working on an unrelated part of the codebase must obey this without ever
reading this feature's docs" — is a literal description of a burner. Parts 2–4 are
talk-session surfaces.

**Why:** the retrieval gap does not exist. A talk session is Claude Code in a worktree where
every merged feature's `docs/features/<slug>/` is already on disk (map.md, facts
established); the gaps are *navigation* and *staleness*, and an index plus a status word
close both. `why(...)` would have required an LLM inside a server that has none — it is Hono
+ tRPC + SQLite, and decision 12 already established there is no agent at ship — buying
inference cost and latency in order to compress prose for a caller that is itself a
large-context LLM holding the same repo. Worse, it launders: a paraphrase with a citation
reads authoritative while discarding the rejected alternatives and the trade-off, which is
the entire payload of a decision record — the exact failure mode decision 8 named ("reads
authoritative, is silently wrong, and an agent has no cheap way to tell"). The one real
argument for `why(...)` — that vocabulary drift (decision 6) means an agent cannot guess the
keyword — is a table-of-contents problem, and at runcastle's scale (tens of features, each
with titled, one-line-summarised decisions) a generated title index beats a semantic index
outright and costs nothing to keep fresh. This is decision 3's argument one level down: push
beats pull, and pull that fails silently is worse than no pull.
**Scope:** project

## 15. The work record indexes facts, never intent
**Decision:** The one new MCP tool returns a feature's **work record**, not its tickets. Per
feature: ship date, run summaries, and a flat list of `{ seq, title, status, seams[],
commits[], error? }`. It explicitly does **not** return a ticket's `goal`, `context`, or
`acceptanceCriteria`. It is queryable two ways — by feature slug ("what did X actually
do?") and by seam ("who has touched this path before, and why?").

Failures are indexed as facts, not as knowledge: an `error` is a pointer meaning "this area
has bitten us", which sends the agent to the code and the decisions. A recurring failure that
deserves to become a rule is promotion's problem (waypoint 3), not access's.

**Why:** a ticket's body fails decision 8's own test. `goal`/`context`/`acceptanceCriteria`
are intent at a moment — `spec.md` chopped into slices, written before the code existed —
and the burner may have satisfied them by another route, or a review iteration may have
overwritten the result. Carrying them across features is handing a later agent a decayed spec
with none of decision 8's decay stamp on it. What survives is the residue that is true as
history and cannot be wrong later: seams, commits, status, error, timings, and the title as a
label rather than a claim. The tool earns its existence because these rows live only in
SQLite — `commitDocs` stages `docs/features` and nothing else — so no file tool can reach
them, and because `seams` is the **only link from a path in the codebase back to the argument
that put it there**: git gives `path → commit → message`, while `seams` gives `path → ticket
→ feature → decisions.md`. The seam query is kept despite overlapping waypoint 7's collision
detection: it is one filter over a column that already exists, it is the question an agent
actually has mid-implementation, and one tool serving two consumers is cheaper than two.

## 16. Provenance is a status word; there is no freshness heuristic and no size ceiling
**Decision:** Indexed material carries a **status word** and a provenance address, never a
confidence or recency score. Four states, exhaustive:

- **`current`** — a live ADR or the charter. This binds you.
- **`historical`** — a shipped feature's `decisions.md` entry. A true account of why that
  feature is shaped that way; scoped to it, never binding on you.
- **`superseded`** — carries `superseded by ADR-NNNN`. Read the pointer; read the body only
  for the original argument.
- **`in flight`** — an unmerged feature. Not real yet: a heads-up, not a constraint.

Provenance is one line per item — `docs/features/<slug>/decisions.md#N` for docs, slug plus
commit shas for the work record — always an address the agent can open, extending the
`source:` convention decision 12 gave promoted ADRs.

The always-injected set has **no size ceiling and no truncation**. Charter in full, live ADRs
in full, index one line each.

**Why:** every item we chose to index is an append-only *why*-record, and those do not decay
— "we chose promote-then-merge because there is no agent at ship" is as true in five years as
the day it was written. An age-based discount would teach the agent to distrust the one class
of document in the project that never goes wrong. The things that genuinely decay were
designed out of the corpus instead of labelled: `spec.md` by decision 8, ticket bodies by
decision 15. So the only real question is "is this still what we do?", and decision 13 already
answered it with an explicit supersession pointer rather than a guess. The load-bearing
consequence is that **the agent is never asked to adjudicate trust** — it looks up a status
the database already knows. On size: when the live ADR set grows painful, that is the
over-nomination pressure decision 12 named, whose stated fix is tightening eligibility prose.
A ceiling would silently drop ADRs, turning "this binds you" into "this binds you unless it
did not fit" — the same silent failure decision 3 rejected. It should hurt visibly.

## 17. The project-level session is the New Feature form with a brain
**Decision:** runcastle gains a project-scoped session (kind `project`) whose defining job is
**intake and decomposition terminating in feature creation**: take a lump of raw intent, grill
it until it resolves into N features, and create them. Three jobs ride along as support, not
as peers:

- **Portfolio Q&A** — "have we already decided X", "did we ever build Y". This is the same
  lookup intake needs anyway to avoid creating a duplicate feature; it is `qa` at project scope.
- **Routing** — deciding an incoming thing is a bug, a tweak, or an existing feature's revisit
  rather than a new feature. Same act as decomposition: read the intent, pick the record.
- **Cross-feature curation**, deliberately declawed to **advisory only**. The session may
  report that two in-flight features are on a collision course or that an ADR looks stale; it
  does not fix either. Every fix routes back through a feature, through promotion (decision
  12), or through the charter's own lifecycle (waypoint 8).

**Why:** the New Feature form demands a title and a one-liner *up front*, which means it
demands the human has already decomposed their thought into a feature. Decision 5 is the
receipt — this map exists only because there was no way to say "here is a lump of intent, it
is probably five features" and have runcastle do the cutting. Naming the session by its scope
("a session at project level") describes a container, not a purpose, and an agent whose
purpose is "anything not feature-shaped" is exactly the open-ended do-stuff agent the guided
pipeline exists to prevent; naming it by the one job no other surface can do is what bounds
it. Curation is cut back because it is the precise point where this session would quietly
become a project editor with standing write access to the charter and `docs/adr/` — and the
value of noticing a collision is fully captured by *saying so*, with none of the blast radius
of acting on it.

## 18. Agents never write the human's checkout — the project session works on a runcastle-owned branch and lands on base
**Decision:** the project session **does write the repo** — real edits, real commits, no
sandbox theatre — but never in the main checkout. It runs in
`~/.runcastle/worktrees/<projectId>/__project/` on a runcastle-owned branch
(`runcastle/project`, matching the existing `runcastle/*` temp-branch namespace) cut from the
base tip at launch, and its commits are landed onto the base branch by the existing
`mergeTempBranch`. Five consequences:

- **Nothing is mutually exclusive.** The project session never *holds* the base branch, so the
  test drive, the merge and the project terminal never contend for the one checkout. One live
  project session per project, orthogonal to feature terminals — `assertSpawnable`'s
  one-live-session rule exists for a git reason (one talk worktree, and git forbids two
  checkouts of one branch) that simply does not apply here.
- **Landing is shipped code, unchanged.** `mergeTempBranch`'s three cases each do the right
  thing: a clean main checkout on the base branch → the merge runs there and fast-forwards the
  human's working tree exactly like a `git pull`; mid-test-drive, when nothing holds the base
  branch → `git fetch . <temp>:<base>` updates the ref with no checkout at all; base moved
  ahead → the disposable-worktree merge. It refuses rather than clobbers uncommitted work.
- **Edits imply commits.** A session that writes but cannot commit leaves the checkout dirty,
  and a dirty tree is precisely what `testDrive` refuses on (`DENY_DIRTY`) and what jams the
  next merge. Write-without-commit is strictly worse than both, so the skill's closing move is
  *land what you wrote and leave the tree clean*.
- **`--permission-mode default`, not `acceptEdits`.** Feature terminals get `acceptEdits` plus
  pre-approved `git add`/`git commit` on the stated grounds that talk worktrees are docs-only,
  so even `git add` can only touch feature docs. That justification evaporates here: this
  session can touch anything in the repo and land it on the base branch. Prompting is also
  what the human's own Claude Code does, which is the point.
- **Direct project-level authoring exists, and it lives here.** Decision 7 deferred this to
  this waypoint; the answer is yes. There are exactly two on-ramps to an ADR and they do not
  overlap: **promotion at merge** (decision 12) for decisions born inside a feature, and **the
  project session** for project-scope decisions that never had a feature ("we standardise on
  Bun, never npm"). The same hands may write `CONTEXT.md`.

**Why:** "writable on the base branch" has only two physical realisations — git refuses a
second worktree on a branch the main checkout already holds — so it is either the main
checkout itself or a transfer, and the main checkout is a three-way collision (the human's
test drive needs it clean and flips its branch; `mergeFeature` refuses outright during a
drive). Taking it would have made the project terminal a third claimant and imposed mutual
exclusion on a surface that has never had any. Moving the test drive out instead fails on why
it lives there at all — `devCommand`, `node_modules` and `.env` are in that checkout — and
would sacrifice the thing the human values most to protect a terminal. The deciding argument
for the temp branch is consistency rather than convenience: **every other agent in runcastle
that writes already works on a `runcastle/*` branch and lands via `mergeTempBranch`** —
burners, research runs. The project session doing the same makes it an ordinary citizen of the
existing design instead of the one exception that touches the human's checkout directly, and
it costs a branch name, a worktree and a call to a function that already exists. The accepted
trade-off is that the session's cwd is a worktree path rather than the repo path — "my own
terminal" in every respect except the string in the prompt — and that landed commits arrive in
the human's checkout unprompted, which is `git pull` behaviour and refuses rather than
clobbers. Because this also means only one session in the whole system may write the charter,
and it is singleton, waypoint 8 inherits a strong serialisation story it may take or leave:
feature sessions never touch the rewritten-in-place tier at all.
**Scope:** project

## 19. Sessions gain a project scope; the project session gets four tools and none of the pipeline's
**Decision:** `sessions` mirrors `events`: add `projectId` **NOT NULL**, relax `featureId` to
**nullable**. The invariant becomes "every session belongs to a project; a session may belong
to a feature." Its MCP surface is four tools, and deliberately none of the existing nine:

- `create_feature({ title, oneLiner, baseBranch?, brief? })` — the point of the session.
- `get_project_context()` — project, charter, live ADRs, and decision 14's one-line feature
  index (slug, one-liner, phase, status, docs path).
- `get_work_record(...)` — decision 15's tool, unchanged.
- `record_event({ type, message })` — project-scoped, `featureId` null, which the events table
  already supports.

Withheld: `emit_tickets`, `complete_phase`, `emit_waypoints`, `resolve_waypoint`,
`escalate_to_map`, `update_ticket`, `cancel_ticket` — every one of them advances a feature
through a gate, and a session with no feature has no business touching them. Reading any
feature's docs needs no tool at all (decision 14 part 3).

Two shapes on `create_feature`, both settled: it **carries a real brief** — the `brief` field
is written straight into `brief.md` at creation instead of `scaffoldDocs` generating one from
title + one-liner — and it **does not launch** what it creates. `mostRecentResumableSession`
is keyed by `featureId` and needs a project-keyed sibling, so a project terminal resumes its
own last conversation the way an ideation terminal does.

**Why:** the migration is not a novel call — `events` took exactly it for issue #44
(`projectId` NOT NULL, `featureId` nullable), so "scope up, feature optional" is already this
schema's established shape. The alternative, a sentinel `__project` pseudo-feature row, avoids
one migration by polluting `feature.list`, the sidebar, the pipeline and every gate check with
a permanent fake feature. On the brief: the session will have just spent the conversation
working out *why* feature three exists and what it must not swallow, and without a pass-through
that reasoning evaporates when the terminal closes — decision 5's counterfactual only works if
the five features it would have created carry five real briefs rather than five one-liners. On
not launching: spawning terminals from inside a terminal makes the project session an
orchestrator, where runcastle's serial-HITL premise is that the human decides what to work on
next; the sidebar polls at 1.5s, so new cards appearing *is* the feedback.

## 20. It lives on the features rail, and it ships first out of this map
**Decision:** the project session lives **inside `ProjectShell`, as a pinned row at the top of
the features rail** — always present, showing the project rather than a feature. Selecting it
swaps `Workspace` from the feature workspace to a project workspace (the terminal, with the
feature index and charter as its resting state) and hides `Inspector`, whose every panel is
feature-scoped. It is **not** on the portfolio home: that is the cross-project surface and this
session is bound to one project's repo. The New Feature path gains a sibling affordance — *not
sure it's one feature? talk it through* — and the project workspace's chrome states its branch
and its consequence (writing to the base branch; commits land in your checkout).

Sequencing: this is the **first** slice converge should cut out of this map, ahead of knowledge
tiers + promotion.

**Why:** placement follows scope — the rail already is the project's list of things to work on,
and the project session is the one entry on it that is not a feature. The discovery affordance
matters more than it looks: `EmptyWorkspace` and the New Feature button are today the only two
doors and both demand a title the human may not have yet, which is exactly the gap decision 5
recorded — so the fix belongs on the screen where the gap is hit, not only as a rail item that
must be noticed. On order: the project session changes how work *enters* runcastle, which
compounds (every later feature is better cut), where promotion improves the quality of
knowledge that already exists, which is linear — and promotion has nothing to promote on day
one, since it only starts paying once features ship carrying `**Scope:** project` lines, so
building it first builds a mechanism that idles. The known weakness, which argues for
sequencing rather than reordering: in a *fresh* project there is no charter and no ADR set, so
on day one this session decomposes ideas well and answers portfolio questions thinly. Decision
14's injected set makes it richer later without being a prerequisite, and waypoint 8 owns where
the charter comes from.
