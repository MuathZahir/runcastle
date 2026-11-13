# ADR-0022: Epics on autopilot replace per-feature ownership

- **Status:** accepted (2026-11-13); in force once `epics-on-autopilot` merges
- **Deciders:** Muath + the orchestrator (the brief), the feature lead of `epics-on-autopilot` (assumed decisions 13–25, put to Muath at handover)
- **Supersedes:** ADR-0016 (orchestrator threads hold features) and ADR-0021 (one place to answer)
- **Record:** `docs/features/epics-on-autopilot/decisions.md`

## Context

ADR-0016 let an orchestrator chat hold a single feature, and ADR-0021 tried to make it
clear where the human answers. That one ability, handing one feature to one chat, grew
the machinery: an owner per feature, a tool that takes a feature, a "who finishes it"
choice, owners that flipped by themselves when a question came up, refusals when the
wrong chat acted, and startup repairs that moved owners around. The human still had to
remember who ran each feature, the status was often wrong, and they were bounced between
chats.

What the human wants is two modes: "I work on these features myself" and "run this epic
while I sleep", with it always obvious whether to go to the feature's chat or the epic's.

## Decision

1. **No per-feature ownership.** `held_by`, `take_feature`, the finish choice, the
   automatic flip, the hold refusals and the startup owner repairs are deleted.
2. **Every feature is the human's by default.** They talk to it in its own chat. An
   orchestrator chat creates features, starts and plans them, reads them, edits a
   draft's brief and sets dependencies, and links the human to each chat. It does not
   message, stop, drive or merge them, and does not answer for the human.
3. **Autopilot is one switch per epic.** An epic is an orchestrator chat plus the
   features it created. After the epic's grill and cut, the orchestrator proposes a run
   plan (which features it takes how far, which wait for the human's grill); on the
   human's yes it turns autopilot on for the features that plan runs. Those lock: their
   chats can be watched but not typed in, and their leads report to the epic. The epic
   chat is the only place the human talks.
4. **How far it goes is the human's words**, not a setting. They may hand their
   decisions to the epic; then the orchestrator answers for them within hard limits
   (money, accounts or setup for the human, anything irreversible outside git, anything
   they named as theirs), marks each `Decided by autopilot`, and gives one summary on
   their return.
5. **Only the human ends autopilot**, in the epic or with the "End autopilot" link in any
   locked feature's chat, which works without an orchestrator turn. Ending it returns
   every feature; each lead is told and re-asks its open questions in its own chat.
6. **"Needs you" stays the agent's call** (from `needs-you-is-the-agent-s-call`). A locked
   feature never shows it; its questions go to the epic, which shows its own.

## Consequences

- One check, "may this orchestrator chat act on this feature", replaces every hold
  refusal: create, start, plan and read always for the epic's own features; message,
  stop, drive and merge only while the feature is locked to that epic.
- Charter decision 9 ("the human makes every decision") becomes a default the human can
  hand to an autopilot; decision 18 (ownership) becomes this ADR's model. The project
  session rewrites both at merge.
- The skills lose owners, finish choices and taking; the broader rewrite is
  `skills-become-short-rules`.
- A usage limit is handled by the human's "carry on" setting, on autopilot too; the run
  plan says when it is off.
