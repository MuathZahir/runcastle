# Questions are written in the reply

## Problem

An agent that needs the human sometimes asks only through the needs-you call
(`wait_for_you`): its question sits in its private thinking and in the call's
short `why`, and its visible reply says "I've asked you two things above". The
human sees a needs-you mark and no question. The guidance invites this: the
lead's and orchestrator's rule 3 say "call `wait_for_you({ why })` with it",
and the tool's own description calls `why` "what you need from the human".

## Approach

From the human's side: whenever an agent needs them, the full question, with
its context and recommendation, is in the chat as the agent's reply. The
sidebar, status line, phone and browser notifications keep showing a few-word
label.

The one rule carried everywhere, in each place's own voice:

> Write the question in full, with your recommendation, in your reply; the
> human reads that. Then call `wait_for_you` with a few-word label (`why`) for
> the sidebar and phone. The label is never the question.

Where it goes:

- **The tool's description**, in the main tool server and the workers' tool
  script: the tool flags the human (sidebar mark, phone ping); the question
  belongs in the reply written before the call; `why` is a few-word label.
  The main server's version also says that on autopilot this line is all the
  epic receives, so a lead asks there with `hand_back({ summary })` (decision 5).
  The `why` parameter's description says the same in one line.
- **The lead's skill:** rule 3 ("…as the last thing you write, and call
  `wait_for_you({ why })` with it") becomes: the question is the last thing in
  your reply, then `wait_for_you` with a short label for it. The references
  that call it (planning alone, design, decisions and spec) get the same reading
  where they could be read as "the call carries the question".
- **The orchestrator's skill:** rule 3's closing sentence says the same.
- **The worker's assignment prompt:** the tool list line, the "with you" and
  "started without an assignment" hand-back lines and the failed-fix line say
  the question goes in the chat, then the call with a label.
- **Runcastle's own lines that point an agent at `wait_for_you`:** the
  headless "No human is present" rule in every session's system prompt, the
  git guard's footer, the autopilot-off notice, the refused-handback message
  and the merge-conflict message. Each becomes "ask the human in your reply,
  then call `wait_for_you`".

Wording stays short: each place gains at most a sentence. No behaviour, schema
or screen changes. The ready-to-test detection, which reads the start of a
wait's `why` set by `declare_ready`, is untouched.

## Seams

- **Launch artifacts (existing):** the generated system prompt holds the new
  headless rule. The existing test that pins the old sentence is updated.
- **Tool listing (existing):** listing the main server's tools and the worker
  script's tools shows the new `wait_for_you` description and `why` text.
- **Skill text (existing):** a search of the skill pack and server sources finds
  no sentence that tells an agent the call or its `why` carries the question.

## Out of scope

- Removing or renaming `why`, or changing how needs-you is shown anywhere.
- The question-box widget (AskUserQuestion).
- A length limit on `why` (decision 6).
- Sending the agent's reply text to the epic on autopilot (decision 5's
  alternative).
- A worker's needs-you on autopilot reaches the epic as its label only, and a
  worker cannot hand back to the epic. Noted as a nearby problem, not fixed
  here.
- The file-showing tool's description still says words before a tool call fold
  away and to put questions after it; the chat no longer folds text. Noted as a
  nearby problem.

## Open questions

None.
