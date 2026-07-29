# Feature grouping, forking, and referencing — first slice: project-level entry points

> Converged from `map.md` + `decisions.md` (28 locked decisions). Per the map's
> converge criterion and decision 20, this spec deliberately covers the **first
> slice** cut out of the map — the project-level session and the quick-change
> door — not the whole destination. The rest of the map (knowledge tiers,
> promotion, the navigator, fork rendering) is recorded under *Out of scope* as
> follow-up features, to be created through the very session this slice ships.

## Problem

runcastle has exactly one door: the New Feature form, which demands a title and
a one-liner *up front*. That means the human must have already decomposed their
thought into a feature before runcastle can help — and this map is itself the
receipt (decision 5): a scope that was genuinely five features had to be
flattened into one waypoint map because there was no way to say "here is a lump
of raw intent, cut it for me."

The same single door blocks the other direction of smallness: work too small to
deserve a conversation ("make this darker", "expected X got Y, repro like
this") has no way in except the full pipeline — two terminals and two documents
to reach one ticket — or, since laps, a test-drive note on a feature you happen
to already be reviewing. An observation about an unrelated area, or with
nothing in flight, has no door at all.

Underneath both symptoms is the gap decision 2 named: runcastle has
feature-level memory and feature-level entry points, but nothing at project
level. This slice ships the entry points; the memory tiers follow through them.

## Approach

Two doors, one existing landing mechanism, zero new entities.

### The project session (decisions 17–20)

A new session kind, `project`, joining the existing kinds on main (which
already include `prepare` — this is not that: `prepare` measures the repo,
`project` talks to the human). Its defining job is **intake and decomposition
terminating in feature creation**: take raw intent, grill it until it resolves
into N features, create them. Three support jobs ride along: portfolio Q&A,
routing (bug / tweak / revisit / new feature / nothing — decision 22's closed
destination list), and cross-feature curation declawed to **advisory only**.
It is also, per decisions 18 and 28, the one pen allowed to rewrite the
charter (`CONTEXT.md`): born lazily when there is first something to write,
offered as a conversational bootstrap on an existing codebase, its format
living in the session's skill and never in a scaffolded stub.

**Where it runs (decision 18):** never in the human's checkout. It gets its own
worktree under the project's runcastle worktree area (`__project`), on a
runcastle-owned branch (`runcastle/project`) cut from the base tip at launch,
and its commits land on the base branch via the existing `mergeTempBranch` —
the same citizenship every AFK writer already has. Launch uses
`--permission-mode default` (not `acceptEdits`): the docs-only justification
for feature terminals does not transfer to a session with whole-repo write
access. Its closing move is *land what you wrote and leave the tree clean*.
One live project session per project, orthogonal to feature terminals —
`assertSpawnable`'s one-live-session rule is a git constraint that does not
apply here.

**Schema (decision 19, carried at main's shipped shape):** main already relaxed
`sessions.feature_id` to nullable and added a nullable `project_id`; existing
rows were deliberately not backfilled. This slice keeps that shape (no
NOT-NULL tightening, no backfill) and enforces the invariant in the service
layer: every new session row gets a `project_id`; a project-kind session has
`feature_id` null. Session resume needs a project-keyed sibling of the
feature-keyed "most recent resumable session" lookup so a project terminal
resumes its own last conversation.

**MCP surface (decisions 19, 15):** exactly four tools, none of the pipeline's
nine (no `emit_tickets`, `complete_phase`, waypoint tools, ticket surgery —
every one of those advances a feature through a gate this session does not
have):

- `create_feature({ title, oneLiner, baseBranch?, brief?, ticket? })` — the
  point of the session. `brief` is written straight into the new feature's
  `brief.md` (the reasoning from the intake conversation must not evaporate);
  absent, scaffolding behaves as today. It does **not** launch what it
  creates — the sidebar poll is the feedback. The optional `ticket` engages
  the quick-change path below (feature + ticket created atomically — this is
  not the withheld feature-less `emit_tickets`).
- `get_project_context()` — project row, charter full text (nothing if no
  file — graceful degradation), live ADRs full text, and a one-line feature
  index generated from the features table: slug, one-liner, phase, status,
  docs path; in-flight features by title only (decisions 14 parts 1–2, 16).
- `get_work_record({ featureSlug? | seam? })` — decision 15's facts-only
  record: per feature, ship date, run summaries, and a flat
  `{ seq, title, status, seams[], commits[], error? }` list. Deliberately no
  `goal`/`context`/`acceptanceCriteria` — those are decayed intent. Queryable
  by feature slug and by seam substring (seams are uncoordinated prose —
  decision 27 — so this is a pull-shaped lookup, not a collision detector).
- `record_event({ type, message })` — project-scoped, `feature_id` null,
  which the events table already supports.

Reading any merged feature's docs needs no tool: they are on disk in the
session's worktree (decision 1), and the index says where.

**Skill:** a new skill pack entry for the project session covering: the
grill-to-decompose flow ending in `create_feature` calls; the routing
vocabulary (decision 22's five destinations); advisory-only curation; the
charter's format (charter prose + `## Language` glossary in Matt's format +
`## Deferred / open threads`) and its lazy-bootstrap offer; the health-sweep
prompt shape (decision 23 — supply-driven intake, findings routed to the same
closed destination list, parked ideas going only to the charter's deferred
threads, never to a backlog); and the closing land-and-leave-clean move.

**UI (decision 20):** a pinned row at the top of the features rail — always
present, showing the project, not a feature. Selecting it swaps the workspace
to a project workspace (terminal, with the feature index and charter as its
resting state) and hides the Inspector (every panel there is feature-scoped).
The New Feature path gains a sibling affordance — *not sure it's one feature?
talk it through* — on the same screens where the gap is hit (empty workspace,
New Feature form). The project workspace's chrome states its branch and its
consequence: writes land on the base branch; commits arrive in your checkout.
Not on the portfolio home — that surface is cross-project; this session is
bound to one repo.

### The quick-change door (decision 21)

`tickets.feature_id` stays NOT NULL. A quick change is **an ordinary feature
born directly at `implementation` on lap 1**, carrying exactly one ticket whose
`goal` is the human's prose and whose sole acceptance criterion is that same
sentence. No grill, no `spec.md`, no `decisions.md`, no invented seams, no LLM
in the server. The human reviews the one editable card, clicks Burn,
test-drives, clicks Merge — two clicks, zero terminals.

- **Not a mode:** no `pipeline` column, no `quick` flag, nothing on the
  feature row (ADR-0010 #7 binds). The state is indistinguishable from a
  feature whose G1/G2 were overridden, which the machine can already reach.
- **Gates:** G1/G2 are never evaluated — gates guard forward transitions and
  the feature starts past both. Nothing becomes lap-aware.
- **Server change:** feature creation currently hard-codes `phase:
  'ideation'`, so the door is a sibling creation path (shape:
  `feature.quickChange({ projectId, title, prose, baseBranch? })`) that
  creates the row at `implementation`, scaffolds `brief.md` from the prose,
  and stores the single ticket in the same call.
- **Two entrances, one mechanism:** the human opens it directly from the UI
  (this entrance does not depend on the intake session), and the intake
  session opens it via `create_feature` carrying a ticket.
- **Escalation is free:** if the tweak is a real feature, Rethink (shipped
  with laps) lands it in `ideation` on lap 2 — the full pipeline entered
  from the fast path.
- **Everything downstream no-ops correctly:** promotion (when it later
  exists) scans a `decisions.md` that does not exist and finds nothing; the
  decay stamp has no `spec.md` to stamp; the burner needs no new
  instruction — a one-line goal with a one-line criterion is a legal ticket.

**UI:** a quick-change entrance beside New Feature (rail + empty workspace): a
single prose field, creating the feature + card and landing the human on the
ticket card ready to review and Burn.

### Branch reality

This feature branch was cut before laps merged to main; main additionally
carries the half-done decision-19 migration. Implementation therefore starts
by merging main into this branch (docs-only divergence here, so it should be
conflict-free) and builds on the shipped shape throughout.

## Seams

Existing (preferred — most of the slice is reachable through these):

- **tRPC router surface** — feature creation, session listing/spawn, project
  queries. Observes: `quickChange` creating a row at `implementation` with
  one ticket; project-session spawn/resume; the feature index data the UI
  renders. The primary seam for server behavior.
- **Service layer** (features / sessions / tickets services) — observes the
  quick-change atomicity (feature + brief + ticket in one call), the
  session-row invariant (`project_id` set, `feature_id` null for kind
  `project`), and the project-keyed resume lookup.
- **`mergeTempBranch`** — reused unchanged; observes project-session commits
  landing on the base branch across its three cases. Not modified — a test
  target only insofar as the project branch name feeds it.
- **Launcher artifacts** (settings / mcp config / system prompt rendering) —
  observes the project session's permission mode, worktree path, branch, and
  the injected charter/index rendered from live state.
- **Events stream** — every mutation emits; observes project-scoped events
  with null `feature_id`.
- **Features rail / workspace shell** (web) — observes the pinned project
  row, workspace swap, Inspector hiding, and the two new affordances.

New:

- **`feature.quickChange`** (tRPC procedure + service function) — the one new
  server entry point; observes the born-at-implementation contract.
- **Project-session MCP toolset** — the four tools above, zod-validated;
  observes intake's entire contract including `create_feature` with `brief`
  and with `ticket`.

## Out of scope

Deferred to follow-up features (to be cut via the shipped intake session —
decision 5's counterfactual, dogfooded), with their locked decisions ready:

- **Promotion at merge** — `**Scope:** project` nomination, promote-then-merge
  ADR writes, glossary append, `DOCS_PATHSPEC` widening (decisions 3, 7,
  11–13, 28 parts 3–4).
- **The navigator** — charter + live-ADR injection into *feature* sessions and
  burners, the feature index in feature-session prompts, status words
  (decisions 14, 16). This slice injects project context only into the
  project session itself.
- **`spec.md` decay stamp at ship** (decision 8).
- **Fork door + honest "shipped"** — the "Fork from here" affordance, derived
  lineage, "Merged into `<parent>`" rendering (decisions 25, 26).
- **Explicitly rejected, not deferred:** stored feature relations /
  `feature_links` (24), grouping in the rail (26), seam-overlap collision
  detection (27), a `why(...)` oracle (14), a `diagnose` session kind (22), a
  backlog in any form (23), a findings/research tier (9), a subsystem tier
  (10). `git merge-tree --write-tree` is the recorded shape for any future
  pre-merge collision warning — named, not built (27).

## Open questions

- **Charter/ADR reads for `get_project_context`** read from the project
  session's own worktree (cut from base tip at launch) — fresh enough for a
  conversation; a session spanning a merge sees launch-time state. Accepted;
  revisit only if it bites.
- **Quick-change prose → title**: the door needs a card title; slug/title
  derivation from the first words of the prose vs. a separate small field is
  a UI call to make at implementation (the decision fixes only: goal =
  prose, criterion = same sentence).
- **Health sweep cadence** is whenever the human asks for one in the project
  session — no scheduler in this slice (decision 23 makes it a prompt shape,
  nothing more).
