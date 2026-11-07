<!-- Forked from Matt Pocock's to-tickets skill, via https://github.com/mattpocock/skills, 2026-07-14, adapted for runcastle -->

# Writing the review ticket

Load this when the work is done and you are about to write the review ticket,
or reshape or cancel it.

Build work is never a ticket: it goes to workers (`./workers.md`) or you do it
yourself. Tickets and rounds remain only for this one review, until the
`burns-become-workers` feature retires them. Use them for nothing else.

Emit the ticket with `mcp__runcastle__emit_tickets`. The feature's tickets come
as summary rows in `get_feature_context`; `mcp__runcastle__get_ticket({ seq })`
holds one ticket's context, acceptance criteria and digest.

## The one thing that makes a runcastle ticket different

The ticket is executed by a **single fresh agent, alone, in a sandbox, with
NO way to ask a follow-up question.** It sees only what you put in the ticket
plus the code already in the repo. So the ticket's `context` field **must be
concrete and self-sufficient**: where to look, the surface to exercise, the
scenario to replay, the gotchas. Over-specify context; under-specify nothing.

<review-ticket>
**The review ticket.** Every feature ends with one, unless the human does not
want it (SKILL.md, "Every feature ends with a review round"). Add **one**
ticket with `kind: "review"` and `blockedBy: []`. It is not a slice: it is the
brief for the agent that exercises the *integrated* work on the feature branch
and reports what it finds as findings. Its `goal` says what to verify and its
`acceptanceCriteria` are the things to check off, one per behaviour worth
confirming — the review agent walks them in order. `emit_tickets` refuses a
ticket *titled* like a review but carrying another kind: set the kind (or
retitle it) and re-emit.

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

<ship-a-scenario>
**Ship a scenario when the state is hard to reach.** A scenario is a project
command under `.runcastle/scenarios/` that seeds a state and prints the URL to
land on, so a test drive starts where the feature is instead of on a blank app.
Read `get_feature_context`'s `scenarios` field — `{ setUp, runnerConfigured,
scenarios, fixtures }` — before you decide anything.

**When `setUp` is true**, ask of each piece of work: will the person driving
this have to build state by hand to see it — an account, a cart with an expired
coupon?

- If yes, the work that builds that state ships `.runcastle/scenarios/<group>/<name>.<ext>`, which seeds <state> (reusing `_fixtures`) and prints `ENTRY_URL=<where>`: a line in that worker's done-when, or yours to write. Name the fixtures it should reuse. When the change is an API call, it also ships a sibling `.http` file at the same path with the request, and the scenario prints `TOKEN=` when the call is authenticated.
- Name that scenario in the review ticket's `context`, so the reviewer replays it rather than improvising the setup; and use it as the `scenario` you declare ready with.
- Copy changes and settings toggles get none. A scenario earns its place only where reaching the state is the chore.
- A worker writes and typechecks the scenario but cannot run it — a sandbox has no drive.

**When `setUp` is false**, card nothing about scenarios. Tell the human once
that ＋ New scenario in a test drive sets scenarios up for this project.
</ship-a-scenario>

## Build the ticket to the schema

Emit an array holding one `TicketInput`:

- **title** — `{group}: {task}`, in the domain vocabulary: `Checkout: review the coupon flow`.
- **goal** — what to verify, from the user's/caller's perspective.
- **context** — everything the review agent needs and cannot ask for. Be concrete.
- **acceptanceCriteria** — `string[]`, each independently *verifiable*: a step of the walk, or a thing the gates-and-diff read can check off.
- **seams** — `string[]`, the surface it exercises.
- **blockedBy** — `[]`.
- **kind** — `"review"`.
- **model** — optional, and usually omitted. Only an id from `annotatedModels` (`get_feature_context`), where the human's note plainly fits; never invent one, or the emit fails.

Before you emit, check: exactly one `kind: "review"` ticket; criteria that
describe the walk, or what the diff read checks; a `context` self-sufficient
for an agent that cannot ask; and, if `scenarios.setUp`, the scenario named.

Then `mcp__runcastle__emit_tickets({ tickets: [...] })` — **emit the array; do
NOT write ticket files.** It returns `{ stored, tickets, warnings }`, logs the
timeline event itself, and opens the **Work** view beside the chat. Emit it
fully written, never a placeholder to fill in afterwards. Then read `warnings`:
nothing was refused, but fix what they name with `update_ticket` before you
dispatch.

## Reshaping it later

- Stale but still needed → `update_ticket({ id, ...changed fields })` (pending or failed only).
- No longer needed → `cancel_ticket({ id, reason })` (pending or failed only).
