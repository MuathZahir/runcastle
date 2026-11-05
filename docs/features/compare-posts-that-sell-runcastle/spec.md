# Compare posts that sell runcastle

## Problem

A developer weighing runcastle against another agent tool lands on
runcastle.dev/compare/ and finds four long, even-handed essays (2.2k–2.9k words
each). They read like a neutral buyer's guide, so they never make the case for
runcastle, and most readers will not get through them. They are also out of
date: they describe runcastle's old six-phase pipeline and its merge gates,
call runcastle a Claude Code UI although it runs Codex just as well, link docs
pages that are going away, and carry competitor facts that have since changed.

## Approach

**What the reader gets.** /compare/ is a short blog index: a headline, the
series' one-line thesis ("Agents don't need more prompts. They need a
process."), and a card per post. Each post is a three-minute read that argues
for runcastle against one alternative. It opens with an opinionated headline
and a two-sentence lede, puts the shared process strip near the top, makes its
case in three or four short sections anchored by runcastle's own screenshots,
closes with a small dated fact table and one honest line on who should still
pick the other tool, and ends on the install command.

**The argument every post makes.** runcastle is the software development
engine: it runs the software process for you — cut the idea, plan, design in
your real app, build in sandboxed rounds, review with a walkthrough, test
drive, merge. The other tool hands you agents (one, or many in parallel) and
leaves that process to you: the branches, the prompts, the checking, the
testing. Each post makes this concrete for its competitor, using only facts
from the competitor's own site, docs or changelog as of the research date.

**The posts.** Four, each at `/compare/<slug>/index.html`, listed on the
index in this order:

| Post | Address | Headline (draft) | The argument |
|---|---|---|---|
| vs Conductor | `/compare/conductor/` | After Conductor, don't settle for another agent runner. | Conductor announced on Nov 4, 2026 that it is joining Meta (lede only, linked to its changelog). It solved the easy half: a worktree, branch and agent per task; prompting, watching, diff reading and the PR were yours. runcastle runs the project, checks the work first, and is not Mac-only. Strip: Conductor covers Build and the PR button. |
| Claude Code or Codex on their own | `/compare/claude-code-or-codex/` | Claude Code and Codex can run ten agents now. Who runs the project? | Concede up front that both now run agents in parallel (Claude Code: agent view, agent teams, workflows, Projects; Codex: parallel threads in the ChatGPT desktop app and Codex Cloud). They parallelise agents; they don't plan with you, design in your app, review by driving the app, or hand you a test drive. runcastle drives either, on the subscription you have, and can mix their models in one round. Strip: they cover Build. |
| vs T3 Code | `/compare/t3-code/` | T3 Code puts every agent in one window. The work is still yours to run. | T3 Code is the best open-source control plane for many agents, with remote access (T3 Connect). It is a better remote, not a process. runcastle also works from your phone, over Tailscale. Strip: T3 Code covers Build and a one-button PR. |
| vs Kiro | `/compare/kiro/` | Kiro writes the spec. runcastle ships the feature. | Kiro is the closest: requirements, design doc and ordered tasks, then parallel agents. Say so. The argument is the steps it lacks: designing in your real running app, a review that drives the app and records a walkthrough, and a test drive before merge. Strip: Kiro covers Idea, Plan and Build; Design, Review and Test drive are left to you. |

The old `/compare/claude-code/` address returns a permanent (301) redirect to
the new one from a new `site/_redirects` file (Cloudflare Pages reads it on
deploy). The draft headlines are the lead's; the build may sharpen them.

**Facts at build time.** The research date is 2026-11-05. Before writing each
post, the build re-reads the competitor's own pages that the post will link
and states only what they say. In particular, Conductor's cloud shutdown dates
and its Mac app's support window were reported by research but not confirmed
on Conductor's pages; they go in only if the build confirms them. Each fact
table has these rows: Runs on, Agents, Isolation, Plans and reviews, and
Price or Status. runcastle's side: macOS, Windows, Linux and your phone;
Claude Code and Codex; a container per worker; built in; free and
source-available (FSL-1.1-ALv2).

**The page frame.** Posts keep the site's existing header and footer chrome
(`styles.css`) and the article frame (`content.css`). The blog look is a set
of new classes added to `content.css`, all opt-in, so docs pages are
untouched:

- `.post` on the article: bigger headline, larger lede, h2 without rules.
- `.byline`: "runcastle team · Nov 5, 2026 · 3 min read". The publish
  date is the day the build writes the post.
- `.pull`: the thesis line, accent-ruled.
- `.strip`: the process strip — two rows (the competitor, then runcastle),
  seven steps each: Idea, Plan, Design, Build, Review, Test drive, Merge.
  Each step is `.is-on` (the tool does it), `.is-you` (left to you, dashed,
  "you" in warning amber) or `.is-rc` (runcastle does it, accent-lit). Pure
  HTML and CSS; no image, no script.
- `.post-figure`: a runcastle screenshot that breaks a little out of the text
  column on wide screens, with a caption.
- `.facts`: a two- or three-column fact table with a "Checked <date>" source
  line linking each source.
- `.concede`: the single "pick the other tool if…" line.
- `.post-cta`: one short line, the one-line install for macOS and Linux
  (Windows users get the PowerShell line beneath it), and a "Read the docs"
  button.
- `.post-list` / `.post-card`: the index cards; `.also`: the one line under
  them naming the tools without a post.

Two design pages show the look with draft copy: `site/_design/compare-post.html`
(the Conductor post) and `site/_design/compare-index.html`. The build turns
them into the real pages and then deletes `site/_design/`, so nothing
unpublished deploys. The design server for this feature is a static server
over `site/`; it was recorded in `.runcastle/design.json`, which must be
restored to the project's own command (the web app's dev server) before
anything is committed, since that file is shared by every feature.

**Screenshots.** Posts use runcastle's own captures from
`site/assets/screens/` (2880×1800 PNGs, about 0.5 MB each; they show the
current app: the Plan, Tickets, Details and Design tabs and Merge & ship).
The posts serve resized WebP copies (about 1840 px wide) from
`site/assets/posts/`, with real alt text and `loading="lazy"`. No competitor
screenshots and no competitor logos.

**Links.** Posts link only `/docs/` among the docs until the orchestrator
passes the docs feature's final URL list; then the lead swaps in deeper links
where they help. Each post links the other posts once, in a "More
comparisons" pair at the end.

**SEO.** The `<title>` keeps the search phrase ("runcastle vs Conductor") even
though the h1 is the opinionated headline. Each page keeps its canonical,
Open Graph, Twitter and `Article` JSON-LD tags, updated to the new copy and
`datePublished` / `dateModified`. `site/sitemap.xml` lists exactly the compare
pages that exist after the change (the docs entries belong to the docs
feature).

**The index.** Headline "Agents don't need more prompts. They need a
process.", a two-line lede, the four cards (label, headline, one-line hook,
date and read time), and the one `.also` line.

**README.** `site/README.md` changes two lines: `assets/screens/` is no longer
"for the root README only", and the new `assets/posts/` and `_redirects`
files are listed.

## Seams

- **The built site served statically** (existing): `python3 -m http.server`
  or `npx serve` over `site/`. Every post, the index and the redirect target
  are observable at their URLs; the review round reads them in a browser at
  desktop (1440) and phone (390) widths.
- **`site/_redirects`** (new): one line, `/compare/claude-code/` →
  the new address, 301. Observable only on Cloudflare Pages; locally the
  review checks the file's content.
- **`content.css` blog classes** (new, additive): observable on any docs page
  as "no change" and on compare pages as the blog look.

## Out of scope

- The docs pages (`site/docs/`) and the landing page (`site/index.html`,
  generated): sibling features own them.
- Recapturing runcastle's screenshots. The posts use the current captures.
- Deploying runcastle.dev: the orchestrator deploys after all three sibling
  features merge.
- Posts for the other tools the research found (Cursor 3, Paradev, Vibe
  Kanban, Sculptor, Copilot's cloud agent, Devin, Jules, Factory, Amp, Claude
  Squad, Nimbalyst). The index names most of them in one line.

## Open questions

- Deeper docs links wait on the docs feature's final URL list.
- Whether the byline should carry a person's name in place of "runcastle
  team".
