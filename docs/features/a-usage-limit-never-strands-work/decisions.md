# Decisions — A usage limit never strands work

Planned automatically with nobody present (2026-11-20). Every decision marked **Assumed.** waits for the human's word.

Check first: 2, 3, 4, 6

## 1. A limit is caught however the turn ends
**Decision:** With "carry on when the usage limit resets" switched on, runcastle holds a chat and sets its wake whenever the usage limit stopped its turn: a turn that failed with the limit (as today), a turn that ended normally with the limit notice as its last reply, a turn where a sub-agent came back with the limit notice, a turn the agent started by itself, and a Codex turn whose limit error runcastle cannot read today.
**Why:** The human approved the bug "A usage limit is missed when the turn ends normally, so nothing wakes up at the reset". In the 19 Nov run the limit came back as an ordinary reply and work sat dead for 7.7 hours. The code today only checks a turn that failed, and reads Codex's error in a field Codex does not fill.

## 2. A reply that only talks about the limit never holds a chat
**Decision:** A normal reply counts as a limit stop only when the reply is the limit notice itself: short, and opening with the runtime's own wording ("You've hit your … limit", "usage limit reached"). A reply that mentions or quotes the wording inside other text is left alone. The same rule applies to a sub-agent's result.
**Why:** Today's wording match is loose ("usage limit" anywhere). Used on normal replies, it would hold any chat that discusses limits, this very feature's chat included, and wake it later for nothing.
**Assumed.** Alternative: match the wording anywhere in the reply, as the audit proposed, and accept the odd false hold.

## 3. The wake checks before it starts the chat, and comes back if the limit still stands
**Decision:** The wake stays at one minute after the reset time the usage report gives. When it fires, runcastle first reads the usage report fresh. If the limit still shows as used up with a later reset time, it moves the wake to that time and starts nothing. Otherwise it starts the chat; if that turn hits the limit again, the chat is held again and tried again 5 minutes later, or at the report's new reset time if it gives one.
**Why:** The human worried the reset time moves, and floated a 5-minute buffer, leaving the method open. A fixed buffer delays every resume and still fails when the reset moves by more; checking first and retrying handles any shift and costs only a quick usage read.
**Assumed.** Alternative: the human's 5-minute buffer after the reported reset, on top of the retry.

## 4. A held chat keeps trying until the limit lifts, and never waits on the human for it
**Decision:** When runcastle cannot tell when the limit resets, at the first stop or on a later try, it tries again every 5 minutes instead of waiting for the human's next message, for as long as the setting is on. The chat says so once ("Runcastle could not tell when it resets, so it tries again every 5 minutes"), and once more if a wake finds the limit still standing; later tries are silent. A message from the human still starts the chat at once, as today.
**Why:** Today the chat says "could not tell when it resets, so it carries on with your next message" and waits forever. That is the second way a limit strands work, and the reason the human gets this feature.
**Assumed.** Alternative: give up after a few hours of tries and flag the chat as needing the human.

## 5. A wake survives a server restart
**Decision:** Each held chat's wake is saved in runcastle's database and set again when the server starts. A wake whose time passed while the server was down fires right after start.
**Why:** The wake is only an in-memory timer today (confirmed in the code), and nothing re-arms it at start, so a restart during a limit loses it and the chat waits for the human.
**Assumed.** Alternative: none worth weighing; marked only because the brief, not the human, asked for it.

## 6. Held chats wake together; the worker queue stays as it is
**Decision:** Every held chat already gets its own wake at the same time, and this stays. Leads and orchestrator chats start at once. Workers, review workers included, still wait for one of the worker slots (3 by default, set by the human), so some start only when another worker's turn ends.
**Why:** The 30 to 35 minute gaps the audit saw came from that worker queue, not from the wakes. Letting woken workers jump the queue would run more containers at once than the human set.
**Assumed.** Alternative: let workers woken from a limit start without waiting for a slot.
