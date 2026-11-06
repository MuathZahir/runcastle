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
