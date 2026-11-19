# Decisions — Questions are written in the reply

Planned with nobody present: decisions marked **Assumed.** are the lead's picks.

Check first: 5, 6

## 1. Every question is written out in the reply
**Decision:** Every question an agent puts to the human is written out in full, with its recommendation, in the reply text the human reads.
**Why:** The human saw no question when an agent put it only in its thinking and the needs-you line ("I've asked you two things above").

## 2. The needs-you line stays, as a short label
**Decision:** `wait_for_you`'s `why` stays. It is the short label the sidebar, the feature status line, the phone and browser notifications and autopilot handbacks show. It is a label, never the question.
**Why:** The human asked whether it is needed; those places need a few words, not a full question.

## 3. Every agent that can flag the human
**Decision:** The rule reaches every runcastle agent that can call `wait_for_you`: the orchestrator, feature leads and workers. The reader is the human.
**Why:** All three can ask the human, and all three read the same tool description.

## 4. Wording, not machinery
**Decision:** The fix sharpens the existing rules and the tool's description (the main tool server and the workers' tool script). Nothing new checks or rewrites what agents send.
**Why:** The charter's "rules, not procedures"; the guidance invited the mistake, so the guidance is what changes.

## 5. On autopilot, a lead asks its epic through its handback
**Decision:** On autopilot a needs-you line reaches the epic as the whole message, so a short label would arrive there alone. The tool's description says so, and tells the agent to put the full question in its handback summary instead (`hand_back`), as the lead's skill already asks.
**Why:** The epic never reads the lead's chat, so the question has to travel in what is sent to it. This keeps the label short everywhere without new machinery.
**Assumed.** Alternative: runcastle sends the agent's latest reply to the epic along with the label (a small change to how autopilot hands back).

## 6. No length limit on the label
**Decision:** The label is asked for in words ("a few words"). Runcastle does not refuse a long `why`.
**Why:** A limit would only refuse calls after the fact; the description now says plainly where the question goes. A refused call could also lose the needs-you flag at the moment the human is needed.
**Assumed.** Alternative: refuse a `why` over about 100 characters, with an error that says to write the question in the reply.
