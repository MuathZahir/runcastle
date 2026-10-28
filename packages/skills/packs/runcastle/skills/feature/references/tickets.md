<!-- Forked from Matt Pocock's to-tickets skill, via https://github.com/mattpocock/skills, 2026-07-14, adapted for runcastle -->

# Writing tickets

Load this when work is worth handing to sandboxed workers and you are about to
write, reshape or cancel tickets.

Break the work into **tickets** — vertical slices, each cutting end-to-end
through every layer it needs, each big enough to be worth a whole agent session
and small enough to finish inside one — and emit them with
`mcp__runcastle__emit_tickets`. Synthesize from `spec.md` and the conversation.
The feature's existing tickets come as summary rows in `get_feature_context`;
`mcp__runcastle__get_ticket({ seq })` holds one ticket's context, acceptance
criteria and digest.

## The one thing that makes a runcastle ticket different

Each ticket is executed by a **single fresh agent, alone, in a sandbox, with
~100k tokens and NO way to ask a follow-up question.** It sees only what you put
in the ticket plus the code already in the repo. So — *inverting* the usual
"avoid file paths, they go stale" rule — the ticket's `context` field **must be
concrete and self-sufficient**: name the files to touch, the existing patterns
to copy, the type/schema shapes, the gotchas, the commands to run and verify
with. A ticket that assumes the agent can ask "where does X live?" is a broken
ticket. Over-specify context; under-specify nothing.

## The second thing: a ticket costs ~10 minutes before it does any work — and pays it twice if it overruns

That fresh agent is fresh *every time*. Each ticket gets its own container: cold
build, a full dependency install (measured 70–507s, ~2.5 min average), then an
agent that re-reads the spec, the docs digest, and every file your `context`
names — reading the repo was 16% of all agent time across 42 measured attempts.
**This overhead is paid per ticket and is the same whether the ticket is twenty
lines or a day's work.** Splitting one coherent piece of work into three tickets
triples it, and adds two seams where a new agent has to reconstruct what the
previous one had just finished learning.

But that meter runs both ways. A ticket too big to finish in one pass gets no
cheap second wind: an iteration is not a retry (ADR-0008) — the container is
rebuilt, the install runs again, and a brand-new agent re-reads everything from
the last commit, having lost every conclusion its predecessor reached.

So size a ticket to **earn its container and still land in one pass**:
substantial, with room left at the end for the tests, the self-review and the
commits. Fine-grained slicing belongs *inside* a ticket, as the
`acceptanceCriteria` list: the worker works through the criteria and
commits each finished slice, so one ticket with six criteria orients once; six
one-criterion tickets orient six times.

Expect a **handful of substantial tickets** for a feature — roughly 4–8, each
worth a session. A dozen thin ones means you sliced by layer or by file, not by
behaviour. Two or three giant ones means you will pay back the containers you
saved, with interest, when they overrun.

## 1. Draft vertical slices

<vertical-slice-rules>
- Each slice cuts a narrow but COMPLETE path through every layer it needs (schema, API, UI, tests) — vertical, NOT a horizontal slice of one layer.
- A completed slice is demoable or verifiable on its own.
- Each slice is worth one fresh ~100k-token agent session working alone and **lands inside it** — leave room for the orientation at the front and the tests, self-review and commits at the back.
- **Merge when a merge test holds.** Two drafts are one ticket if they touch the same files, share a type or module, or the second one's first act would be re-reading what the first just wrote. Same for the obvious siblings of one behaviour: create/edit/delete of a resource, an endpoint and the UI that calls it, code and the tests that cover it.
- **Split only for a real reason:** (a) a genuine gate — the later work cannot be written until the earlier work's interface exists; (b) the combined work would not land in one session; (c) a prefactor, which is its own slice done first ("make the change easy, then make the easy change"); (d) parallel width, under the rule below; (e) the wide-refactor sequence below.
- **Not reasons to split:** one ticket per file, layer, endpoint or component; keeping each ticket easy; keeping diffs small; separating tests from the code they test.
- **Parallelism pays when the halves are file-disjoint.** Tickets with no blocking edge burn concurrently, each on its own temp branch, landing one at a time (ADR-0002) — so two substantial slices touching *different* files buy real wall-clock. Two touching the *same* files race to land, and the loser fails on a merge conflict: that width costs a re-burn. Overlapping files → merge.
</vertical-slice-rules>

Give each ticket its **blocking edges** — the tickets that must finish before it
can start. The field is required: a ticket with no blockers gets an empty array.

<review-ticket>
**A review ticket, when you choose to run one.** Whether a batch gets a review
is your call (SKILL.md, "Review is your call"). When it does, add **one** ticket
with `kind: "review"`, blocked by every implementation ticket whose work it
checks. It is not a slice: it is the brief for the agent that exercises the
*integrated* work on the feature branch and reports what it finds as findings.
Its `goal` says what to verify and its `acceptanceCriteria` are the things to
check off, one per behaviour worth confirming — the review agent walks them in
order. `emit_tickets` refuses a ticket *titled* like a review but carrying
another kind: set the kind (or retitle it) and re-emit.

The review agent works in **exactly one of two modes**, never both — a browser
**Drive** of the app against your acceptance criteria, or **Gates**: the
project's verify commands plus a two-axis read of the diff. Reviews that
attempted both ran long or died having delivered neither.

Make the choice obvious. Prescribe a walkthrough only when there is genuinely a
surface to walk, in plain prose ("open the settings flow, add a project, check
the empty state"), and write the `acceptanceCriteria` as the steps of that walk.
When the work changed nothing a human could drive — prompt contracts, docs, an
internal refactor, a backend-only change — say so in the ticket, and write
criteria the gates-and-diff read can check off.

**Say what to walk, never which mode.** A review ticket never directs the agent
to Gates — no "Mode: Gates", no "skip the drive" — and the mode is the review
agent's call from the surface you describe. Least of all give as the reason that
the change "isn't deployed or installed yet": the drive boots **the branch** —
the project's drive setup points it at the checkout's own code, migrations and
assets precisely so a branch is visible in its own drive. A review ticket once
prescribed Gates on exactly that reasoning, and a UI feature reached the human
without ever being driven. If the state to check does not exist yet in a fresh
drive, the `acceptanceCriteria` say how to produce it inside the drive, as far as
the project's drive instructions allow, and then what to check.

The review agent never edits code, so its ticket needs no `seams` beyond the
surface it exercises, and finding bugs is a *successful* review. Its digest
carries a prose summary of what landed, which the Review view leads with, so
`goal` asks for the verification, not for the summary.
</review-ticket>

<parallelism-budget>
**Budget the parallelism explicitly, before you emit.** A round runs up to
`burnConcurrency` tickets at once (from `get_feature_context`), but a ticket
cannot start until every ticket in its `blockedBy` has landed, so a round's
wall-clock is set by its **critical path**: the longest chain of blocking edges.
A chain of N tickets is N sequential sandboxes however wide the pool is.
Measured at `burnConcurrency: 3`, three consecutive batches whose tickets each
chained end to end came in at **1.09x, 1.16x and 1.00x** — the width was there
and never spent.

So, after slicing, **say it out loud in the session**:

- the **critical path** — the longest chain of implementation tickets, named in order, and its length;
- **how many tickets can run at once**, against this project's `burnConcurrency`;
- whether that clears the bar: T implementation tickets at concurrency C want a chain no longer than roughly **T / C**.

**When it does not clear the bar, reslice.** **A blocking edge is true only when
the later ticket reads the earlier one's output**: a file it writes, a type or
interface it defines, a schema it migrates, a stub it fills. "Related", "same
area", "logical reading order" are not blocking edges — drop them. Where the
edge is real, merge the two into one ticket, or pull the shared foundation
forward into the blocker so everything else goes wide behind it.

A review ticket is the tail by definition: measure the critical path over the
implementation tickets and add it. Width only counts if it lands: parallel
tickets touching the same files collide on landing.
</parallelism-budget>

<ship-a-scenario>
**Ship a scenario when the state is hard to reach.** A scenario is a project
command under `.runcastle/scenarios/` that seeds a state and prints the URL to
land on, so a test drive starts where the feature is instead of on a blank app.
Read `get_feature_context`'s `scenarios` field — `{ setUp, runnerConfigured,
scenarios, fixtures }` — before you decide anything.

**When `setUp` is true**, ask of each ticket: will the person driving this have
to build state by hand to see it — an account, a cart with an expired coupon?

- If yes, give the implementation ticket that builds that state an acceptance criterion: "Ship `.runcastle/scenarios/<group>/<name>.<ext>` that seeds <state> (reusing `_fixtures`) and prints `ENTRY_URL=<where>`". Name the fixtures it should reuse. When the change is an API call, the criterion also ships a sibling `.http` file at the same path with the request, and the scenario prints `TOKEN=` when the call is authenticated.
- Name that scenario in the review ticket's `context`, if there is one, so the reviewer replays it rather than improvising the setup; and use it as the `scenario` you declare ready with.
- Copy changes and settings toggles get none. A scenario earns its place only where reaching the state is the chore.
- The worker writes and typechecks the scenario but cannot run it — a sandbox has no drive.

**When `setUp` is false**, card nothing about scenarios. Tell the human once
that ＋ New scenario in a test drive sets scenarios up for this project.
</ship-a-scenario>

<wide-refactor-exception>
A **wide refactor** — one mechanical change (rename a column, retype a shared symbol) whose blast radius breaks thousands of call sites at once — cannot land green as a vertical slice. Sequence it **expand → migrate → contract**. Expand: add the new form beside the old so nothing breaks (one ticket). Migrate: move call sites over in batches sized by blast radius (per package/dir), each a ticket blocked by the expand, green throughout because the old form still exists. Contract: delete the old form once no caller remains, blocked by every migrate batch. If even the batches cannot stay green alone, let them all block a final integrate-and-verify ticket — green is promised only there.
</wide-refactor-exception>

<preview-screen-block>
When the feature has a `preview.html` and a ticket **builds a screen that appears in it as a screen block**, point that ticket at **one named screen block**, never the file. Its **context** names the path (`docs/features/<slug>/preview.html`) and the block name, and tells the worker to find the two markers, `<!-- screen:<name> -->` and `<!-- /screen:<name> -->`, and **read only the lines between them**. Say plainly that the block shows the approved look and behaviour and **is not the implementation**: build it with the project's real components and never copy the mock's markup. **Never tell a worker to read the whole file.**

A ticket with no screen does not mention the preview.

A **designed-screen block** holds no mock. It names a component committed in design mode and its preview page. Point the ticket at that component file and that preview page path, not at markup.
</preview-screen-block>

<connect-designed-screens>
A ticket that wires a **designed screen** (one committed in design mode, `design: …` commits on the feature branch) names the committed component and its preview page in its `context`, and says plainly that **the look is approved**. Its job is to **connect, never restyle**:

- swap the sample data for real data (queries, API calls);
- add the behaviour the design left out;
- change markup only where the wiring needs it.

When wiring forces a visible change (a field the design lacked, say), the worker calls it out in its digest.
</connect-designed-screens>

## 2. Build each ticket to the schema

Emit an array of `TicketInput`. Number them from 1 in the array in **dependency
order (blockers first)**; `blockedBy` holds those numbers.

Each ticket:
- **title** — `{group}: {task}`, in the domain vocabulary: `Checkout: apply the coupon at payment`.
- **goal** — the end-to-end behaviour this ticket makes work, from the user's/caller's perspective. Not a layer list.
- **context** — everything the sandboxed agent needs and cannot ask for: file paths, patterns to follow, type/schema shapes, gotchas, how to run and verify. Be concrete.
- **acceptanceCriteria** — `string[]`, each independently *verifiable* (a behaviour you can observe, a command that passes). Four to eight on a substantial ticket is right; a list running well past that will not land in one pass. Criteria are observable behaviours; ask for a test as a criterion only for a bug repro or a contract worth protecting, never for its own sake. A ticket that fixes red round gates names the failing command and test files in its `context` and has one criterion that re-runs them narrowed (never the full suite — the host runs that once per round). A review reports useless tests as low-severity observations, never defects: when the round already mints a fix ticket, fold those observations into it as one criterion (delete or rewrite the named tests), and never mint a ticket only to delete useless tests.
- **seams** — `string[]`, the public interfaces to test at (from the spec's Seams; prefer existing, prefer the highest, prefer one).
- **blockedBy** — `number[]`, **required**, only true gates; `[]` when there are none.
- **kind** — `"implementation"` (the default, omit it) or `"review"`.
- **model** — optional, and usually omitted. See below.

### Assigning a model (only from the annotated roster)

`get_feature_context` returns `annotatedModels`: `{ id, runtime, note }` for the
models the human wrote a use-case note against. That list is the *entire* set
of ids you may use.

- **Empty list → never set `model`.**
- **Non-empty → set it only where a note plainly fits the ticket.** Unset is the good default.
- **Never invent an id**, and never write one not in `annotatedModels` — the store rejects it and the whole batch fails to emit.

## 3. Self-check, then emit

Check yourself, in this order:

1. **Can any two of these be one ticket?** Take them pair by pair; merging changes the rest.
2. **Would any one overrun?** Split it where its files stop overlapping.
3. Is each survivor a demoable vertical slice, worth a session?
4. Are the blocking edges minimal and true? State the critical path and the width against `burnConcurrency`, and reslice if the chain runs longer than roughly total / concurrency. Do independent tickets touch different files?
5. Is every `context` self-sufficient for an agent that cannot ask?
6. If you chose a review, is there exactly one `kind: "review"` ticket, blocked by the work it checks?
7. If `scenarios.setUp`, does every ticket that builds hard-to-reach state ship a scenario for it?

Then `mcp__runcastle__emit_tickets({ tickets: [...] })` — **emit the array; do
NOT write ticket files.** It returns `{ stored, ids }`, logs the timeline event
itself, and opens the **Work** view beside the chat. Emit the **whole batch,
fully enriched, in one call**; never emit placeholder contexts to enrich
afterwards — a round dispatched mid-enrichment burns workers on placeholders.

## Reshaping tickets later

When something changes after tickets exist, walk the ticket list against it:

- Stale but still needed → `update_ticket({ id, ...changed fields })` (pending or failed only).
- No longer needed → `cancel_ticket({ id, reason })` (pending or failed only).
- New work → `emit_tickets` again; tickets accumulate on the feature.
- Landed work now wrong → a NEW ticket that corrects it. Never touch landed or running tickets.
