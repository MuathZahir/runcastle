# Brief

## Why this feature exists

Born from project-notes triage (2026-09-28). The operator finds the chat's many layouts confusing and wants them unified. Today, by their account:

- **Project session**: the chat fills the whole content area on the right. The operator likes this one best.
- **Ideation / planning**: the chat sits smaller inside the content area. When it is opened via the top-bar toggle, the body shows a placeholder, "The chat is in the aside — close it to bring the terminal back here" (screenshot: `C:\Users\user\.runcastle\project-notes\pnote_Nlhmp0FYZxJA.png`, taken on "Start session" for a new feature, where the operator did not expect the side panel).
- **Other phases**: the session sometimes shows as a header band only, with a "Show Terminal" button that expands it.
- **Everywhere**: the top-bar "Chat" button opens a chat sidebar on top of whichever layout the page already has.

This drifts from what `one-chat-per-feature` promised: its decision 16 (`docs/features/one-chat-per-feature/decisions.md#16`) settled one inline panel docked beside the body in all four states, collapsible. The operator's preference has since moved towards the project session's full-area chat. This feature decides the one layout and moves every surface to it.

## Folded in: buttons that start a session must take you to it

Two notes are part of this feature, not separate fixes, because "take me to the chat" only means something once there is one chat surface to land in:

- Clicking **"End session & start lap 2"** (Iterate) on the Review page left the operator on Overview, still showing "Chat session still live from lap 1". They expected to see the Claude session (screenshot: `C:\Users\user\.runcastle\project-notes\pnote_Y3M7xI3h6TB_.png`).
- Clicking **"End session & resolve"** after a merge conflict does not move the operator to the chat. They had to click over to the Build page manually to find the resolving session (screenshot: `C:\Users\user\.runcastle\project-notes\pnote_1prAL9c1MhAF.png`).

The want: every action that starts or resumes a session (Chat, Iterate/next lap, End session & resolve, Start session, and any other `chat`-launching road) brings the chat forward in the one layout. `one-chat-per-feature` decision 12 already binds this for a live chat: the door returns you to it and never errors.

## Questions for this feature's own session

- Which layout wins: the project session's full content-area chat, decision 16's docked side panel, or something else? The operator leans towards the project session's.
- What happens to the page body (decisions pane, review trail, tickets) while the chat is open? Replaced, split, or reachable via tabs?
- What the top-bar Chat toggle becomes: does it survive, and what does it toggle?
- Whether the project session and feature sessions share the same layout component, so they can't drift apart again.
- Whether collapsed or "Show Terminal" header-only states survive at all.

## Must NOT swallow

- **Session/transcript semantics**: one chat per feature, one transcript, and resume rules are `one-chat-per-feature`'s. This feature is placement and navigation only.
- **Process lifecycle**: `session-process-trees-die-with-their-session-on-windows` is in flight and owns process teardown. Don't touch it.
- **The review trail's content and the merge-conflict card's state**: the stale-conflict fix rides the same triage pass's batch quick change.
- **The next-step bar's action set**: which verbs exist per state stays as is. Only where their session lands changes.

## Already settled, still binding

- `one-chat-per-feature` decisions 8 (a constant one-word "Chat" door), 12 (the door on a live chat brings it forward, never errors) and 16 (placement; this feature may supersede it, and must say so in its decisions).
- `review-arrival-is-legible` decision 4: no disabled buttons because of a live session. "End session & verb" compound labels are the pattern.
- `apps/web/STYLE.md` governs styling. Read it first.
