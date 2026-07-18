---
name: tickets
description: Break the spec (or decisions.md when collapsed) into tracer-bullet vertical slices, each self-sufficient for one fresh sandboxed agent, and emit them via MCP. Then complete the tickets phase. Invoked by /runcastle:ideate.
disable-model-invocation: false
---
<!-- Forked from Matt Pocock's to-tickets skill, via https://github.com/mattpocock/skills, 2026-07-14, adapted for runcastle -->

# Tickets

Break the work into **tickets** — tracer-bullet vertical slices — and emit them to the runcastle store via `mcp__runcastle__emit_tickets`. You are still in the unbroken ideation window: synthesize from the spec (`docs/features/<slug>/spec.md`) or, for collapsed features, straight from `decisions.md`. Do not compact or clear.

## The one thing that makes a runcastle ticket different

Each ticket is executed by a **single fresh agent, alone, in a sandbox, with ~100k tokens and NO way to ask a follow-up question.** It sees only what you put in the ticket plus the code already in the repo. So — *inverting* the usual "avoid file paths, they go stale" rule — the ticket's `context` field **must be concrete and self-sufficient**: name the files to touch, the existing patterns to copy, the type/schema shapes, the gotchas, the commands to run and verify with. A ticket that assumes the agent can ask "where does X live?" is a broken ticket. Over-specify context; under-specify nothing.

## 1. Draft vertical slices

<vertical-slice-rules>
- Each slice cuts a narrow but COMPLETE path through every layer it needs (schema, API, UI, tests) — vertical, NOT a horizontal slice of one layer.
- A completed slice is demoable or verifiable on its own.
- Each slice fits comfortably in one fresh ~100k-token agent session working alone.
- Any prefactoring is its own slice, done first ("make the change easy, then make the easy change").
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
- **acceptanceCriteria** — `string[]`, each independently *verifiable* (a behaviour you can observe, a command that passes). These are what the burner works red-green against.
- **seams** — `string[]`, the public interfaces to test at (carry them from the spec's Seams section; prefer existing, prefer the highest, prefer one).
- **blockedBy** — `number[]`, the seq numbers (from your 1..N ordering) of the tickets that *genuinely* gate this one. Only true gates.

## 3. Self-check, then emit

There is no in-session quiz — the human's review is the **Burn** gate in the runcastle UI, reading these cards. So make them right before you emit. Check yourself: is the granularity right (each a demoable slice, none a horizontal layer)? Are the blocking edges minimal and correct? Is every `context` self-sufficient for an agent that cannot ask?

Then:
- `mcp__runcastle__emit_tickets({ tickets: [...] })` — **emit the array; do NOT write ticket files.** It returns `{ stored, ids }`.
- `mcp__runcastle__record_event({ type: "tickets.emitted", message: "<n> tickets" })`.
- `mcp__runcastle__complete_phase({ phase: "tickets" })`. If the gate returns `ok: false`, fix what it names and retry.

Return to `/runcastle:ideate` to close out the session.
