# Decisions — You always know what's waiting

Planned without the human (self-planning run, 2026-11-02). Every decision below is
assumed until the human confirms it.

Terms used throughout:
- **Needs you** — the sidebar's top group: features where nothing moves until the human acts.
- **Status line** — the one line of state beside the feature's title in the page header ("Working · Round 3", "Waiting for you · …").
- **`wait_for_you`** — the tool a feature's agent calls to say "nothing moves until the human acts", with a reason in a few words.
- **Lead** — the feature's main chat agent, which plans, runs rounds and hands the work over.
- **Holder** — an orchestrator thread that carries a feature for the human ("Threads hold features"). Only the holder may ping the phone about a held feature.

## 1. What a feature needs from you is one of a fixed set, each with its words and its button
**Decision:** When a feature waits on the human, it says exactly what for, from this set:

| Need | Words (sidebar row and status line) | The button beside it |
|---|---|---|
| An answer | Needs your answer · *the agent's reason* | Reply (brings the main chat to the front and puts the cursor in the message box) |
| A plan to say yes to | Plan to approve | Open plan |
| A design to look at | Design to approve | Open design |
| A permission prompt | Needs permission · *what it wants to run* | Show request (brings the asking thread to the front) |
| A test drive | Ready to test · *the drive's name* | Start test drive |
| A merge | Ready to merge | Merge & ship |
| A merge conflict | Merge conflict | Resolve conflict |
| Something stopped | Stopped · *why* (you stopped it, the run failed, a restart cut it off, the provider's limit, planning stopped) | Chat (resumes the agent) |

The sidebar row and the status line use the same words. "Working", "Planning by itself" and "Talking with you" stay as they are.
**Why:** The human's words: "the user shouldn't have to look around … when he comes back to a feature." Today a plan yes, an answer, a drive and a merge all read "Waiting on you", and a feature ready to merge reads "In progress". A fixed set keeps the status line truthful, as the earlier status-line features insisted, while still telling them apart.
**Assumed.** Alternative: keep "Waiting for you" as the label and show only the agent's free-text reason after it.

## 2. The agent says which kind of wait it is
**Decision:** `wait_for_you` takes an optional kind besides its reason: an answer (the default), a plan, a design, or stuck. The feature stores the kind next to the reason. The skills tell the lead which kind to use: a plan yes is "plan", a design to look at is "design", the runaway guard is "stuck". A reason sent without a kind counts as an answer, so older agents keep working.
**Why:** The agent is the only one who knows what it waits for. Guessing it from the free-text reason ("start round 1?") would break the first time an agent words it differently.
**Assumed.** Alternative: read the kind out of the reason's words.

## 3. Words the agent puts to you never fold away
**Decision:** A turn's answer is everything the agent wrote after its last piece of real work. Tool calls that only talk to the human (waiting for you, declaring ready, pinging the phone, showing a file) no longer end the answer, so a question written before `wait_for_you` stays in view with the words after it. The skills also change: the question is the last thing the agent writes, and it never points back at words the human may not see ("that question", "my reply above").
**Why:** Both project notes show the same failure: the agent wrote its question, called `wait_for_you`, then wrote a closing line. The chat folded the question into "Worked for 1m 50s", closed by default, and the human saw only "The feature is waiting on your answer to that question." Fixing the chat makes it safe whatever the agent does; the skill change makes it read well.
**Assumed.** Alternative: show every word the agent wrote in a turn, and fold only tool calls and thinking.

## 4. The chat itself says what it waits for
**Decision:** While the feature waits on the human, the main chat ends with one line under the agent's last words: the same words as the status line ("Plan to approve", "Needs your answer · which model for approvals?"). It has no button of its own; the header carries it. It goes away the moment the human replies or acts.
**Why:** Today the reason shows only as a dot and in the sidebar. Someone reading the chat should not have to look up to the header to learn that the turn ended on them.
**Assumed.** Alternative: no line in the chat; the header alone says it.

## 5. Ready to merge means you drove it since it was declared ready
**Decision:** A feature the agent declared ready reads "Ready to test" until the human has finished a test drive of it since that declaration. After that it reads "Ready to merge", and Merge & ship becomes the header's button, with Start test drive moved to the "⋯" menu. Notes the human sends wake the agent, and the feature reads Working again.
**Why:** Runcastle has no other fact that says "the human is happy". The drive is the step that comes right before merge, so a drive that ended with no notes sent is the closest truthful signal. Merge still needs the human's click, so a wrong guess costs nothing.
**Assumed.** Alternative: the agent marks it ready to merge itself, after the human says "all good" in the chat.

## 6. Merge & ship is always in the header
**Decision:** On a started feature that has not shipped, the header always shows Merge & ship as a quiet button, beside the state's own button. When the state's button is Merge itself (ready to merge), it is the main button and appears once. The "⋯" menu keeps everything else.
**Why:** The project note asks for Merge to be easy to reach. Design mode's decision 12 meant Merge to stay in the header, and the feature lead's decision 24 said "Merge always present", but nothing ever offers it, so it is always behind "⋯": a regression. The header gains at most one button.
**Assumed.** Alternative: show Merge in the header only when the feature reads Ready to merge.

## 7. New thread gets a button, a palette entry and a shortcut
**Decision:** A started feature's header gets a "New thread" button (a "+" icon with a tooltip) beside "⋯". The Ctrl+K palette (⌘K on a Mac) gets a "New thread" entry while a feature is open, and Ctrl+Shift+O (⌘⇧O on a Mac) opens a new thread from anywhere on a feature's page. The sidebar row keeps its hover "+".
**Why:** The project note asks for an easily reachable button and a shortcut. Today the only door is a "+" that appears only when the mouse is over the open row. This revises the sidebar-threads decision that kept it hover-only, which the human has already said yes to changing.
**Assumed.** Alternative: make the sidebar row's "+" always visible instead of adding a header button.

## 8. The palette offers the open feature's actions
**Decision:** While a feature is open, Ctrl+K shows, before the general entries: its current button (the one beside the status line), New thread, Merge & ship and Start test drive. Each is disabled with its reason where the header would disable it. The palette's feature rows also show the new state words from decision 1.
**Why:** The brief asks for feature-scoped palette actions, and the palette is where a keyboard user looks first. Reusing the header's own actions means the two can never disagree.
**Assumed.** Alternative: only New thread in the palette.

## 9. A pending permission prompt is its own state
**Decision:** When any of the feature's threads (main or side) waits on a permission prompt, the feature reads "Needs permission · *what it wants to run*", sits under Needs you, and pings like any other wait. Its button brings the asking thread to the front, where the prompt's answer box already is. A permission prompt in an orchestrator thread marks that thread as waiting in the sidebar, but no feature.
**Why:** Today a prompt waits forever with no sign outside the thread itself. The human's own rules ("ask before git push") keep prompts coming even in bypass mode, so it has to be visible. Which session kinds run in bypass mode stays with the small-fixes sibling.
**Assumed.** Alternative: only the main chat's prompts count.

## 10. A round cut off by a server restart wakes the lead
**Decision:** When the server finds at start-up that a round was cut off by a restart, it tells the lead the same way a finished round does: a message saying the round was interrupted, how many tickets landed and how many are pending. The orchestrator holding the feature hears the same news. The lead may run the round again without a new yes, since it is work the plan already settled; if it cannot, it waits for the human with kind "stuck". If waking the lead fails, the feature reads "Stopped · the agent's run failed", as any failed wake does today.
**Why:** Today such a round is marked failed and nobody hears, so an unattended feature simply stops: exactly "I come back the next day and it stalled". Treating it as a round ending reuses the path that already works.
**Assumed.** Alternative: don't wake anyone; show "Stopped · a restart cut the round off" and wait for the human.

## 11. Desktop pings fire when you are needed, and no longer when a round succeeds
**Decision:** With desktop notifications on, runcastle pings when a feature enters any state of decision 1, and only on that change. It no longer pings when a round finishes or fails: the agent handles both and asks when it can't. A ping names the feature and the need ("Plan to approve — You always know what's waiting"), and clicking it opens that feature. Pings cover every project, not only the open one. As today, they fire only while the runcastle tab is hidden or out of focus.
**Why:** The only ping today is a round finishing, the one moment the human isn't needed. The audit's direction is to ping on waiting, ready and merge conflict.
**Assumed.** Alternative: keep the round-finished ping as well.

## 12. Runcastle pings your phone by itself only for stalls no agent can report
**Decision:** Phone pings stay the agents' choice, as "Agents can notify your phone" decided, with one exception: runcastle itself pings the phone when a feature stalls in a way its agent cannot report: a permission prompt waiting, a round cut off by a restart that failed to wake the lead, or a lead wake that failed. For a feature an orchestrator holds, runcastle pings nobody: the orchestrator hears the news line and decides. The skills are sharpened so the lead calls `notify_human` whenever it waits for the human after working unattended (a round, a self-planning run, a headless wake).
**Why:** The human chose agent-sent pings over automatic ones, and said not to add automatic fallbacks. But a stalled agent cannot call anything: a permission prompt blocks it mid-turn, and a dead process says nothing. Those are exactly the cases behind "I come back the next day and find it stalled". Everything else stays the agent's judgement.
**Assumed.** Alternative: runcastle pings the phone by itself on every state of decision 1, for features no orchestrator holds.

## 13. The tab title counts what needs you
**Decision:** The browser tab reads "(2) runcastle" when two features, across all projects, need the human, and plain "runcastle" when none do.
**Why:** It is the cheapest ping there is: a pinned tab shows it without any permission.
**Assumed.** Alternative: count only the open project.

## 14. The sidebar, header, chat, palette, tab title and pings read one answer
**Decision:** What a feature needs is worked out once, on the server, from facts it already has: the waiting reason and its kind, ready declarations, drives, open permission prompts, merge conflicts, wake failures. The feature list carries it, so every place that shows it shows the same thing, and the pings fire from its changes.
**Why:** Today the sidebar and the status line each work it out from different data, and they already disagree (the status line says "Ready for you" while the sidebar says "In progress"). One answer is the only way decisions 1, 11 and 13 stay true together.
**Assumed.** Alternative: keep two readings in the web app and teach both the new states.

## 15. A design to approve is wired now; the design list stays with the sibling
**Decision:** "Design to approve" (decision 1) is a full state now: the lead sets it with `wait_for_you` kind "design", and its button opens the design view on the feature's recorded design server. The list of designs, the design and plan cards in the chat and the design badge stay with "Designs and the plan get their own place", which will point this button at its list.
**Why:** The brief asks for a clean place for the sibling to plug into. A kind the agent can already set, with a button that already works, is that place, and it costs a few lines.
**Assumed.** Alternative: reserve the kind and leave it unused until the sibling builds it.

## 16. The screens are drawn in the plan, not built as live designs
**Decision:** This feature changes the header (state words, one or two buttons, a New thread "+"), the sidebar row's words, and adds one line at the end of the chat. These are drawn as mock-ups in the plan preview rather than as live designs on a dev server.
**Why:** The changes are words and one or two buttons on screens whose layout stays as it is. The working agreement asks to put a design in front of the human only when the feature really needs their eyes, and to keep everything else moving.
**Assumed.** Alternative: build live design pages for the header and the sidebar.
