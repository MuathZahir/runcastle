# Decisions — A restart resumes planning runs

Planned with nobody present: every decision marked **Assumed.** is the lead's pick, waiting for the human.

Check first: 3, 2

## 1. A planning run a restart cut off is woken once to carry on
**Decision:** After a server restart, a "plan automatically" run that was cut off mid-turn gets one runcastle message that wakes it, as a lead's chat already does. It finishes as before: with a plan for the human's yes, or a question.
**Why:** The human approved the bug "A server restart does not resume planning runs". The exclusion has no recorded reason: it came from the era when a planning run was a separate one-shot process, and today it is the feature's own chat, which can be resumed like any other.

## 2. The planning run's wake message names its uncommitted files
**Decision:** The message that wakes a cut-off planning run says a restart cut off its planning, and lists the files left uncommitted in the feature's folder (the first few, then "…"), so it carries on from them instead of starting over. Leads keep today's plain carry-on message.
**Why:** The audit suggests it: the run in the 36-hour session was cut off mid-write, and a half-written file is easy to miss on resume.
**Assumed.** Alternative: the same plain "carry on where you were" message leads get, with no file list.

## 3. The orchestrator is not told a planning run was cut off and resumed
**Decision:** Only the planning run hears of the restart. The orchestrator chat that started it learns of it the usual way: the run's plan (or question) reaches the human, or the epic on autopilot, when the run ends.
**Why:** The charter's rule is that events with no agent behind them, a restart among them, go only to the agent that owns the work, and an earlier decision gave planning runs to the lead. Telling the orchestrator would change that rule, which only the orchestrator's own session may do.
**Assumed.** Alternative: also send the epic one line naming the planning runs a restart cut off and resumed, as the audit suggests.
