# Every word the agent writes stays in view

## Problem

In runcastle's chat, an agent's reply often looks cut off: only its last
paragraph shows, and that paragraph can refer to a question the human never
saw ("I'm waiting on your answer. Do you agree…"). The rest of what the agent
wrote is there, but folded inside the turn's one "Worked for …" line as grey
narration, mixed with tool calls and thinking. The human has to open the fold
to read the agent's own words, and usually does not know to. Agents have taken
to cramming the whole reply after their last tool call to dodge this, which is
fragile.

## Approach

**What the human sees.** A turn reads top to bottom in the order it happened.
Each stretch of the agent's words is its own message in full prose. Each run of
tool calls, thinking and subagents between two stretches folds to its own line
with its own time ("Worked for 46s"); a run that is only thinking reads
"Thought for 5s" and opens straight to the thought (decisions 1, 3, 9, 11).
Nothing the agent writes is ever inside a fold. Shown files, posted cards (the
plan, designs, a review package, the features card) and answered-ask lines sit
where they happened (decision 5). The changed-files card stays once at the end
of the turn (decision 6). Every stretch has Copy; Copy on the turn's last
words copies all of the turn's words. Only the turn's last words carry "Branch
into a new chat from here" and the model name, with the turn's total time
beside it ("Opus 5.5 · 3m 12s") (decisions 3, 10).
Short stretches are never merged (decision 12).

While a turn runs, the newest run of work shows open, step by step, as today.
The moment the agent writes words after it, that run folds and the words stream
below it (decision 2). Words never move once shown: today's jump, where
streaming words become narration when a tool call follows them, is gone, and a
settled turn looks exactly like the live turn did last.

This applies to every chat (feature leads, workers, project and orchestrator
chats) and to past chats too, because a chat is re-folded from its stored log
each time it is read (decision 7). The same goes for the two places a chat is
turned into text, both built on the same fold: the chat's Copy / Save as
Markdown (`thread.export`) and the preface an agent reads when a chat is
branched into a new one. They now carry every word as well. The orchestrator's
`read_feature_chat` and the main-chat quote in a kickoff do not read the fold:
they read the runtime's own transcript, which already keeps every text block
of a turn in order, so they are unchanged and already whole.

**The shape of it.** The whole behaviour lives in core's thread fold
(`foldThread` in `packages/core/src/thread.ts`), which server and web share. Its
per-turn `render` stops splitting a turn at its last real tool call. Instead it
walks the turn's segments in order and emits:

- one `agent` item per stretch of words: consecutive text segments, joined as
  today, including across talk-only calls (`wait_for_you`, `declare_ready`,
  `notify_human`, `show_file`), which still show nothing;
- one `work` item per run of non-text segments (tools, thinking, subagents)
  between two stretches, with its own `seconds`, and `live` only while it is
  the turn's last item and the turn is running;
- cards and shown files at their place in that sequence, rather than at a
  single `shownIndex` slot after the turn's one work item; consecutive files,
  designs or feature actions with no words between them group into one item,
  which moves down past the work done since it was posted (never past words);
- answered-ask lines right after the run they were asked in, so the run stays
  one fold and stays live while an approved command runs (decision 13).

`show_design`, `show_plan` and `show_review_package` join the talk-only tools:
the card each posts is what shows, not a row in a fold.

The `asked` item (questions pulled out of the fold) retires, and so does the
`narration` work step: a `WorkStep` is only `tools`, `thought` or `subagent`
(decision 8). The open turn's single `workIndex` / `askedIndex` / `answerIndex`
slots become a list of the turn's items, re-rendered in place as segments
arrive. Item ids must stay stable as a turn streams (a stretch keeps its first
text segment's id; a run keeps its first segment's id, prefixed `work:`), so
React keeps each block mounted and a fold the human opened stays open.

A run's time is measured from when its first segment arrived to when the words
after it began (or the turn ended). Segments therefore record the time they
arrived; thinking already does.

Mid-turn splits stay as they are: a steered message or a hidden command settles
what came before it and starts a fresh sequence after it. The turn's
`changes` item is still pushed once at `turn_ended`.

**Web.** `WorkBlock` (in `Work.tsx`) folds one run, and renders a
thinking-only run as one `Thought` fold. `ChatThread` passes each agent message
whether it is its turn's last words (no later `agent` item before the next
`user` item), and `AgentMessage` shows Branch, the model and the turn's total
time only then; its Copy there takes every `agent` item of the turn, joined by
a blank line. The turn's total comes from the fold: on `turn_ended` the turn's
last `agent` item gets the turn's seconds. The
designed screens below show all three states; their look is in the design
page, not repeated here.

**Designed screens** (design page `apps/web/preview/turn-words.html`, sample
data in `turn-words-data.ts`):

- *A finished turn, every word in view* — `?state=settled`
- *The same turn while it runs* — `?state=live`
- *A chatty turn: a line before every tool call* — `?state=ladder`

The human approved all three designs as they are.

**Scenario.** Ship `.runcastle/scenarios/chat/words-between-work.ts`: it seeds a
project chat in the driven instance whose log holds a finished multi-stretch
turn (words, tools, words, a shown file, words) and a ladder turn, and prints
the chat's URL as `ENTRY_URL`. It is the review's starting point and the
scenario declared ready, since a real agent's turn is not reproducible.

## Seams

- **`foldThread(log) → ThreadView`** (existing, core): the one seam that
  matters. Feed it event logs and assert the items: words around a tool call
  are two `agent` items with a `work` between them; a question mid-turn stays
  in place; a card or shown file sits between the words written before and
  after it; a live run folds (loses `live`) the moment text follows it; item
  ids stay stable across streamed updates; talk-only calls do not split words;
  a steered message still splits the turn; `changes` stays last. The existing
  tests in `packages/core/test/thread.test.ts` that pin the old split
  (answer after the last tool, the asked item, narration steps, card placement
  ahead of the final words) are rewritten to the new rule.
- **`threadMarkdown(view)`** (existing, server): a chat's Markdown copy and a
  branch's preface now hold every stretch of words; one test pins it.
- **`ChatThread` / `WorkBlock`** (existing, web): component tests for Branch
  and the model showing only on a turn's last words, and a thinking-only run
  rendering as one "Thought for …" fold.

## Out of scope

- How agents are prompted. Once this ships, the "write the whole answer after
  your last tool call" workaround (it lives in the human's own memory notes, not
  in this repo) can be dropped; that is follow-up, not this feature.
- How thinking is shown, beyond folding with the tools.
- Promoting thinking into the answer: a turn whose reply existed only in the
  agent's thinking still shows only what it wrote.
- The rest of the chat: composer, ask dock, cards' own look, shown files' look,
  the changed-files card's look.
- The thread state logic (`threadActivity`, "waiting on you") and its
  question-mark rule, which read the raw log, not the fold.

## Open questions

- Decisions 3 and 10 (the turn's total time beside the model; Copy on the last
  words takes the whole turn) were settled by the orchestrator; the human has
  not spoken to them directly.
