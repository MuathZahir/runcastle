---
name: tickets
description: Break the spec into the fewest vertical slices that each fill one fresh sandboxed agent session, and emit them via MCP. Then complete the tickets phase. Invoked by /runcastle:ideate.
disable-model-invocation: false
---
<!-- Forked from Matt Pocock's to-tickets skill, via https://github.com/mattpocock/skills, 2026-07-14, adapted for runcastle -->

# Tickets

Break the work into **tickets** — vertical slices, each cutting end-to-end through every layer it needs, and each big enough to be worth a whole agent session — and emit them to the runcastle store via `mcp__runcastle__emit_tickets`. You are still in the unbroken ideation window: synthesize from the spec (`docs/features/<slug>/spec.md`). Do not compact or clear.

## The one thing that makes a runcastle ticket different

Each ticket is executed by a **single fresh agent, alone, in a sandbox, with ~100k tokens and NO way to ask a follow-up question.** It sees only what you put in the ticket plus the code already in the repo. So — *inverting* the usual "avoid file paths, they go stale" rule — the ticket's `context` field **must be concrete and self-sufficient**: name the files to touch, the existing patterns to copy, the type/schema shapes, the gotchas, the commands to run and verify with. A ticket that assumes the agent can ask "where does X live?" is a broken ticket. Over-specify context; under-specify nothing.

## The second thing: a ticket costs ~10 minutes before it does any work

That fresh agent is fresh *every time*. Each ticket gets its own container: cold build, a full dependency install (measured 70–507s, ~2.5 min average), then an agent that re-reads the spec, the docs digest, and every file your `context` names — reading the repo was 16% of all agent time across 42 measured attempts. **This overhead is paid per ticket and is the same whether the ticket is twenty lines or a day's work.** Splitting one coherent piece of work into three tickets triples it, and adds two seams where a new agent has to reconstruct what the previous one had just finished learning.

So size for the **largest slice that still lands green**, not the smallest. Fine-grained slicing still matters — it just belongs *inside* a ticket, as the `acceptanceCriteria` list. The burner works red→green one criterion at a time and commits each green slice, so one ticket with eight criteria produces eight small commits and orients once; eight one-criterion tickets produce the same commits and orient eight times.

Expect a **handful of substantial tickets** for a feature — roughly 3–6, each filling a session. A dozen thin ones means you sliced by layer or by file, not by behaviour.

## 1. Draft vertical slices

<vertical-slice-rules>
- Each slice cuts a narrow but COMPLETE path through every layer it needs (schema, API, UI, tests) — vertical, NOT a horizontal slice of one layer.
- A completed slice is demoable or verifiable on its own.
- Each slice **fills** one fresh ~100k-token agent session working alone, without overflowing it.
- **Merge by default.** Two drafts are one ticket if they touch the same files, share a type or module, or the second one's first act would be re-reading what the first just wrote. Same for the obvious siblings of one behaviour: create/edit/delete of a resource, an endpoint and the UI that calls it, code and the tests that cover it.
- **Split only for a real reason:** (a) a genuine gate — the later work cannot be written until the earlier work's interface exists; (b) the combined work genuinely will not fit one session; (c) a prefactor, which is its own slice done first ("make the change easy, then make the easy change"); (d) the wide-refactor sequence below.
- **Not reasons to split:** one ticket per file, layer, endpoint or component; keeping each ticket easy; keeping diffs small; separating tests from the code they test.
- Tickets with no blocking edge between them can burn in parallel — but a whole container of overhead is a steep price for width. Let parallelism justify a split only when both halves are already large.
</vertical-slice-rules>

Give each ticket its **blocking edges** — the tickets that must finish before it can start. No blockers → it can start immediately.

<wide-refactor-exception>
A **wide refactor** — one mechanical change (rename a column, retype a shared symbol) whose blast radius breaks thousands of call sites at once — cannot land green as a vertical slice. Sequence it **expand → migrate → contract** instead. Expand: add the new form beside the old so nothing breaks (one ticket). Migrate: move call sites over in batches sized by blast radius (per package/dir), each batch a ticket blocked by the expand, CI green throughout because the old form still exists. Contract: delete the old form once no caller remains, blocked by every migrate batch. If even the batches cannot stay green alone, let them share an integration branch that all block a final integrate-and-verify ticket — green is promised only there.
</wide-refactor-exception>

## 2. Build each ticket to the schema

Emit an array of `TicketInput`. Number them from 1 in the array in **dependency order (blockers first)**; `blockedBy` holds those numbers (they are the seq numbers the store assigns).

Each ticket:
- **title** — short, descriptive, in the domain vocabulary.
- **goal** — the end-to-end behaviour this ticket makes work, from the user's/caller's perspective. Not a layer list.
- **context** — everything the sandboxed agent needs and cannot ask for: file paths to touch, existing patterns/modules to follow, type/schema shapes, gotchas, how to run and verify. Be concrete (see above).
- **acceptanceCriteria** — `string[]`, each independently *verifiable* (a behaviour you can observe, a command that passes). These are what the burner works red-green against, one at a time, committing each green one — so this is where the fine granularity lives. A substantial ticket having six or ten criteria is right, not a smell.
- **seams** — `string[]`, the public interfaces to test at (carry them from the spec's Seams section; prefer existing, prefer the highest, prefer one).
- **blockedBy** — `number[]`, the seq numbers (from your 1..N ordering) of the tickets that *genuinely* gate this one. Only true gates.

## 3. Self-check, then emit

There is no in-session quiz — the human's review is the **Burn** gate in the runcastle UI, reading these cards. So make them right before you emit. Check yourself, in this order:

1. **Can any two of these be one ticket?** Go pair by pair. Same files, shared type, sibling behaviours, or one whose blocker is the only thing it waits on and together they'd still fit a session → merge them. This is the check that matters most; do it before the others, because merging changes the rest.
2. Is each survivor a demoable vertical slice rather than a horizontal layer, and does it fill a session rather than rattle around in one?
3. Are the blocking edges minimal and genuinely true gates?
4. Is every `context` self-sufficient for an agent that cannot ask — now covering the whole of a bigger ticket, every file and pattern it touches?

Then:
- `mcp__runcastle__emit_tickets({ tickets: [...] })` — **emit the array; do NOT write ticket files.** It returns `{ stored, ids }`.
- `mcp__runcastle__record_event({ type: "tickets.emitted", message: "<n> tickets" })`.
- `mcp__runcastle__complete_phase({ phase: "tickets" })`. If the gate returns `ok: false`, fix what it names and retry.

Return to `/runcastle:ideate` to close out the session.
