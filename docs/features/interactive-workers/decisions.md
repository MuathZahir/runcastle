# Decisions — Interactive workers

Grilled with the human, 2026-11-06. The brief's "Understood" list is settled already and is not
repeated here.

## 1. Interactive workers run in a sandbox, as a trial
**Decision:** A worker runs inside a burn-image sandbox, the way the prototype built it
(`workers-prototype-an-agent-you-can-enter-inside-a-sandbox`, its decision 28): its own container,
its own bare copy of the feature branch, one published port, no way to reach runcastle or the host
repo. The human revisits this after using it.
**Why:** The human at checkpoint 1: "Let's try the sandbox. We can test it for now." The prototype
measured no speed reason to prefer the host; the sandbox lets a worker run with no permission
prompts safely.

## 2. The human's yes to the plan, or to an offer in chat, starts the workers
**Decision:** The workers the lead lists in its plan start when the human says yes to the plan; a
worker the lead offers later in chat starts on the human's yes in chat. There is no Start click
per worker. Each starts on its assignment at once, makes a first pass, and shows "needs you" when
its turn ends.
**Why:** A Start click per worker would approve the same thing twice. Starting a worker is cheap
(6–10 s plus an install) and an idle one stops its container, so the plan's yes is gate enough.

## 3. The sidebar's thread list becomes the worker list
**Decision:** The open feature's thread list in the sidebar is the worker list; the feature page
gets no second list. It orders by status, not start time: the lead's chat first, then workers that
need the human, then working ones, then a folded "Done (n)" for handed-back and landed workers. A
row moves only when its status changes. Each row shows the worker's label with its one-line purpose
beneath in a muted line. Features not open stay folded; their amber dot already lights when any
worker needs the human. The look gets a live design pass before it is built.
**Why:** The sidebar is already the one place threads are switched (`threads-in-the-sidebar`); a
second list on the feature page would be a second place to look. The human: "It might need better
UI."

## 4. The lead lands a handback with one tool, or sends it back, or drops it
**Decision:** A worker hands back with a short summary, which must include any direction the human
gave it directly. Runcastle adds the worker branch's commits and changed files and wakes the lead
once with that, never the transcript. The lead then either lands the worker's branch on the feature
branch with one tool, through the feature's landing queue like its own commits (the worker shows
"landed" and folds into Done; the lead resolves any conflict), or sends the work back with a
message (the worker returns to working), or drops the worker.
**Why:** The human's picture: "the worker hands the design back; the lead integrates". Nothing
lands unseen, and two workers' changes always have someone fitting them together.
