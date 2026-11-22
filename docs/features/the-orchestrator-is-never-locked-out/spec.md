# The orchestrator is never locked out

## Problem

In a 36-hour autopilot run (runcastle 1.7.4, 18–20 Nov 2026) the orchestrator's tools refused
every action with "this orchestrator session has ended; a new one must be opened to act" while
its chat was open, taking turns and receiving handbacks. A ready feature waited 98 minutes for
its merge; only the human typing brought the chat back. The same false "ended" fired eight
times in one minute on 19 Nov.

The cause, confirmed in today's source (after "Stopping a session kills its process" merged):
a session's record (its row in the `sessions` table) is set to `ended` by Claude Code's
session-end hook no matter which process sent it. The hook names the session only by the
`RUNCASTLE_SESSION_ID` env var every process of that session shares. Nothing turns the record
back while the chat's process keeps running: the per-turn check-in skips ended rows on
purpose, and the record is only set live again when a new process starts. The process-kill
feature narrowed the ways a stale signal can arrive but left these open:

- **Server restart.** The sweep that kills a previous server's leftover agents runs in the
  background after boot, while the orchestrator is already being woken in a new process. The
  killed leftover's session-end hook reaches the new server and ends the new chat's record.
  Several leftovers explain "eight times in one minute".
- **A stop that finishes late.** The agent host's stop and stalled-turn kill mark the record
  ended after slow awaits (killing the process, diffing the turn's files). If a prompt started
  a fresh process for the same session meanwhile, the late mark ends the fresh one.
- **`/clear`.** Its end and start hooks are separate requests; arriving out of order, they
  leave the record ended.

Lead, worker and question chats share the same hook code and can be falsely ended the same
way. Only the orchestrator's tools refuse on it, but "is this feature's chat live" checks
read the record too.

## Approach

From the user's side: an orchestrator chat that runcastle is running can always act. A
falsely ended record heals itself the moment the chat takes a turn or calls a tool. A process
runcastle is not running (a leftover) is still refused, and told plainly to stop.

The agent host (the server part that starts, watches and stops every chat's ACP process)
becomes the only owner of whether a Claude session is ended. This is already how Codex
sessions work.

1. **The session-end hook stops ending sessions** (decisions 1, 3). For Claude, both the
   feature-scoped and project-scoped session-end handlers record a
   `session.conversation_ended` timeline note with the hook's `reason`, as the Codex path
   already does, and leave the record alone. The lead path still runs its merge-resolution
   check. The host already marks the record ended on every real end: a stop, a crash (any exit
   it did not ask for), a failed start, a stalled-turn kill, a boot reconcile, and the human's
   "end session".

2. **A late stop never ends a newer process** (decision 1). The host's stop and stalled-turn
   kill mark the record ended only if no newer process for the same session is running by
   then (the host's thread map holds a different thread for that id). The crash path is
   covered the same way.

3. **Running means alive** (decision 2). A new host query, "is this session's process
   running" (the existing check whether the host holds a thread for the id), decides revival:
   - The per-turn check-in (prompt-submit and stop hooks) no longer returns early on an ended
     record when the host runs the session. It marks it live, keeps `ccSessionId` and the
     transcript path current, and emits a `session.started` event saying it was revived by a
     turn. If the host does not run it, the record stays ended, as today.
   - The orchestrator gate does the same before refusing: ended but running means revive and
     allow; ended and not running means refuse.
   - The human's "end session" detaches the host's thread synchronously before marking the
     record ended (already true today), so a turn from the process being stopped cannot
     revive it.

4. **The refusal says what to do** (decision 4). The wording is in the spirit of: "this process
   is not the orchestrator chat runcastle is running (it was stopped or replaced); end your
   turn — the open chat carries on." The three tests that pin the old text are updated.

5. **The merge-conflict notice keeps working.** The web app's "a resolve session came and went
   without the merge landing" notice listened for the `session.ended` event the hook emitted.
   It now also counts `session.process_stopped`, which the host emits whenever a chat's
   process stops (for Claude and Codex alike, so Codex resolve sessions now count too).

No schema change, no new env var, no change to who may merge, start or message features.

## Seams

- **The hooks route** (existing, `POST /api/hooks/:event` in its route test): send a
  session-end for a live session and see the record stay live with a
  `session.conversation_ended` note; send a stop or prompt hook for an ended session with the
  host reporting it running and see it revived; with the host not running it, see it stay
  ended (the existing "never brings an ended session back" case, kept with that condition).
- **The orchestrator tools** (existing, their tool tests): an ended row whose session the host
  runs acts and is live afterwards; one it does not run gets the new refusal.
- **The agent host** (existing, its test with the fake ACP agent): stop a thread, start a new
  one for the same id before the stop finishes, and see the record live at the end.

These cover the brief's acceptance: a session-end from a stale process leaves the session live,
and a turn on an "ended" session revives it.

## Out of scope

- The process leak itself ("Stopping a session kills its process", merged).
- Making the leftover-agent sweep finish before chats are woken at boot. With decision 1 its
  late signals are harmless, so it is not needed here.
- Who may merge, start or message features.

## Open questions

None.
