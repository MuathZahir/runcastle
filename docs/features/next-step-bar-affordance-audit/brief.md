## Why this feature exists

The human is cleaning up workspace affordances that have drifted out of step with how the pipeline actually runs. Two confirmed offenders, found in `apps/web/src/lib/feature-ui.ts` `nextStep()`:

- **"Jump to grill"** is the primary action during ideation with a live session (`feature-ui.ts:636`, also `:675`, `:713`). All it does is scroll to `#grill-term` (`Workspace.tsx:222-227`) — a terminal already visible on the same screen in the pipeline-first layout. It reads as a call to action while being a no-op.
- **Manual advance buttons** — "Promote to Spec" (`:626`), "Approve spec → tickets" (`:665`) — duplicate what the ideation session already does itself via the `complete_phase` MCP tool. During normal flow the agent advances; the human never needs the button, and its presence suggests they're supposed to click it.

The human said "I believe there might be more of these" — so the scope is an **audit of every branch of `nextStep()`**, phase by phase, judging each primary/secondary action against one question: *does this duplicate something the session agent already does, or offer navigation to something already on screen?*

## Design questions for the grill

1. **Remove vs. demote.** The advance buttons may be the only rescue for a feature whose session died before completing a phase (or whose G1/G2 was satisfied but the terminal was closed). Deleting them outright could strand such features. Options: remove entirely (rely on resuming the grill session, which can then call complete_phase), keep as a quiet secondary only when *no session is live or resumable*, or keep only behind an explicit recovery state. Decide per button.
2. **"Jump to grill" specifically** — remove, or repurpose (e.g. only show when the terminal is genuinely off-screen / the user has navigated to a different phase view)?
3. **What the bar should say when the agent is mid-flight** — if the buttons go, the next-step bar during a live grill becomes purely informational; decide its wording/state.
4. **Discoverability of "Advanced — per-step models"** rides along here (same settings/workspace-polish territory): the global per-step model section exists (`SettingsOverlay.tsx:326-428`) but is collapsed behind a toggle the human never found. Decide whether to surface it (uncollapse, retitle, hint in the project section pointing up, etc.).

## What this feature must NOT swallow

- **The QA-terminal-on-shipped fix** — already its own quick change (`show-the-qa-terminal-on-the-shipped-phase`). This audit may note shipped-phase affordances but must not re-implement that fix.
- **Model resolution semantics** — the precedence flip (project model beats global step models) is its own quick change. This feature touches only the *discoverability* of the settings UI, not `resolveModel`.
- **Redesigning the next-step bar or pipeline stepper themselves** — the visual system is settled (app-redesign); this is about which actions appear, not what the bar looks like.

## Already settled

- The pipeline-first workspace layout (memory: apps/web is pipeline-first; tab model is gone) — audit within it, don't revisit it.
- Sessions auto-advance phases via MCP `complete_phase`; gates guide, never imprison (CONTEXT design principles). Any surviving manual advance is a seatbelt/recovery affordance, not the normal path.
- The three review verbs (Fix/Rethink/Merge, ADR-0010) are recent, deliberate design — the review phase's actions are unlikely candidates for removal; the audit should still look, but the bar there was just built on purpose.
