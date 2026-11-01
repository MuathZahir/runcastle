# Decisions — Threads open fast and show the truth

Planned without the human on 2026-11-01. Each decision below carries the alternative it was
chosen over. The numbers quoted come from this machine's real thread logs, the running 1.6.0
server and real Chrome.

## 1. A replied thread with a command running reads "Agent working"
**Decision:** When the agent's turn has ended and one of its background commands still runs, every status the human reads at a glance says the agent is working: the feature's row and lane, the feature header, and the thread's own row. One rule in `@runcastle/core` answers for all of them, and whatever else reads the waiting flag follows it.
**Why:** The false "Waiting on you" is the bug. 40 of 309 logged turn ends had a command still running, so this is common. One rule keeps the sidebar and the header from disagreeing.
**Assumed.** Alternative: fix only the feature row, which leaves the header and thread rows saying something else.

## 2. A running command counts for at most 10 minutes after the turn ends
**Decision:** After 10 minutes the thread goes back to "Waiting on you", even if the command still runs.
**Why:** Nothing in what Claude Code reports separates a test run the agent waits for from a dev server it left up, so time is the only honest limit. In the logs, half of these waits resolved within 1.5 minutes and 90% within 5.5. Only 2 of 40 took longer than 10 minutes. A wrong "working" hides a question, so the limit stays short, and past it the thread errs towards "waiting".
**Assumed.** Alternative: 20 minutes, which would have covered all 40 logged cases (the longest was 19.3) but can hide a question twice as long.
**Challenged:** At 10 minutes a real test run flips to "Waiting on you" with nothing asked, which is the reported bug again, and the 40 cases may leave out commands that never ended. A recount found all 59 logged commands ended and 9 ran past 10 minutes, so the flip will happen sometimes. It stands as the safe direction: a late false "waiting" costs a glance, a hidden question costs the human's time.

## 3. A question always beats a running command
**Decision:** The thread shows "Waiting on you" at once, whatever is running, when any of these holds: the agent asked through the app (an approval, a question or a form), the lead set a waiting reason with `wait_for_you` or declared ready, or the agent's last message ends in a question mark. The feature skill also gains one line: a lead that hands something to the human while a command runs must call `wait_for_you`.
**Why:** This is the brief's catch, and the brief says the agent has to handle it. The first two signals are exact. The question mark is a plain, language-neutral test for an agent that just writes its question in the chat. None of the 40 logged cases ended on one, so it never gives a false alarm in the logs, but it also caught nothing. Reading those 40 last lines, about 4 really handed something to the human in prose ("So tell me which direction you pick"). 32 of the 40 were Orchestrator chats, whose rows never said "Waiting on you" in the first place, and 8 were feature leads. So the leads are the real risk, which is why the exact fix goes there.
**Assumed.** Alternative: trust only the exact signals, and let a question typed in prose wait out the 10 minutes.
**Challenged:** A question mark misses "Try it and tell me what you think", the likely dev-server handoff, and no hits in 40 cases shows the test is unproven, not free. The logs confirm the miss. It stands as a cheap net under the exact signals, and a miss waits at most 10 minutes.

## 4. The chat itself still treats the turn as over
**Decision:** The composer stays as it is after any finished turn: the human can write, and a message starts a new turn. The strip above the composer keeps showing the running command with its timer. Only the status labels change.
**Why:** The turn really has ended, so the composer must not pretend otherwise. A message is not steered into a turn that does not exist, and no Stop button appears for it.
**Assumed.** Alternative: show the thread as mid-turn, with Working and Stop, which would misdescribe what a message or Stop does.

## 5. Codex threads keep today's behaviour
**Decision:** The rule applies only where background work is reported, which today is Claude Code. A Codex thread with no such report reads as it does now.
**Why:** The only path that logs background commands is Claude Code's forwarded session message. Guessing for Codex would invent a signal.
**Assumed.** Alternative: read Codex's own output for signs of a running command, which is a guess that could hide a question.

## 6. Fix the reads, and do not page long threads
**Decision:** A thread keeps loading whole. There is no "show the latest part first, load the rest on demand". The fix makes reading fast, stops reads being thrown away, and stops the thread waiting behind other reads.
**Why:** The browser's drawing is not the slow part. In real Chrome the largest thread (4.5 MB, 1,900 events) draws about 880 elements and its heaviest single task is about 120 ms, because settled turns are folded with nothing inside them. The time goes on reads. While a thread works, each new event cancels the read in flight, so when a read is slower than the 120 ms signal rate nothing lands until the agent pauses: with a 270 ms read, 24 reads started and none was shown. A read in the page takes that long because a signal reads the whole log twice in one batch (8.4 MB). That is the "old state, then a snap", and it is why long and working threads are the bad case.
**Corrected during the build:** The plan said a read costs about 270 ms, nearly all of it re-validating lines. That was wrong. Those numbers came from `curl` to `localhost`, which loses about 200 ms on Windows trying IPv6 first. The real read of the largest log is about 35 ms in the installed server and validation is a small part of it. The decision stands, because the Chrome timings stand: `scripts/thread-timing.ts` measured a worst lag of 5.5 seconds on a working thread and an old state drawn first on every reopen. The human has not seen this correction.
**Assumed.** Alternative: latest-first paging, which would add a new way of reading to the fold the server and the web share and would save very little.
**Challenged:** The brief says measure first, and a 270 ms read does not explain an idle long thread feeling slow. Rendering was then measured in real Chrome, as above, and the idle case is decision 13.

## 7. What "quickly" means
**Decision:** On the largest real thread: under 300 ms to its full current state when switching to it inside the app, under 1 second the first time after a server start, under 2 seconds when reloading the page on it, and a working thread on screen never more than 1 second behind its log. All measured on this machine with agents working.
**Why:** Today a switch takes about 500 ms on a quiet machine and a reload 3.7 to 7.6 seconds in a new browser, about a second less in one that has passed the setup check. These are numbers a person can feel. The first build step confirms they can be reached, and if one cannot, the lead says so rather than quietly moving it.
**Assumed.** Alternative: a single 500 ms target for every open, which would need work well outside threads.
**Challenged:** Targets were set before rendering was measured. They were revised after it was.
**Result:** Every target is met but one. The first open after a server start came in at 1.15 to 1.9 seconds against 1 second. The target stands, and `spec.md` says why it was missed.

## 8. A thread shows nothing older than the server's current state
**Decision:** Opening a thread paints it only once a read that started at that opening has answered. A log held from an earlier visit is never drawn first. If that read fails, the held log is shown with a line saying it may be out of date, since a marked old thread beats a blank one when the server cannot be reached.
**Why:** The brief asks for this outright. The held log is what paints the old state today, and ticket 16 of `chat-as-web-components` made it catch up afterwards rather than stopping it being shown first. With reads this fast the wait should not be visible; the "Loading the thread…" line stays for a read that is slow.
**Assumed.** Alternative: draw the held log at once, marked as catching up. It feels faster but still shows the old state first.
**Challenged:** Showing the held log unmarked on a failed read breaks "never shown an old state". Taken: the out-of-date line above was added.

## 9. Build for the VPS tunnel, and check it after the move
**Decision:** The feature is built with the SSH tunnel to the VPS in mind: one open makes one read of the log, not the two it makes today, and large answers are compressed. The targets in decision 7 are proven on this machine only; the tunnel is checked by hand once the move has happened.
**Why:** Runcastle is moving to the VPS, where every open of the largest thread would otherwise send 8.6 MB uncompressed. One read halves that, and gzip takes it from 4.4 MB to 1.1 MB in 35 ms. Neither costs much now and both would be missed later.
**Assumed.** Alternative: localhost only, and treat the tunnel as a later feature.
**Challenged:** Keep the single read but drop the tunnel work: no tunnel timing was measured and the brief did not ask for it. The claim that the targets hold over the tunnel was dropped; compression stays, because it is a small change and the move is close.

## 10. The lead builds it, then one review round
**Decision:** The lead builds this itself in its own window, with no worker tickets for the code, then runs one review ticket that drives the real app.
**Why:** The pieces share a few files and depend on the same measurements, so workers would add container and re-reading cost with no parallel gain. The status rule and the open path are surfaces a human reads, so an independent look is worth it.
**Assumed.** Alternative: three worker tickets, one each for the server read, the web read and the status rule.

## 11. The label stays "Agent working"
**Decision:** A thread with a command running after its reply says "Agent working", the brief's words. There is no third label such as "Command running".
**Why:** The human asked for this label, and the brief rules out status lanes beyond what this false "waiting" needs. The running command already shows, with its timer, in the strip above the composer.
**Assumed.** Alternative: "Command running", which claims neither working nor waiting and might make the 10-minute limit unnecessary. This branch came from the challenger.

## 12. Background sub-agents count as well as commands
**Decision:** A sub-agent left running in the background keeps a thread on "Agent working" under the same rules as a command: 10 minutes at most, and a question beats it. It still shows as its own row in the chat, not in the command strip.
**Why:** It is the same false "Waiting on you". Claude Code reports both in the same message, and runcastle currently drops the sub-agents from it.
**Assumed.** Alternative: commands only, as the brief words it, leaving a lead that waits on a sub-agent showing "Waiting on you". This branch came from the challenger.

## 13. Reloading the page counts as opening a thread
**Decision:** The work covers a reload on a thread's address, not only switching threads. The thread's own reads go on their own requests, so nothing else can hold them up, and the thread stops waiting for the feature list before it asks.
**Why:** A reload is where the "Loading thread" wait really lives: 5.4 seconds in the breakdown, of which the thread's own read is about 0.3. The rest is the setup check (1.1 seconds, and only because the test browser was new: a browser that has passed it before skips this wait), then a batch holding the feature list (1.7 seconds), then a batch where the thread's reads wait for the slowest thing beside them (1.7 seconds). This also covers an idle long thread feeling slow, which the working-thread fix alone would not.
**Assumed.** Alternative: fix only reads inside the thread and leave page load for another feature, which leaves the human's most visible wait in place.
