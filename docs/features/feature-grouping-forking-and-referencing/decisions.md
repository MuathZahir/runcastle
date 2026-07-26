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
