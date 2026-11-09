# A new feature waits for Start

## Problem

Opening a started feature whose lead has never run launches the lead at once: it reads its brief, explores and speaks first. The human often clicks a feature only to look at it. Each such click spends tokens and sets an agent going nobody asked for. There is also no way to pick the model before that first launch, because the launch has already happened by the time the chat is on screen.

## Approach

**What the human sees.** A never-run started feature (decision 5) opens on an empty main chat that waits. In its middle sits a **Start** button, the view's one primary, under a short line saying what Start does, with a quiet **Plan it yourself** beside it (decisions 3 and 6). The composer at the foot is visible but locked: its text box takes no input and says why, Send is off, and the model and effort pickers still work (decision 7). Pressing Start launches the lead exactly as opening did before this feature: the normal launch, the briefing sent as the opening, the agent speaking first. Pressing Plan it yourself launches the self-planning run, as on a backlog draft. Pressing either shows it busy, disables both, and removes both once the chat has its thread. A refused launch shows its reason as a line under the buttons, and Start stays pressable; nothing retries by itself (decision 8). Header and sidebar status are unchanged (decision 9).

**What does not change.** A backlog draft's Start still cuts the branch and launches the chat in one click (decision 4), landing on a running agent: the waiting screen must never flash while that launch is in flight. Features with history but no main chat keep today's empty chat, where the first typed message starts the chat with the briefing held ahead of it. Side threads, project chats, worker chats and the preparation chat are untouched. The orchestrator's `plan_feature` and `send_to_feature`, and the lazy lead open when a message is delivered to a lead, launch on the server and never relied on the open-to-start effect.

**Shape.**
- *The feature chat* (`FeatureChat`) loses its open-to-start effect and the "once per open" retry. The test it used (`startsItself`: active, no sessions, tickets or runs, brief on disk) now decides whether the main chat shows the waiting screen instead of the plain empty chat. The waiting screen shows only once the thread list has been read and shows no main chat, and never while the page is itself launching the chat (the existing `holdStart`: a draft's Start, a self-plan launch, a landing). A Start press goes through the same single in-flight start the effect used (one shared promise, so two presses or a press during a draft launch make one launch), with the opening sent at once (no held opening), then hands the thread to the column as the effect did.
- *The waiting screen* is a new component (`StartAgent`) given to the thread column through its existing `empty` slot. Its props: start, plan it yourself, which of the two is in flight, and a refusal message.
- *The composer* gains a `locked` state (additive): text box read-only with a placeholder, Send off, attachments and the slash and mention menus off; the footer's model controls keep working. The thread column passes it through. The pickers already read and hold a choice for an unstarted chat through the column's `startsAs`, but only a first Send carries it today; Start and Plan it yourself pass it to the launch (decision 10).
- *Plan it yourself* reaches the chat as a callback from the workspace, reusing its existing self-plan launch for a started feature (`feature.launchSession` with `purpose: 'self-plan'`).
- *A saved draft* under the unstarted chat's key (left from before this ships) still moves to the thread when Start gives it one, through the existing draft move; nothing new can be typed into a locked composer, so no new draft is made.
- *A refused backlog Start* (branch cut, launch refused) passes its refusal to the chat, which shows the waiting screen with it (decision 11), instead of only a toast.
- *Two screens.* A Start pressed on one device reaches every other open view through the live stream's thread-list refresh, which swaps the waiting screen for the running chat. A press racing it on a second device must not make a second main chat: the launch reopens a conversation already under way, and the build checks that this holds for two launches close together.
- *The server* changes in one place: the feature's launch (`feature.launchSession`) accepts an optional model, effort and fast mode and starts the new chat on them, falling back to Settings as today. The held-opening path stays: project chats, side threads and history-but-no-chat features still start on a first message.
- *Design.* The screen is designed on the design page `apps/web/preview/waits-for-start.html` (states: waiting, starting, refused, started), with `StartAgent` and the composer's `locked` state as its real components. Wiring follows the approved design and does not restyle it.

## Seams

- **The feature chat column, rendered with a feature snapshot** (existing; the web's feature-chat start tests mount it with a faked launch). Observe: a never-run feature renders Start and Plan it yourself, launches nothing on mount, re-renders, tab-visibility changes or a re-read thread list; Start launches once with no held opening; a refusal shows its reason and leaves Start enabled; `holdStart` hides the waiting screen; a feature with history keeps the plain empty chat and its typed-first start.
- **The composer** (existing; component tests). Observe: `locked` takes no input, Send stays off, model controls still fire.
- **The feature launch** (existing tRPC procedure; server tests). Observe: a model, effort and fast mode passed in land on the new session row and its launch event; none passed resolves from Settings as before; two launches close together leave one main chat.
- **The design page** (new). Observe each state by `?state=`.

## Out of scope

- Any change to side threads, project chats, worker chats or the preparation chat.
- Any change to the backlog draft page, its Start or its Plan it yourself.
- Any redesign of the empty chat beyond placing Start and Plan it yourself, and of the header or sidebar status.
- Any server change beyond the launch taking a model pick.

## Open questions

- Decisions 3 and 6–11 were made without the human and wait for their check. The human approved the design with Start in the middle and the composer locked; its Tweaks (foot placement, hidden composer) were removed on approval.
