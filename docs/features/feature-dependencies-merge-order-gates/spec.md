# Feature dependencies (merge-order gates)

## Problem

When the project session cuts a big lump of intent into several features — usually parked drafts — the order between them lives only in brief prose. Nothing stops the operator (or an agent) from clicking **Start** on a draft whose groundwork hasn't merged yet, and nothing tells them, looking at the rail, which drafts are actually startable. With maps and waypoints going away, waypoint `blockedBy` no longer carries that ordering either. The operator needs to say "this draft waits until that feature merges" once, at cut time, and have runcastle hold it to that.

## Approach

### From the user's perspective

- A **draft** can **wait on** other features in the same project (drafts, active, or archived — any not yet merged). While any of them is unmerged, the draft can't be started: the next-step bar's **Start** is disabled with the reason inline — "Waits on `auth-rework` (building), `billing` (archived — remove it to start)".
- In the draft's workspace a **"Waits on"** row sits under the Parked header: one chip per dependency showing its title and state, ✕ to remove, **+ Add** to pick from the project's unmerged features. A dependency that has merged shows "✓ merged" and no ✕.
- Once the draft is started, the row turns into read-only history ("Waited on: …"). Dependencies never gate anything on a started feature — not Burn, not ideation, not session launches.
- In the rail, a waiting draft stays in the Drafts lane; its chip reads `Waits on <slug>` (or `Waits on N`, tooltip listing them) instead of `Draft`, and ready drafts sort above waiting ones. Lanes and triage are otherwise unchanged.
- A feature that others wait on shows a read-only **"Blocks: `<slug>`, …"** line in its workspace header (unmerged dependents only), so the operator sees the edge before archiving or deleting it.
- The project session states ordering at cut time (`create_feature` with `dependsOn`) and can re-order drafts later; an ideate/chat session can park scope creep that waits on the current feature.

### Domain rules (decisions 1–3)

- **Dependent** = a draft; **dependency** = any other feature in the same project. Edges can only be written while the dependent is a draft.
- **Satisfied** iff the dependency's `phase === 'shipped'` — one derived predicate, computed at read time, nothing stored. `phase` not `status`, so a shipped-then-archived dependency still counts. When forks land and "shipped" narrows to "merged into main" (feature-grouping decision 25), this predicate inherits that unchanged.
- **Waiting** = a draft with at least one unsatisfied dependency.
- **Archived, unmerged** dependencies keep blocking; the only escape is removing the edge (unarchiving restores everything untouched). **No override** exists.
- **Deleting** a feature cascades its edges away in both directions, and records an event on each affected dependent's timeline ("dependency `<slug>` deleted").

### Storage (decision 7)

A dedicated join table, kind-less by design:

```
feature_dependencies(
  dependentId   → features.id  ON DELETE CASCADE,
  dependencyId  → features.id  ON DELETE CASCADE,
  createdAt,
  PRIMARY KEY (dependentId, dependencyId)
)
```

There is no `kind` column and there must never be one — a second edge type needs a new ADR. Declared in the core drizzle schema with a server migration.

### Core (IO-free)

- The **satisfied** predicate over a feature row.
- A small cycle helper over feature-id edges: given the project's existing edges and a proposed replacement set for one dependent, report the cycle (if any). The ticket `blockedBy` `findCycle` stays private and untouched.
- Wire types for a dependency as surfaced to the UI/agents: `{ featureId, slug, title, phase, status, satisfied }`.

### Server

- **Dependencies service** — the single writer and reader:
  - `setDependencies(dependentId, dependencyIds)` replaces the whole set. Refuses (as `InvalidInputError`) when: dependent is not a draft; a dependency is in another project; self-reference; a dependency is already satisfied; the set would form a cycle; an id/slug doesn't resolve. Emits `feature.dependencies.changed` on the dependent.
  - Reads: a feature's `dependsOn` (with derived state) and `blocks` (unmerged dependents).
- **`startDraft`** refuses while the draft is waiting, with an error naming each unsatisfied dependency and its state (archived ones flagged "remove it to start"). This refusal is authoritative; the UI's disabled button is a courtesy.
- **`deleteFeature`** emits a "dependency `<slug>` deleted" event onto each dependent whose edge the cascade removes.
- **tRPC:** `feature.setDependencies({ featureId, dependsOn: featureId[] })`; `feature.get` (and whatever the rail's list query returns) carries `dependsOn` and `blocks` so the web can render chips, the row, and the Blocks line without extra round-trips.
- **MCP:**
  - `create_feature` gains `dependsOn?: string[]` (slugs) on both its full and draft-only shapes; accepted only with `draft: true`, refused otherwise. The draft is created and its set written through the same service (a bad slug or cycle refuses the whole create — no half-created draft).
  - New tool `set_feature_dependencies({ slug, dependsOn: string[] })`, replace-the-set, exposed **only to the project session kind**.
  - `get_project_context` feature rows gain `dependsOn: [{ slug, satisfied }]`, and drafts a `waiting` flag.
  - `get_feature_context` header gains `dependsOn` (with satisfied) and `blocks` (unmerged dependents' slugs).
- Every mutation emits an event (SPEC §12), so the SSE stream invalidates the rail and both workspaces when an edge changes or a dependency ships.

### Web

- Draft workspace: the "Waits on" row (chips, ✕, + Add picker of same-project unmerged features excluding self) driving `feature.setDependencies`; read-only "Waited on" history on started features.
- Next-step resolver for drafts: Start disabled with the inline waiting reason when waiting.
- Rail: `Waits on …` chip and the ready-above-waiting sort inside the Drafts lane; `triageOf` unchanged.
- Workspace header: read-only "Blocks: …" line when the feature has unmerged dependents.
- Styling follows `apps/web/STYLE.md` (theme tokens, primitives, component-test tiers).

### Skills

- Project skill, cut step: state ordering through `create_feature`'s `dependsOn` (create the dependency first, then the dependent), not brief prose; use `set_feature_dependencies` to re-order parked drafts.
- Ideate skill, parking step: when parked scope builds on the current feature, pass `dependsOn: [<this slug>]`.

### ADR

`docs/adr/0013-feature-merge-order-dependencies.md`, in the existing ADR format, **amending decision 24** of `feature-grouping-forking-and-referencing` ("runcastle gains no stored relation between features"). Argument: decision 24 rejected *topical* edges (opinions that decay from the moment they are written) and a generic `feature_links` table mixing write modes. A merge-order dependency is one edge type with one job and a clear end — satisfied the moment the dependency ships, inert afterwards, like ticket `blockedBy`. The table's name and its missing `kind` column are deliberate; a second edge type requires a new ADR.

## Seams

- **Dependencies service** *(new)* — `setDependencies` + the reads. Observe: every refusal rule, the replace-the-set semantics, the `feature.dependencies.changed` event, `dependsOn`/`blocks` derived state (incl. shipped-then-archived = satisfied, archived-unmerged = unsatisfied). This is the primary seam; nearly all rules are tested here.
- **`startDraft`** *(existing)* — refuses a waiting draft with a message naming the blockers; starts once every dependency's phase is shipped. Observe via the existing draft-features test style.
- **`deleteFeature`** *(existing)* — cascade removes edges both ways; dependents receive the deleted-dependency event.
- **Core cycle helper + satisfied predicate** *(new, pure)* — unit-tested in isolation.
- **tRPC `feature.setDependencies` / `feature.get`** *(new / existing)* — wire shape carries `dependsOn` and `blocks`.
- **MCP tools** *(existing + one new)* — `create_feature` with `dependsOn` (draft-only, atomic refusal), `set_feature_dependencies` visible only to project sessions, the new fields on `get_project_context` and `get_feature_context`. Observe via the existing MCP tool test harnesses.
- **Web pure resolvers** *(existing)* — the draft next-step resolver (disabled Start + reason) and the rail's `sidebar` chip/sort logic, tested as pure functions; the "Waits on" row and "Blocks" line at the component-test tier STYLE.md prescribes.

## Out of scope

- Gating anything on a started feature (Burn, ideation, session launches).
- Gate overrides of any kind.
- Topical links (builds-on / related), grouping or clustering in the rail, a general `feature_links` graph with edge kinds.
- New rail lanes or triage changes; pushing newly-ready drafts into "Needs you".
- Cross-project dependencies.
- Building forks or changing what "shipped" means (decision 25 of `feature-grouping-forking-and-referencing` is its own work; this feature only inherits it via the predicate).
- The retirement of maps, waypoints and converge (its own feature; no dependency either way).
- Editing other feature fields (title, brief) — this introduces the first feature-edit path, but only for dependencies.

## Open questions

None open. Deliberately settled: archived dependencies block without override (escape = remove the edge); deleted dependencies cascade with a timeline event; satisfied tracks `phase === 'shipped'` and will follow decision 25 automatically.
