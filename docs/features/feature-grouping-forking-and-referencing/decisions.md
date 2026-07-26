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
