# Decisions — Every word the agent writes stays in view

Planned without the human (a self-planning run, 2026-11-08). Decisions marked
**Assumed.** are the planner's own pick; the human confirms or changes them.

Check first: 2, 3, 4, 10, 12

## 1. Every word the agent writes shows, in the order written
**Decision:** A turn reads top to bottom as it happened: each stretch of the agent's words is its own message at full prose, and each run of tool calls, thinking and subagents between two stretches folds to its own "Worked for …" line. A turn can show several folds. Nothing the agent writes goes inside a fold any more: folds hold only tools, thinking and subagents.
**Why:** Decided in triage (brief). Today only the words after a turn's last real tool call show; everything before is grey narration inside one fold, so replies read as cut off. The human chose this over keeping one fold and promoting "real" paragraphs out of it, because any rule that tells a paragraph from a progress line would misfire.

## 2. Words never move once shown: a run of work folds the moment words follow it
**Decision:** While a turn runs, the newest run of work shows open, step by step, as today. As soon as the agent writes words after it, that run folds to its "Worked for …" line and the words stream below it. Earlier runs stay folded. A settled turn is exactly what the live turn last looked like, so nothing jumps when the turn ends.
**Why:** Today words stream in as the answer and then jump into the fold when a tool call follows them. With every word staying in place that jump is gone, and folding each run as words follow keeps a long live turn short to read.
**Assumed.** Alternative: keep every run of the live turn open until the turn ends, then fold them all at once.

## 3. Each fold says its own time, and the turn says its total once
**Decision:** Each fold's line reads "Worked for <its own time>": from its first step to the words that follow it (or to the turn's end, for a run that ends the turn). The turn's whole time also shows once, quietly, beside the model name in the hover line of the turn's last words ("Opus 5.5 · 3m 12s").
**Why:** With several folds in one turn, a single total on one of them says nothing about the others; and a long turn should still say how long it ran without adding a line to every turn.
**Assumed.** Alternative: only each fold's own time, and no total anywhere.
**Challenged:** Also show the turn's total time once, beside the model name on its last words: adding up several folds in your head is no answer to "how long did this turn take".
**Changed by the orchestrator:** add the turn's total somewhere unobtrusive, as the challenger suggested, so a long turn still says how long it ran. The human has not seen this.

## 4. Words between work read as normal prose
**Decision:** Every stretch of the agent's words reads in the same full prose style, whether more work follows it or not. Short progress lines ("Fixes in; running the full test suite.") look like any other paragraph.
**Why:** A lighter style for "progress" needs a rule that picks which words are progress, the rule the human rejected. Styling by position (lighter when work follows) would grey out exactly the questions and paragraphs this feature exists to bring back.
**Assumed.** Alternative: words that more work follows read lighter (the secondary grey), and only a turn's last words read at full strength.
**Changed by the orchestrator:** kept as written and the lighter option dropped from the design page's Tweaks: greying mid-turn words brings back the feeling that they are second-class. The human has not seen this.

## 5. Files, cards and answered asks sit where they happened
**Decision:** A file the agent shows, a card it posts (the plan, designs, a review package, the features card) and the line for an ask the human answered all sit in the turn at the point they happened: the words written before them above, the words after below.
**Why:** Today they are moved to just after the turn's one fold, which only made sense while there was one fold. In order is the rule everything else in a turn now follows.
**Assumed.** Alternative: keep today's place, after all of the turn's work and ahead of its last words.

## 6. The changed-files card stays at the turn's end
**Decision:** The card listing the files a turn changed ("2 changed files +29 −12") stays where it is today: once, at the end of the turn, under its last words (or under its last fold when the turn ends on work).
**Why:** It sums up the whole turn, not one paragraph of it, and the turn reports its changed files only when it ends.
**Assumed.** Alternative: a card under each stretch of words, for the edits made just before it.

## 7. Every chat reads the new way, old ones included
**Decision:** The new layout applies to every chat runcastle shows (feature leads, workers, project and orchestrator chats) and to past chats as much as new ones, with no migration: chats are re-read from their stored record each time they open.
**Why:** The layout is worked out from each chat's stored log when it is shown, so old chats get it for free, and the human's complaint is about reading chats, old ones included.
**Assumed.** Alternative: only turns that start after the change use the new layout.

## 8. Questions stay where they were asked
**Decision:** The rule that pulls a question ending in "?" out of the fold and shows it after the work retires: a question is words like any other, shown where it was written.
**Why:** It existed only because words were hidden in the fold. With every word in place, moving questions would put them out of order.
**Assumed.** Alternative: none worth keeping; the rule has no job left.

## 9. A run that is only thinking reads "Thought for …"
**Decision:** When the only thing between two stretches of words is the agent's thinking, its fold reads "Thought for 4s" and opens straight to the thinking, not "Worked for 4s" opening to a second "Thought for 4s" line.
**Why:** With folds between paragraphs, thinking-only gaps will be common, and a fold inside a fold for one thought is noise.
**Assumed.** Alternative: every run reads "Worked for …", whatever it holds.

## 10. Copy on every message takes the whole turn from its last words; branching sits on the last words only
**Decision:** Each stretch of words keeps its own hover actions. Copy on an earlier stretch copies that stretch; Copy on the turn's last words copies all of the turn's words, in order. "Branch into a new chat from here" and the model name show only on the turn's last words.
**Why:** A reply is now often split across several stretches, and copying it whole should take one click. A branch always carries the whole turn it was taken from, so offering it on a paragraph halfway through promises a cut that does not happen.
**Assumed.** Alternative: Copy on the last words copies only that stretch.
**Challenged:** Copy on the turn's last words should copy all of the turn's words, since a reply is now often split across several stretches; earlier stretches copy only themselves.
**Changed by the orchestrator:** Copy on the last words copies the whole turn's words, as the challenger said. The human has not seen this.

## 11. A fold's line says only its time
**Decision:** A fold reads "Worked for 12s", as today, with nothing more on its line.
**Why:** It keeps the turn quiet between paragraphs, which matters now that a turn can have several folds. What the run did is one click away.
**Assumed.** Alternative: the line also says what the run did, "Read 3 files, ran 2 commands · 12s". The design page carries a Tweak that switches between the two.

## 12. Short stretches are never merged
**Decision:** An agent that writes one line before nearly every tool call gets a ladder: line, fold, line, fold. Stretches are not merged and runs are not joined across words, however short.
**Why:** Any merge needs a rule that tells a throwaway line from a real one, which is the rule the human rejected (decision 1). The ladder is what the agent wrote; the design page shows it so it can be judged before building.
**Assumed.** Alternative: fold a run of one-line stretches, and the work between them, into a single fold.

## 13. An answered ask's line follows the run of work it was asked in
**Decision:** Refines 5. The line for an ask the human answered (an approved command, an answered question) sits right after the run of work it was asked in, not in the middle of it. The run stays one fold, and it stays open while it is the newest thing in a running turn, so an approved command keeps running in view.
**Why:** Found while building: placing the line exactly where it was answered split the run, and folded the approved command above its own "Allowed" line while it was still running, hiding its spinner.
**Assumed.** Alternative: the line exactly where it was answered, splitting the run into one fold per approval.
