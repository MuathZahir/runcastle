# Triage batch — chat bugs, attachments and sessions that start by themselves

## Problem

Five small things go wrong for the human in the chat and in how agents behave:

- A turn can open with a stack of empty "Subagent · 0 calls" cards that have nothing to do with it.
- An image attached in one chat disappears after switching to another chat and back.
- After a message sent into a running turn, the agent's answer can seem to be missing.
- A new feature's chat sits empty until the human types something like "Hi".
- Agents settle things without asking, so the human learns about choices only after they are made.

## Approach

### 1. Ghost subagent cards

Stored logs show the cause: when the agent process is relaunched, the Claude adapter re-announces every past subagent as an untitled `subagent` event with status `completed`, just after the first turn starts. The turn's own subagent map has never seen those ids, so the fold makes a card for each.

`foldThread` keeps a thread-wide record of the subagent ids it has shown. For a `subagent` event whose id the current turn does not hold:

| The event | Result |
|---|---|
| Id shown in an earlier turn, says finished or says nothing | No card, no change on screen |
| Id shown in an earlier turn, says running | A card in this turn: it is real work |
| Id never shown, has a title or says running | A card, as today |
| Id never shown, no title, says finished | No card |

This is read-side, so old threads render right with no migration. The server keeps logging the re-announcements.

### 2. A steered message and late updates

`splitTurn` resets the turn's `calls` and `subagents` maps. A later update for a call or subagent from before the split therefore looks like a new step: it adds a segment after the agent's words, the words stop being the trailing text, and the fold shows them as narration under "Worked for…". A blank row appears too. Both cases were reproduced with the real fold.

The fix: a split starts a new work and answer pair but keeps those two maps for the whole turn. A late update lands on its original row, including a row in the part already settled before the split, and adds no segment. Its status there ends up correct at the turn's end. An untitled update for a call of an earlier turn (a background command finishing later) shows nothing, for the same reason.

### 3. The report on the missing answer

No code change beyond item 2. The ready message reports the finding in decision 3 and asks the human to reopen the thread from the screenshot once the fix is installed, since that thread's log is not on this machine.

### 4. Tool rows

The build runs real logged turns from this machine through the grouping (`groupCalls`, `groupText`, `callText`) and reads the result. Anything that reads wrong gets fixed. The only known defect is the blank row, which item 2 removes.

### 5. Pending attachments

A small browser-side store holds pending attachments per thread, keyed exactly as the draft text is (`threadId`, else `draftKey`, else `new`). It writes to IndexedDB and keeps a memory copy, so a chat switch restores at once and a reload restores shortly after. If IndexedDB is refused, the memory copy still covers chat switches.

`useThread` reads and writes through this store instead of its plain `useState`. Sending or removing an attachment deletes it. A failed send restores attachments to the key they were sent from, not to whichever thread is now on screen. Attachments never appear on another thread, because they are only ever read by their own key. Crops from the design pane arrive through `attach` as they do now.

### 6. A new feature's chat starts itself

The web starts the chat through the existing launch (`feature.launchSession`, with `holdOpening` off), so the briefing is the thread's first prompt and the agent speaks first. All of these must hold:

- the main chat column is in front and on screen, in a visible browser tab;
- the thread list has been read and shows no main chat;
- the feature is started, and neither shipped nor archived;
- the feature has no sessions of any kind, no tickets and no rounds;
- its brief is on disk, because a feature reads as active before its docs are written;
- the page is not launching this chat itself (a Start, or a self-planning run).

A guard keeps it to one start per page open. The server also runs a feature's launches one at a time, so two tabs cannot create two chats or race for the worktree. If the human presses Send while the start is in flight, Send waits on the same start and its message joins the opening turn. A refused start shows its message once and leaves the empty chat. The next open of the chat tries once more, and the first Send tries too.

Once the main chat has a thread, draft text and attachments saved under the unstarted key move to the thread's key, whenever its column next mounts or sees the id. That also covers a column that was gone as the thread started. A self-start leaves the human on a thread they picked meanwhile.

The comment in `FeatureChat` that says opening never launches anything gets updated. Side threads, project chats and the preparation chat do not change.

### 7. Skill text

Project skill:

- §1b: a short or confident request is not a settled one. No cut is proposed and no feature created until the human has answered at least one question here, unless they said in words to skip it. The working-agreement question does not count.
- §1b: "Recommend, don't interrogate" becomes a rule that every question carries a recommendation, and that the proposed cut comes after the grill.
- §1b: beside "you do not need to ask it", add that anything which would change what the human gets or how it behaves gets asked, or goes in the brief under **open** for the feature's grill.
- §2 destination 2: "too small to deserve a conversation" becomes too small for a design conversation, with the floor still applying.
- Orchestrating: when a feature will plan itself, these questions are the only ones the human gets before the plan.
- §0: "Proceed with your task" opens the skill and is no go-ahead to skip the grill.

Feature skill:

- "When the brief is already concrete, skip the grilling" is replaced by decision 8's rule, in `SKILL.md`. `references/grilling.md` gets the same sentence where it fits.
- The same note on the launch line.
- `references/planning-alone.md` does not change.

Skill text reaches live sessions only after a release and reinstall.

### Build

The lead builds this in one pass, in the order above, and runs one independent code review before declaring ready. Item 7 gets one real run of a one-line request through the edited project skill, reported in the ready message.

## Seams

- **`foldThread`** (existing): log in, view out. Covers items 1 and 2 directly with event sequences taken from the real logs: the relaunch burst, a late tool update after a steer, a late subagent update after a steer, and a subagent that runs again in a later turn.
- **`groupCalls` / `groupText`** (existing): covers item 4 with titles taken from real logs.
- **`useThread`** (existing): covers item 5, including switching, a reload, a failed send and the move at start, through the existing web tests' tier.
- **The attachment store** (new): one read, write and delete by key, with IndexedDB refused as one case.
- **`FeatureChat` with a stubbed `start`** (existing): covers the start conditions in item 6, each failing condition, one start only, and a refused start.
- **`launchSession`** (existing): two concurrent launches give one chat.
- **The skill files**: read directly, with no test.

## Out of scope

- Any redesign of the chat.
- Filtering the re-announcements on the server, or changing the adapter.
- A line saying the agent wrote no answer.
- Moving attachments between browsers.
- Rewording the launch line, or changing what self-planning runs do.
- Side threads, project chats and the preparation chat starting by themselves.
- "Agents hand work to a new thread", which is its own backlog feature.

## Open questions

- Whether the thread in the screenshot really had an answer. Only the human can check it, by reopening that thread after the fix is installed.
- This feature replaces part of chat-as-web-components decision 12 and leans on ADR-0015. Feature sessions cannot write ADRs, so if the orchestrator wants that recorded as an ADR, it is the orchestrator's to write.
