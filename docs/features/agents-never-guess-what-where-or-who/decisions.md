# Decisions — Agents never guess what, where or who

Planned by the lead alone (automatic planning, 2026-11-12). Decisions 1–6 are the human's, from the brief; the human confirmed the rest with their yes to the plan ("Start work", 2026-11-12).

## 1. Three things are never guessed
**Decision:** No agent guesses what the human gets, where it lives in the app, or who sees it. If the request does not say them, the agent asks before it creates, plans or designs anything. When in doubt, grill. Everything below that level (wording, layout details, edge cases) may still be guessed in a self-made plan and corrected afterwards.
**Why:** The human's words: "Always keep the user on the same page. Shouldn't make assumptions. When in doubt, grill." The human should feel like the CEO.

## 2. Automatic planning keeps working as it does
**Decision:** "Plan it yourself" plans on its own guesses for small details and the human corrects the plan afterwards. It is for simple features the agent will mostly get right, not for settling a feature's important parts.
**Why:** It saves the human a long grill answered with "go with your recommendation".

## 3. The orchestrator offers automatic planning only once the three are settled
**Decision:** For a vague request ("we need to track X") the orchestrator asks what and where first, in its own chat, in two or three questions, before any feature is created. Concrete requests (a bug with a repro, a named tweak) get no extra questions.
**Why:** A vague request planned alone becomes a guessed screen.

## 4. A lead no longer offers a design in its first reply
**Decision:** A feature's lead in a live chat offers the live design only once the three are settled.
**Why:** Offering it first pulls the lead into drawing a screen before anyone settled whether there is one, or where.

## 5. A lone planning run stops on an unsettled three
**Decision:** A feature planning alone that finds one of the three unsettled in its brief stops and asks the human, ending its run on that question in its own chat, and draws no screen on a guess about them.
**Why:** Same as 1; the run is where the guessed dashboard came from.

## 6. "Plan it yourself" is renamed
**Decision:** Every place the human reads the phrase changes: what agents say, and the app's labels and buttons. Tool and parameter names (`planning: 'self'`, `plan_feature`) stay. The exact wording, and whether "plan it with me" changes to match, was the human's to confirm; decision 7 records it.
**Why:** Users will not know what "plan it yourself" means. The human suggested "something like automatic planning".

## 7. The new name is "Plan automatically"
**Decision:** The button and the orchestrator's choice read **Plan automatically**; the mode is called **automatic planning** in prose. Its pair stays **Plan it with me** in the orchestrator's question; the app's own pair stays the **Start** button.
**Why:** It is the human's own suggestion, turned into a verb so it works on a button. "Plan it with me" already says what it does, and changing it would be churn.

## 8. Every related label uses the same name
**Decision:** The other labels that describe this mode follow the new name: the status "Planning by itself" becomes "Planning automatically", the activity line "self-planning run" becomes "automatic planning run", "Planned without you — the plan is finished" becomes "Planned automatically — the plan is finished", the stop notice says "automatic planning", the button's tooltip says "Plans the feature without you, then shows you the plan", and the line written into a cut feature's brief reads "Planning mode: automatic" (its pair "Planning mode: with you"). What the lead is told inside its own prompt ("self-planning run") follows too, so agents repeat the human's word.
**Why:** One name everywhere; two names for one thing is the confusion the rename exists to end.

## 9. What "settled" means
**Decision:** One of the three is settled when the request or brief says it, or when it follows from it with only one reasonable reading: a bug with its repro settles all three (the fix lives where the bug is, for whoever hit it). If two reasonable readings exist, it is open and the agent asks. The test the agent applies: can it say each of the three in one plain sentence from the human's words without inventing anything?
**Why:** Asking only when nothing is written would put questions on obvious bug fixes, which decision 3 rules out; guessing between two readings is exactly the dashboard-on-settings mistake.

## 10. "Who sees it" is asked only when there is more than one audience
**Decision:** When the project has one kind of user, "who sees it" is settled by default: everyone who uses the app. The agent asks only when the project has more than one audience (roles, signed-in versus public, owner versus teammates) or when the thing could plausibly be meant for the owner alone (a debug or admin view).
**Why:** In a one-audience app the question has one answer, and asking it every time would train the human to skip questions.

## 11. "You decide" settles it, out loud
**Decision:** When the human says in words that one of the three is the agent's call ("you decide where it goes"), it counts as settled. Only the human's own words count: an orchestrator's message that relays their answer does, the orchestrator's own "you decide" does not. The agent says its pick back in one line before it goes on; a plan records it as **Assumed** and puts it in Check first.
**Why:** The rule protects the human's choices, not their right to delegate. Saying the pick back keeps them on the same page.

## 12. One statement of the rule, word for word, in every agent's instructions
**Decision:** The rule is one short paragraph, the same words in the orchestrator's skill, the feature lead's skill, the lone-planning reference and the worker's briefing. A test keeps the copies identical. Each place adds only how it applies there (the orchestrator asks before it cuts, a lone run stops, a lead offers no design before it).
**Why:** The brief asks for one voice; there is no include mechanism in the skill pack, so a test is what keeps the copies from drifting.

## 13. How a lone run stops
**Decision:** A lone planning run checks the three after it reads the brief and surveys the code, before its first question round. If any is open, it writes no decisions, spec, designs or plan. The survey lets it offer real options ("the existing Activity page, or a new tab?") instead of a blank question. Its closing message says planning stopped because one of these was open, and asks each open one in full, numbered, with its recommendation. It then waits for the human's answer (`wait_for_you`, kind `answer`).
**Why:** Anything written on top of an open "what" or "where" would be rewritten once it is answered, and the human reads one short message instead of a plan built on a guess. Reading the code first writes nothing and makes the question faster to answer (the challenger's suggestion, adopted).

## 14. After the answer, it finishes the plan by itself
**Decision:** When the human answers a stopped lone run, the lead records the answers as the human's and finishes the plan the way automatic planning does (its own picks on the smaller details, then the plan for their yes). It does not switch to a live grill unless the human asks for one.
**Why:** The human chose automatic planning; the three were the only things it could not decide.

## 15. Workers follow the rule too
**Decision:** A worker's briefing carries the same statement. A worker its lead started, whose assignment leaves one of the three open, hands back to its lead with the question instead of guessing. A worker the human started with no assignment asks the human in its own chat.
**Why:** The human's rule is "every agent", and a worker started by hand gets the same vague requests a lead does. An assigned worker's questions belong to the lead that owns the feature, which also keeps this feature off the sibling "One place to answer" (the challenger's suggestion, adopted).

## 16. The orchestrator's question floor becomes the three-things test
**Decision:** The orchestrator's rule "propose no cut until the human has answered at least one question" is replaced by the test: propose no cut, and create nothing, until the three are settled for every feature in it. A request that already settles them gets no forced question; the two questions about planning and finish are still asked.
**Why:** The old floor is weaker (one answer about anything) and stronger (a question even on a fully concrete request) than the rule the human set; keeping both would give two tests.

## 17. A stopped run owned by an orchestrator chat asks through it, as today
**Decision:** The stopped run writes its questions in its own chat either way. When an orchestrator chat owns the feature, it also hands the questions back to that chat, which is how such a feature reaches the human today. Where the human answers is left to the sibling feature "One place to answer".
**Why:** The brief bars this feature from changing who owns a feature or where the human answers.

## 18. Only the human's own words settle the three
**Decision:** A brief settles one of the three only through the human's words: the request it quotes, or its `## Decided with the human` section. The orchestrator's own reading (its "understood" notes) does not count. So the orchestrator records each of the three it asked about under `## Decided with the human`, in the human's words.
**Why:** Otherwise the orchestrator can fill in "where" from its own reading, the lead sees it as settled, and the dashboard guess comes back one level up.

## 19. "Where it lives" is where the human or their users meet it
**Decision:** "Where" is not only a screen: it is wherever the human or their users meet the thing (a page, a command, a notification, a file, how an agent behaves). Work with nothing to meet (a fix inside a background job) settles "where" by itself, under decision 9.
**Why:** Runcastle builds projects in any language; a CLI or a library has no app screen, and the rule must still mean something there.

## 20. The rule applies again when new scope appears
**Decision:** The test runs whenever an agent is about to create something new, not only at the start: when the human adds "also show it on the home page" mid-build, or a lead finds mid-build that it needs a screen nobody planned, it asks before building it.
**Why:** A guess made mid-build lands as surely as one made at planning.

## 21. Features already in flight are left alone
**Decision:** Nothing re-checks features already cut or planned. The rule applies when one is next planned or adds something new (decision 20). The backlog draft's item "making Plan it yourself the default" is left for the orchestrator to raise, as the brief says.
**Why:** A sweep over existing features is machinery the brief rules out, and their next planning step hits the rule anyway.
