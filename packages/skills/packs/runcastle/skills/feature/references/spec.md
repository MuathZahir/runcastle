# Writing the spec

Load this once what the feature does is settled — whether you will build it
yourself or hand it to workers — or when a later decision changes what
`spec.md` says.

The spec is synthesis, not an interview: write it from the conversation and
`docs/features/<slug>/decisions.md`. Do not re-ask the human anything that is
settled.

## Process

1. **Load state.** `mcp__runcastle__get_feature_context` for the decisions and
   any existing `spec.md` (this may be a rewrite). Read any canonical doc listed
   in `notInlined` before writing a word. Explore the codebase for its current
   state if you have not already; use the project's domain vocabulary and
   respect any ADRs in the area you touch.

2. **Sketch the seams** — the public boundaries the feature will be tested at.
   Prefer *existing* seams to new ones; use the *highest* seam possible; the
   fewer across the codebase, the better — the ideal is one. If new seams are
   needed, propose them at the highest point you can. They flow straight into
   the tickets and the tests, so get them right here.

3. **Write `docs/features/<slug>/spec.md`** with exactly these sections:

   ```markdown
   # <Feature title>

   ## Problem
   The problem the user faces, from the user's perspective.

   ## Approach
   The solution from the user's perspective, then the shape of it: modules built/modified, their interfaces, schema/API/contract decisions, key interactions. Prose, not a file-by-file plan.

   ## Seams
   The interfaces to test at (from step 2) — each named, with what it lets you observe. Flag which are existing vs. new.

   ## Out of scope
   What this feature explicitly does not cover, including scope parked as backlog features.

   ## Open questions
   Anything still unresolved or deliberately deferred.
   ```

   Do **not** hardcode file paths or code snippets — they go stale. Exception:
   when the conversation produced a snippet that pins a decision more precisely
   than prose can (a state machine, a reducer, a schema, a type shape), inline
   the decision-rich parts and say where it came from.

4. **Commit it** with the decisions it was written from, as a docs commit.

When a later decision changes what the feature does, amend the affected
sections in place rather than appending.
