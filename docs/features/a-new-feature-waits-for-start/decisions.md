# Decisions — A new feature waits for Start

Planned without the human in a self-planning run (2026-11-09); an independent challenger raised decision 11 and questioned 3 and 9. The human confirmed the plan, including decisions 3 and 9 as written, and approved the designed screen with Start in the middle and the composer locked (6 and 7), on 2026-11-09.

## 1. Opening a never-run started feature launches nothing
**Decision:** When a started feature that has never run is opened, nothing starts. Its empty main chat shows a **Start** button, and pressing it does what opening does today: the normal launch, so the agent reads its brief, explores and speaks first. This supersedes `triage-batch-chat-bugs-attachments-and-sessions-that-start-by-themselves` decision 6 ("A new feature's chat starts itself the first time it is opened"), and the parts of its decisions 10, 11 and 12 that only served that start.
**Why:** Clicking a feature just to look at it spent tokens and set an agent going the human did not ask for. The human chose the alternative decision 6 recorded and passed on.

## 2. Start is the only way in; no typing first
**Decision:** The composer cannot send until the agent has been started. Today's path where a first typed message starts the chat, with the briefing held ahead of it, is dropped for this case.
**Why:** The human's words: "The user doesn't want to initiate himself, the agent has to explore."

## 3. Plan it yourself sits beside Start
**Decision:** The empty chat offers "Plan it yourself" beside Start, doing what it does on a backlog draft: a self-planning run that plans the feature without the human. Pressing either one removes both.
**Why:** The brief says Plan it yourself "stays where it is today, beside it". In the code it is not offered on a started feature today: only a backlog draft's bar has it (a started feature's copy went with the per-phase next-step bars on 2026-10-24). Bringing it back beside Start is the closest reading of the human's intent, and the web already knows how to launch it for a started feature.

## 4. A backlog draft's Start is untouched
**Decision:** Starting a backlog draft from its page still cuts the branch and launches the chat directly, landing on a running agent, never on a second Start button.
**Why:** The human counts that click as their start.

## 5. "Never run" keeps decision 14's meaning
**Decision:** Start shows only for a feature that is started, not shipped or archived, has its brief on disk, and has no sessions, tickets or runs (triage decision 14). A feature with any history but no main chat keeps today's empty chat, where typing starts it.
**Why:** From the brief's "Understood" section. Work that ran in an older session or through tickets must not get a fresh kickoff.

## 6. Start sits in the middle of the empty chat
**Decision:** Start is the empty chat's one primary button, in the middle where "New chat" sits today, under a short line saying what it does ("The agent reads the brief, looks through the code and speaks first."). Plan it yourself is a quiet button beside it. The phone shows the same, with touch-sized buttons.
**Why:** The middle of an empty chat is where the eye lands, and the app's empty states already carry their one action there (STYLE.md). The status row stays as it is, so nothing in the header moves.

## 7. The composer stays visible but locked until Start
**Decision:** Until the agent is started, the composer shows with its text box locked and its placeholder saying why ("Start the agent first — it opens the conversation"). Send is off. The model and effort pickers under it still work, so the human can choose them before pressing Start.
**Why:** Hiding the composer would also hide the model picker, which today already works before the first message and is the one choice worth making before an agent starts spending. A locked box also tells the human where they will type.

## 8. A refused start says why and waits for another press
**Decision:** If Start is refused (the agent runtime is not ready, say), the reason shows under the button and Start stays pressable. Nothing retries by itself, on opening or otherwise. This supersedes triage decision 11's retry on each open.
**Why:** With nothing starting by itself there is nothing to retry; the human presses again when they have fixed the cause. A line beside the button stays in view, unlike today's toast, which vanishes.

## 9. The feature's status line is unchanged
**Decision:** A never-run feature's header and sidebar status stay what they are today. No new "Not started" status.
**Why:** The brief rules out redesign beyond placing Start, and the status line is shared by every feature state.

## 10. A model picked before Start is the one the agent starts on
**Decision:** The model, effort and fast mode picked in the locked composer before Start go with the launch, so the agent's first turn already runs on them. The same holds for Plan it yourself. This needs one small server change: the feature's launch accepts the pick.
**Why:** Today a pick made before the first message is carried only by that message, and the launch itself always resolves the model from Settings. With Start there is no first message, so without this the picker decision 7 keeps visible would mislead.

## 11. A backlog Start whose launch is refused lands on Start
**Decision:** If a backlog draft's Start cuts the branch but its launch is refused, the feature is now started and never run, so it opens on the waiting screen with the refusal under Start, ready for another press. This is the one case where decision 4's "never a second Start" gives way.
**Why:** Raised by the challenger: the retry on every open that used to cover this is gone (decision 8), and the refusal must not be lost.
