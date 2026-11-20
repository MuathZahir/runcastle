# A usage limit never strands work

## Problem

With "carry on when the usage limit resets" switched on, the human expects every chat a usage limit stopped to start again by itself once the limit lifts. Three things break that today:

- The host only looks for the limit when a turn **fails**. In the 19 Nov run (runcastle 1.7.4) a review worker's turn ended normally with the limit notice as its reply; nothing was held, nothing woke it, and work sat dead for 7.7 hours. Codex's limit error is missed too: the host reads the error's `details` field, and codex-acp puts the text in `message`.
- A wake that fires while the limit still stands strands the chat. The retry asks the usage report for a reset time, the reset-time picker ignores times already past, and the chat ends on "could not tell when it resets, so it carries on with your next message", which waits on the human forever.
- The wake is an in-memory timer per chat, and nothing re-arms it at server start, so a restart during a limit loses it.

## Approach

From the human's side: a chat stopped by the limit shows one notice saying when runcastle carries on; it carries on at that time, or a little later if the limit has not lifted yet, without anyone nudging it. A restart changes nothing. With the setting off, nothing changes from today.

### Catching the limit (decisions 1, 2)

One question, asked at every turn end the host sees (prompted turns, turns the agent started by itself, steered turns): did the account's usage limit stop this turn? It is yes when any of these holds:

- the turn failed and its error text matches the existing limit wording (today's rule);
- the turn ended in any other way and its **last reply is the limit notice itself**: a short reply (a few hundred characters at most) that **opens** with the runtimes' own wording ("You've hit your … limit", "Claude AI usage limit reached", Codex's "You've hit your usage limit…"). A reply that quotes the wording later in its text does not count;
- a sub-agent (a Task/Agent tool call) inside the turn returned a result that is the limit notice itself, by the same rule.

The anchored "is the notice" rule lives next to today's loose wording rule in core's provider-halt module, as a second exported function; the loose one stays for error text, where no agent wrote it. The error reader also takes Codex's `data.message` when `data.details` is absent.

A yes goes through today's limit stop (held text kept, notice posted, wake armed). The worker service already treats a limit as "not a failure, not retried", which holds for the new paths too since they arrive through the same turn end.

### The hold and its wake (decisions 3, 4, 5)

A **usage hold** is one saved row per held chat: the chat, its runtime, when the wake fires, and whether the "still standing" notice was already posted. It lives in a new table in the core drizzle schema, with a migration. The in-memory timer stays the mechanism; the row is what survives.

```
stopped by limit ──► reset known?  yes ─► wake = reset + 1 min
                                   no  ─► wake = now + 5 min
wake fires ──► setting off?           ─► drop the hold; the next human message carries on (today)
           ──► fresh usage read: still used up, reset ahead? ─► wake = that reset + 1 min, start nothing
           ──► otherwise start the chat with the reset line
turn hits the limit again ──► held again; wake = report's reset ahead + 1 min, else now + 5 min
turn runs ──► drop the hold
```

- The fresh read bypasses the 60-second usage cache; a read that fails counts as "cannot tell" and the chat is started anyway (a failed start costs one rejected request).
- Notices: the first stop posts one notice, as today, with the new "cannot tell" wording ("…so it tries again every 5 minutes"). The first time a wake finds the limit still standing posts one more ("The limit has not lifted yet. Runcastle tries again at 3:45 pm."). Later tries post nothing.
- A human message to a held chat runs at once as today; when its turn runs, the hold is dropped. Archiving a chat or turning it off drops its hold.
- At server start the host reads every hold and arms its timer; one whose time passed fires a few seconds after start, all together. The cut-off-chat reconcile at boot is unchanged.
- The account-wide "limited until" mark stays in memory; after a restart the first prompt that hits the limit sets it again.

### Waking together (decision 6)

Each hold has its own timer, so chats held by the same limit wake at the same moment. Leads and orchestrator chats start at once; workers take a worker slot as today. No change to the slot pool.

## Seams

- **The host's turn end** (existing): the agent-host tests drive a fake ACP agent. New fakes: a turn that ends `end_turn` with the limit notice as its last reply; one that only quotes the wording; one whose sub-agent tool result is the notice; a Codex-shaped error with the text in `data.message`. Observe: the hold row, the notice, whether a wake prompt is sent.
- **Host restart** (existing pattern: build a second host over the same data dir): the hold row survives, the new host arms it, the wake fires and the chat carries on.
- **The usage read** (existing fake `readUsage`): a wake that finds the limit still used up re-arms at the new reset without a prompt; a wake whose turn fails again re-holds and tries 5 minutes later (short intervals injected for tests, as the grace already is).
- **The notice rule** (existing core test): notice-shaped replies match, quoted mentions do not.

These cover the brief's accept lines: a normal-ending turn with the limit text ends held with a saved wake that survives a restart; a wake that fires while the limit stands tries again later and carries on.

## Out of scope

- The worker that shows "working" with no process behind it: its own feature, [A worker never shows working with nothing running](feature:a-worker-never-shows-working-with-nothing-running), which waits on this one.
- A general "nothing is running" watchdog.
- The "carry on" setting and its default (off).
- The worker slot pool and its width.
- Compacting or ending a chat before a long hold to make its wake cheaper (audit 4.5).

## Open questions

- Codex's exact limit wording is read from codex-acp's source, not seen live; the test uses that shape. If a live Codex limit reads differently, the notice rule needs its wording.
- How Claude Code words a sub-agent's limit failure is inferred from the 19 Nov transcript summary in the audit; the test uses the main notice's wording.
