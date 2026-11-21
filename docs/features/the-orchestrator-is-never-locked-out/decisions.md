# Decisions — The orchestrator is never locked out

Planned with nobody present; the epic (Runcastle Rethink, on autopilot) settled all four as written on 2026-11-21.

## 1. Only runcastle's own stop or crash ends a chat's session
**Decision:** Claude Code's "session ended" signal no longer marks a session ended. It becomes a timeline note, as it already is for Codex. A session is marked ended only when runcastle stops its process, the process dies, or the human ends it.
**Why:** Since every chat now runs as a process runcastle starts and watches, runcastle already knows when that process ends. The extra signal is the one that comes late and from the wrong process: a leftover agent killed when the server restarts, or an old process exiting after a new one started. Dropping it closes every such path at once, with nothing new to keep in step.
**Decided by autopilot.** Chosen over: keep the signal, but tag each process with an id and ignore a signal whose id is not the current one (the audit's suggestion).

## 2. A chat runcastle is running is alive, even if its record says ended
**Decision:** When a turn or a tool call comes from a session whose record says ended, and runcastle is running that session's process right now, the record flips back to live and the action goes ahead. A turn or tool call from a process runcastle is not running (a late signal from a killed process, or a stray leftover) does not revive it.
**Why:** This is the case the old "an ended record stays ended" rule protected: a killed process's last signal arriving after the stop must not bring the session back. Asking runcastle whether it runs the process keeps that protection and still unlocks the open chat.
**Decided by autopilot.** Chosen over: any turn revives the record (the audit's literal wording), which lets a dying process undo a stop.

## 3. The fix covers every kind of chat, not only the orchestrator
**Decision:** Lead, worker and question chats get the same two rules. Only the orchestrator's tools refuse on "ended", so the visible change is there, but a falsely ended lead or worker record also misleads the parts of runcastle that ask whether a feature's chat is live.
**Why:** The faulty code is shared by every kind, so the fix is the same change; limiting it would take extra code.
**Decided by autopilot.** Chosen over: change only the orchestrator's handling and leave the rest as a separate feature.

## 4. A refusal that remains says what to do
**Decision:** The orchestrator's tools still refuse a process runcastle is not running. The message says this process is no longer the chat runcastle runs, so it should stop, and the open chat carries on. It never tells the agent to open a new session.
**Why:** After decisions 1 and 2, only a stray process can be refused. The old message ("a new one must be opened") sent the agent the wrong way.
**Decided by autopilot.** Chosen over: remove the refusal entirely and let any process with the session's id act.
