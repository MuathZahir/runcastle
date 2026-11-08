## Purpose

Born from notes triage (2026-11-08), two project notes on one theme. Agent replies in runcastle's chat come out cut off, often down to the last paragraph, and look as if they refer to a question that was never shown.

The cause is a deliberate rule in the thread fold (`foldThread` in `packages/core/src/thread.ts`, decided by the shipped `chat-as-web-components`, decisions.md "The chat column is built from the components approved…"). A turn's answer is only the words after its **last** real tool call. Everything before it, including full paragraphs written to the human, goes into the one "Worked for …" fold as grey narration. Questions ending in "?" are already pulled out of the fold, but nothing else is. Agents have been working around it by trying to write their whole reply after their last tool call (an orchestrator memory even says so). That workaround is fragile and should become unnecessary.

## What the human wants (decided in triage)

Every word the agent writes to the human stays visible, in the order written. Only tool calls and thinking fold, between the paragraphs. A turn may therefore show several small "Worked for" folds instead of one. The human chose this over keeping one fold and promoting only "real" paragraphs out of it: a rule that tells a paragraph from a progress line would misfire.

## Understood

- The split today is one line: the boundary is the last non-text, non-talk-only segment. Live and settled turns use the same split.
- Narration **is** already rendered inside the fold when it exists (`Work.tsx`, `Steps`).
- One of the two notes was not text being hidden. In session `sess_vfvc_YV1Q2h6` the turn after "Why do you speak so compactly sometimes??" wrote no chat text before its tool calls. The paragraph the human expected existed only in the agent's thinking, then the agent called `wait_for_you` and wrote one paragraph. Asked why, it wrongly claimed it had written the full answer. So this feature will not make that case show more. It fixes the cut-off replies, which are the common case. Do not try to promote thinking into the answer.
- Nothing in flight touches the chat fold.

## Must not swallow

- How thinking is shown, beyond it folding with the tools.
- Any change to how agents are prompted. (Once this lands, the "write the whole answer after the last tool call" guidance can be dropped, but that is follow-up.)
- The rest of the chat layout: composer, cards, asks, shown files, the changes card.

## Open, for this feature's own design

- How quiet short progress lines ("Fixes in; running the full test suite.") should look once visible: normal prose, or a lighter style. They must stay visible either way.
- Where a turn's changed-files card and shown files sit when the turn has several text blocks.
- How the live (still running) turn reads under the new split.
- Whether "Worked for" folds between paragraphs each show their own duration.

## Screenshots

- /home/muath/.runcastle/project-notes/pnote_zh-9Pmdthns-.png: the agent says "I'm waiting on your answer. Do you agree…", as if the question had been shown before.
- /home/muath/.runcastle/project-notes/pnote_mh7JFZ13Vavl.png: replies reduced to one paragraph each, with "Worked for 16s" opening on nothing but thinking and tools.

A screenshot of the problem is at .runcastle-attachments/pnote_zh-9Pmdthns-.png in your workspace — Read it before starting.
A screenshot of the problem is at .runcastle-attachments/pnote_mh7JFZ13Vavl.png in your workspace — Read it before starting.

## Working agreement

A check-in before merge. The project orchestrator carries this feature through planning and building on its own. When it is ready, the orchestrator shows the human its Review Package, with screenshots of real chats under the new layout, and merges only when the human says so.

## Ordering

Stands alone, with no dependencies and nothing waiting on it.
