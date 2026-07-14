---
name: spec
description: Synthesize the ideation conversation and decisions.md into docs/features/<slug>/spec.md, then complete the spec phase. No interview — pure synthesis. Invoked by /runcastle:ideate for size=full features.
disable-model-invocation: false
---
<!-- Forked from Matt Pocock's to-spec skill, 2026-07-14, adapted for runcastle -->

# Spec

Turn the ideation conversation plus `docs/features/<slug>/decisions.md` into a spec at `docs/features/<slug>/spec.md`. **Do NOT interview the human** — you are inside the unbroken ideation window; synthesize what you already know. Do not compact or clear.

## Process

1. **Load state.** `mcp__runcastle__get_feature_context` for the feature, the locked `decisions.md`, and any existing `spec.md` (this may be a re-run). Explore the codebase for its current state if you have not already; use the project's domain vocabulary throughout and respect any ADRs in the area you touch.

2. **Sketch the seams** — the public boundaries the feature will be tested at. Prefer *existing* seams to new ones; use the *highest* seam possible; the fewer across the codebase, the better — the ideal is one. If new seams are needed, propose them at the highest point you can. These seams flow straight into the tickets and the burner, so get them right here.

3. **Write `spec.md`** with exactly these sections:

   ```markdown
   # <Feature title>

   ## Problem
   The problem the user faces, from the user's perspective.

   ## Approach
   The solution from the user's perspective, then the shape of it: modules built/modified, their interfaces, schema/API/contract decisions, key interactions. Prose, not a file-by-file plan.

   ## Seams
   The interfaces to test at (from step 2) — each named, with what it lets you observe. Flag which are existing vs. new.

   ## Out of scope
   What this feature explicitly does not cover.

   ## Open questions
   Anything still unresolved or deliberately deferred.
   ```

   Do **not** hardcode specific file paths or code snippets — they go stale. Exception: if the ideation produced a snippet that pins a decision more precisely than prose can (a state machine, reducer, schema, type shape), inline the decision-rich parts and note it came from that discussion.

4. **Complete the phase.** `mcp__runcastle__record_event({ type: "spec.written", message: "<feature title>" })`, then `mcp__runcastle__complete_phase({ phase: "spec" })`. If the gate returns `ok: false`, it names what is missing — fix and retry.

Return control to `/runcastle:ideate`, which invokes `/runcastle:tickets` next.
