# Decisions — Cheaper burns

Planned without the human (a headless planning run, 2026-11-06). Every decision below
is the planner's own recommendation, accepted so the plan could be finished; the human
confirms or overturns each.

Check first: 12, 6, 7, 1, 9

## 1. A ticket holds at most about six criteria, in one area
**Decision:** The ticket guide (the feature skill's `tickets.md`) caps a ticket at about six acceptance criteria touching one area (one package or one module), and drops the wording that pushes leads toward merging ("splitting triples it", "a handful of substantial tickets"). It says plainly that a ticket's cost grows with the square of its length, so two half-size tickets are cheaper than one big one once a ticket would pass ~150k context.
**Why:** The ten tickets that ended above 250k context used 36% of all burn tokens; halving them saves ~116M. The guide today aims at ~100k per ticket while the median ends at 149k, so it is pushing the wrong way.
**Assumed.** Alternative: keep the guide's sizing and only add the warning in decision 2.

## 2. Emitting an oversized ticket returns a warning, never a refusal
**Decision:** `emit_tickets` returns a warning naming any ticket with more than eight acceptance criteria, so the lead sees it at once and can split before dispatch. It never refuses the batch. The warning lives with the existing ticket-shape warnings in `@runcastle/core`.
**Why:** Advisory warnings are the project's settled shape for ticket hygiene (the existing ticket-shape checks warn, never refuse). A count of criteria works for any language and any repo layout.
**Assumed.** Alternative: also warn when a ticket names three or more packages — dropped because "package" means nothing outside a monorepo and would need guessing from paths.

## 3. Wide removals are always expand, migrate, contract
**Decision:** The guide says any removal or rename that spans more than one area is sequenced expand → migrate → contract, one ticket per step or batch, never one ticket.
**Why:** The most expensive ticket on record (133.6M tokens, ~5,800 lines across four packages) was a wide removal in one ticket. The guide already describes the sequence but only for "thousands of call sites".
**Assumed.** Alternative: leave the existing wide-refactor exception as it is.

## 4. One check rule for ticket agents
**Decision:** The implement prompt states one rule, once: run the tests that cover your change before each commit; run the project-wide static check (typecheck) once, after the last criterion is committed, and once more only if that run found something you fixed. Never the full test suite or the verify commands whole. The prompt also says this rule wins over any ticket context that asks for whole-suite or repo-root checks, and the ticket guide forbids leads from writing such instructions into a ticket.
**Why:** Today the prompt's commit step says "typecheck before each commit" while its verify section says "once after commit", and 49 lead-written contexts said "verify with typecheck and test from the repo root". Typecheck ran 490 times (max 17 in one ticket). The shipped feature "tickets stop repeating checks" set the rule; this removes the contradictions it left.
**Assumed.** Alternative: typecheck before every commit and drop the "once at the end" wording instead.

## 5. Burn and review agents compact at 200k
**Decision:** Every Claude Code agent runcastle runs headless (ticket burns, conflict resolution, review tickets) is started with `CLAUDE_CODE_AUTO_COMPACT_WINDOW=200000`, so a long agent summarises its context near 200k instead of growing to 1M. It is a fixed default, not a setting. Codex agents are left alone.
**Why:** Burns run on the 1M-context model with no compaction, so the giant tickets re-read up to ~700k on every call (~170M measured). Claude Code documents this variable and applies it to `[1m]` models. The median ticket ends at 149k, so ordinary tickets never compact; commit-often already limits what a compaction can lose.
**Assumed.** Alternative: a higher window (300k–400k) that compacts fewer tickets but saves less.

## 6. Headless agents run at medium effort, whatever the host's own settings say
**Decision:** Every Claude Code agent runcastle runs headless is started at medium effort (`CLAUDE_CODE_EFFORT_LEVEL=medium`, which outranks every settings file). The same goes for decision 5's compaction: a headless agent compacts even when the human's own Claude settings turn auto-compaction off.
**Why:** Container burns already run at medium, the 5.5 models' default. But review tickets run on the host, where they read the human's own Claude settings, and on this machine those set Opus 5.5 to high effort and switch auto-compaction off. So reviews, the second-largest cost, run at high effort with no compaction. The human's settings are for their own sessions, not for unattended agents.
**Assumed.** Alternative: leave effort unset and let host agents follow the human's settings.

## 7. Workers get the spec inlined; brief and decisions become files to read
**Decision:** The docs digest every burn and review agent receives inlines `spec.md` only. `brief.md` and `decisions.md` are listed by path, with one line each saying when to read them. A feature with no spec inlines its brief instead. The lead's own feature context is unchanged.
**Why:** The digest averages ~8k tokens per call and reached 109k characters; it is paid on every call of every ticket (~50M). The spec is what workers build to; the ticket's own context carries anything else they need.
**Assumed.** Alternative: inline the spec and decisions, list only the brief.
**Challenged:** With no spec, the decisions are where the design choices live, so the fallback should inline the brief and the decisions together; and workers who never open `decisions.md` may undo a choice the spec does not restate.

## 8. Review drives check by text, keep pictures for the human, and chain steps
**Decision:** The review prompt tells the agent to verify every criterion from the page's text snapshot, never to take a screenshot in order to look at it, and to keep pictures only through the review's capture call (which stores them for the human without handing them back). It tells the agent to chain the actions between two snapshots into one shell call.
**Why:** 515 screenshots were read into context (~68M) and 1,702 of ~3,188 review calls were single browser actions. Most of those reviews ran before the capture call shipped (2026-10-31), so the rule makes the capture call the only picture path rather than adding a new tool.
**Assumed.** Alternative: block image reads in review sessions with a hook.

## 9. The review prompt is cut to about half
**Decision:** The review prompt template goes from ~32k characters to ~16k or less. Every hard rule stays; what goes is repeated explanation and the measured anecdotes that justify a rule after it is stated.
**Why:** The template is paid on every call of every review (33 drive reviews cost 406M). The anecdotes earned their place when each rule was new; the rules are now settled.
**Assumed.** Alternative: leave its length and only add decisions 8 and 10.
**Challenged:** A fixed "half" target invites cutting the anecdotes that make agents obey a rule; cut repetition first and drop an anecdote only where the rule is clear without it, with no length target.

## 10. Reviews never start paid work inside the app they drive
**Decision:** The review prompt says not to start work that costs money or runs long inside the app under test (sending a message to an AI agent, starting a job or a build) unless an acceptance criterion names it.
**Why:** Drive reviews of runcastle were seen prompting live agents inside the test drive ("what is your exact model id?"), paying for a second agent to answer a question no criterion asked.
**Assumed.** Alternative: say it only in runcastle's own project drive instructions, leaving other projects' reviews unchanged.

## 11. The burn guard blocks line-number edits with `sed -i`
**Decision:** The burn guard denies any in-place `sed` whose program is addressed by line number (`sed -i '417,433d'`, `sed -i '12d'`, `sed -i '40c …'`), pointing the agent at the Edit tool. Pattern substitutions (`sed -i 's/a/b/'`) stay allowed.
**Why:** Today the guard blocks only two-range deletions, so single-range line surgery gets through; line numbers go stale the moment an earlier edit lands, which is how such edits silently damage files.
**Assumed.** Alternative: deny every `sed -i`, substitutions included.
**Challenged:** `perl -i`, `awk -i inplace` and scripts make the same line-number edits; one prompt sentence ("edit with the Edit tool, never by line number") covers every tool better than guard patterns alone.

## 12. Implementation burns default to Sonnet, with Opus for UI and complex tickets — only on the human's yes
**Decision:** Recommended, not applied: the human switches the implementation step's model in Settings from Opus 1M to Sonnet 5.5. Leads keep setting a per-ticket model from the annotated roster, which already says Opus is for UI and complex work, so those tickets stay on Opus. Nothing in the code changes; the default stays Opus until the human says yes.
**Why:** 91 of 120 tickets ran on Opus 1M because the human's own `stepModels.implement` points there. A small sample (5 Sonnet vs 49 Opus tickets of similar size) used about half the tokens (median 4.1M vs 8.8M). It may change quality, which is why the brief reserves it for the human.
**Assumed.** Alternative: keep Opus and run a deliberate comparison first (the same kind of ticket on each model) before switching.
**Challenged:** Five Sonnet tickets is too small a sample and they were likely the easier ones, so "half the tokens" may only reflect easier work; and leads already had the roster saying Opus is for UI and complex work, yet 91 of 120 tickets still ran on Opus, so leaning on it to protect hard tickets after a switch is weak. Run the comparison first.

## 13. The lead builds it, then one review round
**Decision:** The lead builds every change in this feature itself, in its own checkout, then runs one review ticket that reads the diff against the spec. No implementation tickets.
**Why:** The changes are prompt and guide edits plus three small code changes in files the lead has already read. This project burns one ticket at a time, so tickets would buy no parallel width, only container and re-reading cost — the very cost this feature cuts.
**Assumed.** Alternative: three tickets (worker prompt and env, review prompt, ticket guide and warning).

## 14. The 1M-context model stays; compaction caps it
**Decision:** This feature does not swap the `[1m]` model ids for the standard ones. Whatever model a burn runs on, it compacts near 200k (decision 5), so the 1M window is only reached by a single huge read, not by a long conversation.
**Why:** The waste measured was long conversations re-reading themselves, which compaction fixes for every model. Which model a step uses is the human's own setting (decision 12), and this feature should not change it twice.
**Assumed.** Alternative: drop the `[1m]` ids for burns, since a 200k compaction window makes most of the 1M window unused.

## 15. Reviews compact too, and lose nothing when they do
**Decision:** Review agents get the same compaction as burns. The review prompt adds one line: after a compaction, re-snapshot the page and check which criteria you have already reported before going on.
**Why:** A review already reports each finding through a tool call the moment it sees it, so a compaction cannot lose a finding; what it can lose is its place in the walk, which one line fixes. Drive reviews were the costliest single kind of work (406M for 33), so leaving them out would skip the biggest target.
**Assumed.** Alternative: leave reviews out of compaction, or give them a higher window.

## 16. Splitting oversized tickets is worth the extra container time
**Decision:** The ticket cap (decision 1) accepts that a split ticket pays one more container start and one more read of the repo, about ten minutes, in exchange for its context staying small. The guide says so, so leads split only tickets that would pass the cap, not every ticket.
**Why:** The cap only bites the oversized tail: splitting the ten giant tickets from the two measured weeks adds about ten containers (under two hours of wall-clock spread over two weeks) and saves ~116M tokens. Ordinary tickets keep their size.
**Assumed.** Alternative: no cap, rely on compaction alone to hold giant tickets down.

## 17. The test drive proves it on a real burn from this branch
**Decision:** Unit tests check that the rendered prompts and the agent environment carry every change. Then the human's test drive hand-starts this branch's own server and burns one small throwaway ticket, watching that the agent starts with the compaction and effort settings and finishes. The ready message says exactly how.
**Why:** Burns and drives start from the installed runcastle, so nothing in a normal drive would exercise this branch's burn machinery; only a hand-started server does.
**Assumed.** Alternative: rely on unit tests alone and see the effect after publishing.

## 18. Savings are checked once, by hand, after two weeks
**Decision:** No new counting machinery. About two weeks after merge, the orchestrator compares per-ticket token medians and the share of tickets above 250k context against the numbers in the brief, and reports to the human.
**Why:** The burn records already hold per-ticket token counts; one comparison answers whether this worked. Counting review tokens properly belongs to the separate `honest-token-counts` feature.
**Assumed.** Alternative: a standing token report on the project page.
