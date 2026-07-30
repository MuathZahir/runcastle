# Decisions — Identify Random Issues Throughout the System

## 1. Identification now, fixes as this feature's tickets
**Decision:** The audit itself runs during this ideation/spec window (agent-browser driving the real UI). Discovered issues are triaged into findings, and the tickets emitted by this feature are the **fix tickets** for the issues worth fixing.
**Why:** Keeps discovery and remedy in one feature instead of spawning a follow-up feature per bug. The pipeline still holds: the audit must complete before tickets are emitted, so tickets are boundable — each one names a concrete, already-observed issue with repro steps.

## 2. Audit environment: fresh data dir first, copied dev data second
**Decision:** Primary audit runs `bun run dev` against a fresh throwaway `RUNCASTLE_DATA_DIR` with a scratch git repo as the target project, walking flows in order (first-run wizard → project → feature → pipeline). A second pass runs against a **copy** of the existing `~/.runcastle-dev` tree for deep/returning-user states (mid-burn, review, shipped, mapped features).
**Why:** Fresh dir exercises the true new-user POV (wizard, empty states) with zero risk to real data; walking flows in order fabricates mid-pipeline state naturally. The copied dev tree reaches states a fresh dir can't without expensive real agent runs.

## 3. Seed bugs — known issues the audit must verify and the tickets must fix
**Decision:** Three user-reported issues are in scope regardless of what the audit finds:
1. **Preparation disappears after completion** — no way to find or re-run it once done. Fix direction: persistent entry point, e.g. "Re-prepare the project" at the bottom of the left sidebar.
2. **Rethink → ideation breaks the lap loop** — the ideation agent starts making code edits itself instead of grilling, so no spec/tickets ever happen and the feature can't reach review/merge. Suspected contributors: the briefing wasn't delivered because a Claude "Start from summary?" popup swallowed it; system prompt may need hardening. Also: rename "Rethink" to something like "Iterate".
3. **Rethink during an active test drive wedges the feature** — users click Rethink while still checked out on the branch; the worktree can't be created and they're stuck. General principle: the UI must guard actions that are invalid in the current state and always give the user a way out.
**Why:** Real user reports, already reproduced in the wild; the audit confirms root causes and repro steps, and the broader sweep looks for the same *class* of problem (dead-end states, unguarded invalid actions).

## 4. Audit depth: hybrid — agent-browser UI sweep + code-level root-causing, at most one live session repro
**Decision:** The agent-browser sweep covers everything reachable without launching an agent (wizard, portfolio, workspace, feature creation, phase transitions, invalid-state actions like rethink-during-test-drive). Agent-dependent bugs (swallowed briefing, "Start from summary?" popup, ideation agent editing code) are root-caused by reading the launcher/session code and injected prompts. At most one targeted live session repro if code reading leaves genuine doubt. No full-pipeline live runs.
**Why:** Live agent runs are slow, token-burning, and nondeterministic; the popup behavior is deterministic from how the CLI is invoked, so the cause is findable in code. The seed bugs are already reproduced in the wild — the audit needs root causes, not re-witnessing.

## 5. Coverage: seven-flow sweep; copy/labeling in scope, visual polish out
**Decision:** The sweep walks, in order: (1) first-run wizard → empty portfolio → first project init; (2) portfolio home (cards, switcher, new project, settings); (3) project workspace (preparation end-to-end, sidebar, command palette, quick change); (4) full feature lifecycle across every phase body, checking "is the next step obvious" and "can the user get out of every state he can get into"; (5) lap-2 rethink/iterate path including clicking Rethink at wrong moments; (6) deep states from copied dev data (mapped features, mid-burn, transcripts, inspector); (7) hostile-input sweep (invalid actions per state, delete mid-phase, server restart mid-flow). "Issue" includes copy/labeling problems (a mislabeled button is a confusion bug); pure visual polish (spacing/color/animation taste) is out unless it looks broken.
**Why:** Ordered flows fabricate their own state; the two POVs (new user, returning user) fall out of the two environments. The copy-in/polish-out boundary keeps findings actionable and stops the list drowning in taste calls.

## 6. Triage: four severities, blockers/majors ticketed, findings reviewed before tickets
**Decision:** Findings are classed `blocker` (stuck/data loss/flow can't complete), `major` (user misled or guessing), `minor` (small friction/copy awkwardness), `note` (no action). Every blocker/major gets a fix ticket, merged when they share a root cause (the two rethink bugs likely share the lap-transition machinery). Minors bundle into one "UX polish batch" ticket. Redesign-sized findings are parked in the findings doc as suggested future features, not ticketed. The human reviews the triaged findings list (each with a proposed fix direction) **before** tickets are emitted, and can veto or promote items. Findings live at `docs/features/<slug>/findings.md`.
**Why:** Severity maps directly to ticket-worthiness; the pre-ticket checkpoint is the cheapest place to correct triage; parking redesign-sized work keeps every ticket one-agent-session-sized.

## 7. One lap; audit executes inside the ideation session
**Decision:** Single-lap feature: audit → fix tickets → burn → test-drive → merge. The audit itself runs inside this ideation session (fresh data dir + dev server, browser sweeps fanned out to subagents to keep the main window lean), findings land in `findings.md`, and the triaged list is reviewed by the human before ideation completes. Redesign-sized discoveries park as future-feature suggestions rather than seeding a lap 2.
**Why:** The fix list is bounded by the audit, so the whole thing is spec-able at once; subagent fan-out protects the unbroken context that spec and tickets must inherit.

## 8. Triage approved — 8-ticket shape locked
**Decision:** The human reviewed the triaged findings (findings.md: 4 blockers F2/F3/F4/F19, 15 majors, 3 minor bundles, 4 notes) and approved without vetoes or promotions, including the proposed 8-ticket shape: (1) kickoff delivery + revisit prompt integrity (F2, F6); (2) rethink guards + transactional phase flips + Rethink→Iterate rename (F3, F5); (3) lap-aware gates and next-step (F4); (4) preparation persistence (F1); (5) review-phase honesty (F8, F21, F22, F23); (6) resilience & layout (F19, F20, F7, F24); (7) first-run & vocabulary (F13, F15, F16); (8) UX polish batch (F10, F17, F25 + actionable notes).
**Why:** The audit is the scope; each ticket groups findings sharing a root cause or surface so every slice is one-agent-session-sized with concrete, already-observed acceptance criteria.
