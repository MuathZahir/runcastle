## Purpose

Today, opening a started feature whose lead has never run launches the lead at once: it reads its brief and speaks first. That comes from `triage-batch-chat-bugs-attachments-and-sessions-that-start-by-themselves` decision 6 ("A new feature's chat starts itself the first time it is opened"), refined by its decisions 10–12 and 14 (`docs/features/triage-batch-chat-bugs-attachments-and-sessions-that-start-by-themselves/decisions.md`). In the web it is `startsItself()` and the effect beside it in `apps/web/src/components/workspace/FeatureChat.tsx`.

The human finds this wasteful: clicking a feature just to look spends tokens and sets an agent going they did not ask for. This feature takes the alternative that decision 6 recorded and passed on: a **Start** button on the empty chat. Record it as a decision that supersedes decision 6 (and the parts of 10, 11, 12 that only exist to serve the start-by-itself).

## Decided with the human (orchestrator chat, 2026-11-09)

- **Opening a never-run started feature launches nothing.** Its empty main chat shows a **Start** button. Pressing it does what opening does today: the normal launch, the agent reads its brief, explores and speaks first.
- **Start is the only way in. No typing first.** The composer cannot send until the agent has been started. The human's words: "The user doesn't want to initiate himself, the agent has to explore." So drop today's path where a first message starts the chat with the briefing held ahead of it, for this case.
- **Plan it yourself stays** where it is today, beside it, unchanged.
- **A backlog draft's Start is untouched.** It already cuts the branch and launches the chat directly (`Workspace.tsx`, the `feature.start` mutation's onSuccess); the human counts that click as their start, so it must still land on a running agent, never on a second Start button.

## Understood

- Which features count as "never run" stays as decision 14 has it (no sessions, tickets or runs; brief on disk; started; not shipped or archived).
- The orchestrator's own paths (`plan_feature`, `send_to_feature`) and up-next drafts that start by themselves are unaffected: they never relied on the open-to-start effect.

## Must not swallow

- No change to side threads, project chats, worker chats or the preparation chat: they already wait for a first message.
- No change to the backlog draft page or its Start / Plan it yourself.
- No redesign of the empty chat screen beyond placing Start.

## Open (for the plan, how it is built)

- Whether the composer is hidden or shown disabled until Start, and what it says. Keep it quiet and consistent with the app's empty states (`apps/web/STYLE.md`).
- Where exactly Start sits (the empty chat's centre, the composer's place, or the next-step bar), and how it looks on a phone.
- What happens to a draft saved for the unstarted chat (triage decision 12) now that typing cannot start it.
- A refused start (runtime not ready): show the refusal and leave Start pressable.

## Working agreement

**Autonomous**, chosen by the human 2026-11-09. The orchestrator carries it through to merged, merging when it judges it right, relying on the lead's review. Any decision in the plan that changes what the human sees or how runcastle behaves for them still goes to the human first.

Planning mode: plans itself — the one decision that was the human's was grilled here; only the build is left.

## Ordering

Standalone. It edits the same feature chat area as the just-shipped `clicking-a-feature-opens-its-lead` (sidebar), but not the same files' logic; nothing waits on it.
