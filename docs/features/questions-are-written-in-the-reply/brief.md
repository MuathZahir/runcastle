## Purpose

The human's note: "The agent keeps using a tool to ask a question and assumes I saw it.. The full question should be in the text." A screenshot of the problem is at .runcastle-attachments/pnote__1ns1W66xFzE.png in your workspace — Read it before starting.

What happened (thread `sess_1x3Tkx2sJnCX`, an orchestrator on a new project): the agent wrote its questions only in its private thinking, put a short version only in `wait_for_you`'s `why` ("OK to commit your docs and prototype to main, and what to build first?"), and its only visible text was "I've asked you two things above". The human saw no question.

Cause: the guidance invites it. The orchestrator skill's rule 3 says to ask and then "call `wait_for_you({ why })`" without saying the question must be in the reply; the lead's skill (rule 3 and the references that call `wait_for_you`: planning-alone.md, design.md, decisions-and-spec.md) reads the same way; and the tool's description is "One short line: what you need from the human."

## Decided with the human

- **What:** every question an agent puts to the human is written out in full, with its recommendation, in the reply text the human reads.
- **Keep `wait_for_you`'s `why`.** The human asked whether it is needed; it stays, as the short label the sidebar, the feature status line, the phone and browser notifications, and autopilot handbacks show. It is a label, never the question.
- **Where / who:** every runcastle agent that can call `wait_for_you` (orchestrator, feature leads, workers), for the human.
- The fix is wording, not machinery: sharpen the existing rules and the tool's description (main MCP server and the worker MCP script), per the charter's "rules, not procedures".
- Planned automatically.

## Understood

The chat no longer folds text written before a turn's last tool call; it folds only tool calls. So the question is simply missing, not hidden.

## Must not swallow

Removing or renaming `why`, changing how needs-you is shown, or the question-box widget (AskUserQuestion). The "ready to test" check in `services/lead-handback.ts` reads the start of `why`; leave that working.

## Open

Exact wording, kept short; check no other skill text tells an agent the flag carries the question.

## Ordering

Nothing before it; nothing waits on it.

Planning mode: automatic
