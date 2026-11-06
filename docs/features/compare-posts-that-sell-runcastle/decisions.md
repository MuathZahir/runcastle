# Decisions — Compare posts that sell runcastle

Planned without the human on 2026-11-05 (a headless planning run). Every decision
below is the lead's own call and carries an **Assumed.** line until the human
confirms it.

Check first: 8, 3, 2

## 1. /compare/ becomes a blog index of the posts
**Decision:** The 2.9k-word overview roundup is replaced by a short index page: one headline, the shared opening line ("Agents don't need more prompts. They need a process."), and one card per post (headline, one-line hook, date, read time). No roundup table on the index.
**Why:** The human wants it to feel like a blog. A roundup article repeats every post in a worse form; an index sends readers to the one post they came for.
**Assumed.** Alternative: keep the overview as a short roundup post with one table across all tools.

## 2. A post is short: about 400–500 words, built around visuals
**Decision:** Each post has an opinionated headline, a dated byline with read time, a two-sentence lede, three or four short sections each anchored by a visual, a small "the facts" table, and a closing install call. Aim for 400–500 words; 700 is not a target. The old per-page sub-navigation, the long verdict box and the long side-by-side table go.
**Why:** The human's two complaints were "way too much text" and "it should feel like a blog". 400–500 words is a two-minute read; the old pages were 2.2k–2.9k.
**Assumed.** Alternative: even shorter (300 words, mostly pictures), which risks reading as an ad rather than a post.
**Challenged:** With a strip, a fact table and three or four visuals, even 500–700 words reads text-heavy against "way too much text"; it would aim for 400–500.
**Changed by the orchestrator:** the target moved from 400–600 (ceiling 700) to 400–500, siding with the challenger.

## 3. No concession: each post ends on the install call
**Decision:** The post argues for runcastle throughout and ends on the install call to action. There is no "who should still pick the other tool" line and no "both are great" framing. Credibility comes from accuracy instead: no claim about another tool without a dated, linked source (see 5).
**Why:** The human's complaint was that the pages are "politically correct". A closing concession is the same habit in one line.
**Assumed.** Alternative: one honest closing line on who should still pick the other tool (the lead's first plan).
**Changed by the orchestrator:** the closing concession is dropped; posts end on the install call.

## 4. The process strip is every post's central visual
**Decision:** Every post carries the same drawn strip of runcastle's process — Idea → Plan → Design → Build → Review → Test drive → Merge — with the steps the other tool leaves to you shown as "you do this" and the steps it covers shown as covered. It is HTML and CSS on the page, not an image, so it stays sharp and cheap to change.
**Why:** The pitch is "other tools hand you agents and leave the process to you". The strip shows that argument in one glance, and the same strip across posts makes the series read as one argument.
**Assumed.** Alternative: a per-post feature table with ticks and crosses, which reads as the neutral comparison the human rejected.

## 5. Facts about competitors are checked, dated and linked
**Decision:** Every claim about another tool comes from its own site, docs or changelog as of the research date, and each post's fact table says "Checked <date>" with links to those sources. A claim the build cannot source is softened or dropped, the process strip's "left to you" steps included. Posts show no screenshots of other products; they show runcastle's own captures.
**Why:** The brief forbids false claims, and the old pages went stale within weeks. A date tells the reader how fresh the facts are and tells us when to recheck. Using our own captures only avoids putting someone else's UI on our marketing page.
**Assumed.** Alternative: no sources on the page (cleaner, but nothing to stand on when a competitor disputes a claim).

## 6. The lead builds the posts itself; one review round at the end
**Decision:** No build tickets. The lead writes the posts, the index and the blog styles in its own window after the human's yes, then runs one review round: a single review ticket that reads every page in a browser at desktop and phone widths, and checks every claim about a competitor against the source the page links.
**Why:** The work is copy plus one stylesheet. It needs one consistent voice and the research already in this conversation; a worker would re-read everything and burn a container per post, and this project burns one ticket at a time anyway, so tickets buy no speed.
**Assumed.** Alternative: one ticket per post, run in sequence.

## 7. Four posts: Conductor, T3 Code, Claude Code or Codex on their own, and Kiro
**Decision:** The series is four posts behind the index. Three are the agreed defaults, rewritten. The one new post is **Kiro** (AWS's agent IDE, which turns a prompt into requirements, a design and ordered tasks, then builds them with parallel agents). Everything else the research found stays out: Cursor 3's Agents Window, Paradev (formerly Superset), Vibe Kanban (now a community project after its company closed), Imbue's Sculptor, GitHub Copilot's cloud agent, Devin, Google Jules, Factory, Amp, Claude Squad and Nimbalyst (formerly Crystal).
**Why:** Kiro is the only tool that claims runcastle's own job, running a process and not just agents, so it is where the argument most needs making: readers who find it will ask "isn't this the same thing?". The other tools are agent runners, and the "on their own" post already answers the two that every reader has: Claude Code's agent view and Projects, and the Codex app.
The human picked Kiro on 2026-11-06.

## 8. The Conductor post becomes a "where to go next" post
**Decision:** Conductor's changelog titles its Nov 4, 2026 release "Conductor is joining Meta". The post leads with that, stated plainly and linked, and argues that people leaving Conductor shouldn't swap it for another agent runner but move to a process. Its headline is about runcastle as the next home and does not mention Meta; the news sits in the lede. The post keeps the `/compare/conductor/` address. It states only what Conductor itself has published; the reported cloud shutdown dates and the Mac app's support window go in only if the build can confirm them on Conductor's own pages.
**Why:** Conductor users now need an alternative, so "Conductor alternative" is the most timely thing this series can rank for. A plain comparison against a tool being wound down would read as stale the day it ships. Keeping Meta out of the headline keeps the post from reading as gloating, and from dating once the news is old.
**Assumed.** Alternative: drop the Conductor post and redirect its address to the index.

## 9. The section stays "Compare" at /compare/
**Decision:** The blog lives where the pages live now: the "Compare" nav label and `/compare/` addresses stay. Post addresses: `/compare/conductor/`, `/compare/t3-code/`, `/compare/kiro/` (new), and `/compare/claude-code-or-codex/` (new), with `/compare/claude-code/` redirecting to it permanently.
**Why:** The old addresses carry what search ranking they have, and the nav label is shared with the docs pages and the landing page, which sibling features own. "Blog" would also promise posts about more than comparisons.
**Assumed.** Alternative: a `/blog/` section with redirects from every `/compare/` address.

## 10. The index names the tools without a post, in one line
**Decision:** Under the post cards, the index carries one short line naming the other tools the research looked at (Cursor, Paradev, Vibe Kanban, Sculptor, Copilot's cloud agent, Devin, Jules, Amp, Claude Squad) and saying they are agent runners, so the Claude Code or Codex post's argument applies to them. No cards, no links.
**Why:** A reader who came looking for one of them learns we know it and where the argument lives, for about 40 words.
**Assumed.** Alternative: say nothing about tools without a post.
