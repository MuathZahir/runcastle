# Decisions — A new feature waits for Start

Planned without the human (a self-planning run, 2026-11-09). Decisions 1, 2, 4 and 5 come from the brief, settled with the human in the orchestrator chat. Decision 3 reads the brief's "Plan it yourself stays" against what the code actually offers, and it and the rest are the planner's, each marked **Assumed.** An independent challenger read the brief and these decisions; its disagreements are the **Challenged:** lines, and decision 11 came from it.

Check first: 3, 6, 7, 9, 10

## 1. Opening a never-run started feature launches nothing
**Decision:** When a started feature that has never run is opened, nothing starts. Its empty main chat shows a **Start** button, and pressing it does what opening does today: the normal launch, so the agent reads its brief, explores and speaks first. This supersedes `triage-batch-chat-bugs-attachments-and-sessions-that-start-by-themselves` decision 6 ("A new feature's chat starts itself the first time it is opened"), and the parts of its decisions 10, 11 and 12 that only served that start.
**Why:** Clicking a feature just to look at it spent tokens and set an agent going the human did not ask for. The human chose the alternative decision 6 recorded and passed on.

## 2. Start is the only way in; no typing first
**Decision:** The composer cannot send until the agent has been started. Today's path where a first typed message starts the chat, with the briefing held ahead of it, is dropped for this case.
**Why:** The human's words: "The user doesn't want to initiate himself, the agent has to explore."

## 3. Plan it yourself sits beside Start
**Decision:** The empty chat offers "Plan it yourself" beside Start, doing what it does on a backlog draft: a self-planning run that plans the feature without the human. Pressing either one removes both.
**Why:** The brief says Plan it yourself "stays where it is today, beside it". In the code it is not offered on a started feature today: only a backlog draft's bar has it (a started feature's copy went with the per-phase next-step bars on 2026-10-24). Bringing it back beside Start is the closest reading of the human's intent, and the web already knows how to launch it for a started feature.
**Assumed.** Alternative: read "unchanged" literally and offer only Start on a started feature, leaving self-planning to the orchestrator's plan_feature.
**Challenged:** The brief says Plan it yourself stays "unchanged", and it is not on started features today; adding it puts a new button on the human's screen they never asked for. Ask the human, since the brief's author probably misremembered where the button lives.
**For the human.** A never-run feature's chat shows two buttons, Start and Plan it yourself.

## 4. A backlog draft's Start is untouched
**Decision:** Starting a backlog draft from its page still cuts the branch and launches the chat directly, landing on a running agent, never on a second Start button.
**Why:** The human counts that click as their start.

## 5. "Never run" keeps decision 14's meaning
**Decision:** Start shows only for a feature that is started, not shipped or archived, has its brief on disk, and has no sessions, tickets or runs (triage decision 14). A feature with any history but no main chat keeps today's empty chat, where typing starts it.
**Why:** From the brief's "Understood" section. Work that ran in an older session or through tickets must not get a fresh kickoff.

## 6. Start sits in the middle of the empty chat
**Decision:** Start is the empty chat's one primary button, in the middle where "New chat" sits today, under a short line saying what it does ("The agent reads the brief, looks through the code and speaks first."). Plan it yourself is a quiet button beside it. The phone shows the same, with touch-sized buttons.
**Why:** The middle of an empty chat is where the eye lands, and the app's empty states already carry their one action there (STYLE.md). The status row stays as it is, so nothing in the header moves.
**Assumed.** Alternative: Start in the composer's place at the foot of the chat, where a phone's thumb already is. The design page has a Tweak to compare the two.
**For the human.** Where the button is.

## 7. The composer stays visible but locked until Start
**Decision:** Until the agent is started, the composer shows with its text box locked and its placeholder saying why ("Start the agent first — it opens the conversation"). Send is off. The model and effort pickers under it still work, so the human can choose them before pressing Start.
**Why:** Hiding the composer would also hide the model picker, which today already works before the first message and is the one choice worth making before an agent starts spending. A locked box also tells the human where they will type.
**Assumed.** Alternative: hide the composer until Start, for a quieter screen, losing the pre-start model choice. The design page has a Tweak to compare.
**For the human.** What the foot of a never-run chat looks like.

## 8. A refused start says why and waits for another press
**Decision:** If Start is refused (the agent runtime is not ready, say), the reason shows under the button and Start stays pressable. Nothing retries by itself, on opening or otherwise. This supersedes triage decision 11's retry on each open.
**Why:** With nothing starting by itself there is nothing to retry; the human presses again when they have fixed the cause. A line beside the button stays in view, unlike today's toast, which vanishes.
**Assumed.** Alternative: keep today's toast only.
**For the human.** Where a refusal shows.

## 9. The feature's status line is unchanged
**Decision:** A never-run feature's header and sidebar status stay what they are today. No new "Not started" status.
**Why:** The brief rules out redesign beyond placing Start, and the status line is shared by every feature state.
**Assumed.** Alternative: a "Not started" status, so a feature waiting for Start reads differently in the sidebar from one whose agent is idle.
**Challenged:** Before this feature a never-run feature was never stuck, because opening it started it. Now it can sit unstarted and read the same as an idle agent in the sidebar, hiding work nobody is doing; a small "Not started" status is a label, not a redesign.
**For the human.** What a never-run feature reads in the header and sidebar.

## 10. A model picked before Start is the one the agent starts on
**Decision:** The model, effort and fast mode picked in the locked composer before Start go with the launch, so the agent's first turn already runs on them. The same holds for Plan it yourself. This needs one small server change: the feature's launch accepts the pick.
**Why:** Today a pick made before the first message is carried only by that message, and the launch itself always resolves the model from Settings. With Start there is no first message, so without this the picker decision 7 keeps visible would mislead.
**Assumed.** Alternative: hide the pickers until Start, and leave the server untouched.
**For the human.** The agent starts on what they picked.

## 11. A backlog Start whose launch is refused lands on Start
**Decision:** If a backlog draft's Start cuts the branch but its launch is refused, the feature is now started and never run, so it opens on the waiting screen with the refusal under Start, ready for another press. This is the one case where decision 4's "never a second Start" gives way.
**Why:** Raised by the challenger: the retry on every open that used to cover this is gone (decision 8), and the refusal must not be lost.
**Assumed.** Alternative: undo the branch cut and return the feature to the backlog.
**For the human.** What a failed backlog Start leaves on screen.
