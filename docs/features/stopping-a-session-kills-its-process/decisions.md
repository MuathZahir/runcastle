# Decisions — Stopping a session kills its process

Planned with nobody present. Every decision below except 1 was made by the lead and waits for the human's look.

Check first: 3, 4, 5, 6

## 1. Fix the leak, start the work
**Decision:** Stopping a session must really end its agent processes (the leak that held 12 GB of memory). The human said, of the audit's bug list that named this one: "Alright, you can create the features and start them."
**Why:** The 36-hour run on 18–20 Nov 2026 ended with 66 `claude` and 67 `bun` processes left over, swap full and builds killed for memory.

## 2. Nothing new to see
**Decision:** No screen, notice or setting changes. The fix is felt as memory that comes back. The server's log line says how many leftover processes it ended at start-up.
**Why:** It is a bug fix in the server, on Linux, macOS and Windows, for every runcastle user.
**Assumed.** Alternative: a line on the project timeline when start-up ends leftovers.

## 3. Every stop asks first, then forces, then checks
**Decision:** A stop (idle stop, model change, edit-a-message fork, stall kill, archive, server shutdown) asks the agent to quit, waits about 5 seconds, then forces it and everything it started, and checks they are gone. If something survives, the server log says which process.
**Why:** Today the stop signals a process group that does not exist, swallows the error and never waits, so nothing dies. A stalled agent may even keep spending tokens.
**Assumed.** Alternative: force at once, with no polite wait. That is faster, but the agent gets no chance to save its conversation.

## 4. The same conversation never runs twice
**Decision:** A conversation does not restart until its old process is gone. A message sent right after a stop or a model change can start up to about 5 seconds later than today.
**Why:** The survey found a second cause: the server forgets the old process before killing it and never waits, so the next message resumes the same conversation beside it. That is how two `claude` processes held one resume id. It may also be behind the false "this orchestrator session has ended" lock-out, which a separate feature handles.
**Assumed.** Alternative: restart at once and let the old one die beside it. That is what happens today.

## 5. Leftovers are cleaned at server start only
**Decision:** When the server starts, it ends leftover agent processes from its own earlier runs. There is no hourly sweep.
**Why:** Once stops really kill, nothing should leak during a run, so an hourly sweep would be machinery with nothing to do. The start-up clean also clears what 1.7.4 already leaked, the first time an upgraded server starts.
**Assumed.** Alternative: also sweep every hour, as the audit suggests.

## 6. Only processes this runcastle started are ended
**Decision:** A process is a leftover only when it carries this runcastle's own session mark: the session id runcastle gives every agent it starts, together with this server's own address (or, where a process's environment cannot be read, its settings path inside this runcastle's data folder). Anything else is left alone, including the human's own `claude` in any folder, another runcastle install, and a drive of runcastle on another port.
**Why:** The brief says never kill a process runcastle did not start. Matching on "a `claude` in a runcastle worktree" would hit the human's own terminals.
**Assumed.** Alternative: write each process id to a file when it starts and end only those. That is narrower, but it misses everything 1.7.4 already leaked, since 1.7.4 wrote no such file.

## 7. The other leaky stops get the same fix
**Decision:** The same broken stop is fixed where it also leaks: the Codex usage read (a `codex app-server` per read), the timeout of short `claude` commands (naming runs, the agent list, doctor checks), and a cancelled image build. Worker containers themselves are not touched.
**Why:** They share the same kill helper and leak the same way. Fixing the helper fixes them nearly for free. The brief keeps container stop behaviour out.
**Assumed.** Alternative: fix only the agent sessions, as the brief's title says.
