# Decisions — Docs for runcastle as it is today

Planned without the human (a headless planning run, 2026-11-05). Every decision is the planner's own pick until the human confirms it.

Check first: 1, 3, 6, 11, 13

## 1. Four short pages, not six
**Decision:** The docs become four pages: **Get started** (`/docs/`), **How a feature goes** (`/docs/features/`), **The orchestrator** (`/docs/orchestrator/`) and **Another machine or your phone** (`/docs/vps/`). The Gates and Preparation pages are deleted; the Pipeline page is rewritten as How a feature goes; the Project session page becomes The orchestrator.
**Why:** Gates and the preparation session describe removed or vanishing machinery, and the human asked for far less text. Four pages follow what a newcomer does: install, run a feature, bring ideas, run it elsewhere.
**Assumed.** Alternative: keep one page per old topic (six pages), each just shortened.

## 2. The final URL list, and redirects for the old ones
**Decision:** The docs URLs are `/docs/`, `/docs/features/`, `/docs/orchestrator/` and `/docs/vps/`. A Cloudflare Pages `site/_redirects` file sends the old ones on with a 301: `/docs/pipeline/` and `/docs/gates/` to `/docs/features/`, `/docs/project/` to `/docs/orchestrator/`, `/docs/preparation/` to `/docs/` (where preparing a project is one step). The sitemap lists only the four. The sibling compare feature links only to these four.
**Why:** The old URLs are indexed and linked from the compare and landing pages, which this feature does not own. `/docs/vps/` keeps its address because the README links it twice.
**Assumed.** Alternative: keep the old `/docs/pipeline/` and `/docs/project/` addresses with new content, so nothing needs a redirect.

## 3. Preparing a project is one line, worded to survive the orchestrator taking it over
**Decision:** Preparing a project gets no page and no screenshot. Get started says in one sentence that, on a new project, runcastle first works out how your repo installs, runs and is test driven, by actually running it. It does not name the Preparation screen or button.
**Why:** The feature "the orchestrator prepares the project" is in flight and deletes the separate Preparation screen. One neutral sentence stays true whichever merges first; a page or a picture would not.
**Assumed.** Alternative: wait for that feature to merge and then describe and picture its "Start the project" moment.

## 4. Each section is a heading, one or two sentences and a screenshot
**Decision:** The page grammar is: a short heading, at most two sentences, then a real screenshot that shows the thing. Commands sit in one code block. No section is prose alone except where there is nothing to picture (install, the VPS steps). Each page stays under about 400 words of prose; the four together come to roughly 1,500 words, against 7,900 today.
**Why:** The human said the whole site has "way too much text"; a picture does the work a paragraph used to.
**Assumed.** Alternative: keep explanatory paragraphs and add screenshots beside them.
**Changed by the orchestrator:** the 400-word cap per page is a firm rule, not a target, because the human's main complaint was too much text.

## 5. A short "what you need" list stays; reference detail lives in the README
**Decision:** Get started keeps a list of a few lines of what you need: Claude Code or Codex signed in, git, Docker or Podman before the first round, and the supported systems (the installer brings Bun). Everything longer, Docker and Podman setup per platform, the Docker Desktop licence note, the usage ping, troubleshooting and the package map, stays in the repo README only, and the docs link to its sections.
**Why:** A newcomer must learn what install needs without leaving the site at step one, but the long reference detail is what made the docs text-heavy, and one copy cannot drift from another.
**Assumed.** Alternative: send even the prerequisites to the README, or copy all the reference detail into a fifth "Reference" docs page.
**Changed by the orchestrator:** the list stays to a line or two on the page, inside decision 4's cap.

## 6. A fresh set of real captures, taken by hand, with the recipe written down
**Decision:** The docs get their own screenshots in `site/assets/docs/`, about ten, captured from the real app in the current design, the way the README's were: a copy of the real database in a scratch data dir holding only the demo project, the server booted from the checkout, live states staged by database writes after boot. The recipe and the shot list go in the site README so the next retake follows it. No capture script is committed.
**Why:** A committed script would only ever run on the owner's machine (it needs their database and demo project) and its database writes break whenever the schema changes, which makes it machinery to carry rather than a cure for stale pictures.
**Assumed.** Alternative: commit a capture script so a retake is one command.
**Challenged:** The planner first chose the committed script; the challenger argued it only works on one machine and breaks with the schema, and the planner changed to this.

## 7. Claude Code or Codex, stated once up front and shown once
**Decision:** The first sentence of `/docs/` says runcastle drives Claude Code or Codex, and Get started has a short "Claude Code or Codex" section with a screenshot of the model settings (a model per step, mixing both). Elsewhere the pages say "the agent" or "workers" and never "Claude Code" alone.
**Why:** Codex is equally supported, and the old docs called runcastle a Claude Code UI.
**Assumed.** Alternative: a separate "Claude Code or Codex" page.

## 8. The docs open on the shared pitch
**Decision:** `/docs/` opens with the settled pitch in one sentence: runcastle is the software development engine; it runs the whole process for you (plan, design in your real app, build in sandboxes, review, test drive, merge) where other tools hand you an agent and leave the process to you.
**Why:** It is the pitch the human settled in the project session for the landing page; the docs should say the same thing.
**Assumed.** Alternative: open straight on the install command with no pitch.

## 9. How a feature goes tells the four stages as a story
**Decision:** The features page walks Planning, Build, Review and Shipped, the four stages the README and the brief use, as a story of what happens rather than a status the app stores (it stores none; the sidebar sorts features by who they wait on, "Needs you" and "Agent working"). Under Planning: talking it through, the plan you say yes to, and designing screens live in your real app. Under Build: rounds of sandboxed workers. Under Review: the review package, then your own test drive with notes. Shipped: Merge. It names each point where you take part: you say yes to the plan and approve any designed screens, then you test drive and press Merge. It does not count them.
**Why:** That is the flow in the code today (the feature agent leads from first message to merge, rounds of workers, a review round by default, the human drives and merges). The old six phases and gates are gone.
**Assumed.** Alternative: describe the flow as one continuous loop with no named stages.

## 10. Notes and triage live on the orchestrator page
**Decision:** The orchestrator page covers bringing it an idea or a complaint, the backlog, and notes: jot one anywhere with Ctrl+J or during a test drive, then Triage sends them to features.
**Why:** Notes collect in the project's inbox and the orchestrator is what triages them; that is where a reader looking for "what do I do with what I noticed" lands.
**Assumed.** Alternative: notes on the features page, beside the test drive.

## 11. The VPS page also covers moving and the phone
**Decision:** `/docs/vps/` becomes "Another machine or your phone": install on a server (with Claude Code or Codex sign-in), keep it running as a service, reach it over SSH forwarding both ports 4512 and 4514, move an existing setup with `runcastle move`, and reach it from your phone over Tailscale, turned on from Settings, with notifications on the phone once the link is on.
**Why:** The current guide forwards only 4512, so the Design view stays empty, assumes Claude Code, and predates `runcastle move`. All three are "use runcastle somewhere other than this laptop", which is one reader. The phone link and its push notifications are shipped features no page mentions.
**Assumed.** Alternative: keep the VPS guide to the VPS only and give the phone its own page.

## 12. Docs-only styles go in their own stylesheet
**Decision:** The screenshot figure and any other new docs styles go in a new docs-only stylesheet loaded by the four docs pages. `content.css` is not edited.
**Why:** The compare feature is restyling `content.css` right now; a separate file cannot conflict with it.
**Assumed.** Alternative: a small additive figure rule at the end of `content.css`.

## 13. I build it myself, then one review round
**Decision:** No worker tickets for the build: the lead writes the pages and the redirects, and takes the screenshots by hand in this checkout. Then one review round reads the result: links, redirects, stale words, prose length and each picture against its caption.
**Why:** The screenshots need the human's real runcastle database and the demo project, which a sandboxed worker cannot reach. What remains is a few hundred lines of HTML, cheaper in one window than in containers.
**Assumed.** Alternative: hand the page writing to a worker and keep only the captures.
**Changed by the orchestrator:** wording fixed; the lead writes no capture script, as decision 6 says.

## 14. Written for newcomers; runcastle's own words get one line each
**Decision:** The docs are written for someone who has not used runcastle. The words a reader meets on the app's screens (feature, round, ticket, worker, review package, test drive, orchestrator) each get a few plain words of definition where a page first uses them, and Get started points to the in-app Glossary (the **?** in the sidebar) for the rest.
**Why:** Pages this short leave no room for a glossary page, and an undefined "round" stops a newcomer at the first screenshot.
**Assumed.** Alternative: a separate glossary page on the site.
**Changed by the orchestrator:** each definition stays a few words, inside decision 4's cap.

## 15. Get started ends on your first feature
**Decision:** Get started closes with the first ten minutes on the reader's own repo: open it as a project, let runcastle prepare it, then open a chat and say what you want built. It links to How a feature goes for what happens next. No sample project is offered.
**Why:** A reader who has installed it wants the next action, and their own repo is what they came to use; runcastle ships no sample project.
**Assumed.** Alternative: a guided first feature on a sample repo.
**Changed by the orchestrator:** the ending stays to a line or two, inside decision 4's cap.

## 16. One honest line on cost and limits
**Decision:** Get started says in one line that runcastle uses your own Claude or ChatGPT subscription and nothing routes through runcastle, and in one more line that designing screens live and test driving inside runcastle need an app with a web UI.
**Why:** A reader deciding whether to adopt it looks for both, and the old docs only said it in passing.
**Assumed.** Alternative: leave limits and cost to the README.
**Changed by the orchestrator:** the two lines stay two lines, inside decision 4's cap.


## 17. Today's README captures are reused where they show the state
**Decision:** Where a README screenshot retaken on 2026-11-05 already shows the state a docs section needs (the plan and tickets, a round, the review package, a test drive, the orchestrator chat, notes and Triage), it is copied into `site/assets/docs/`. New captures are taken only for what none shows: the first-run wizard, the model settings, and a design beside the chat. The phone section gets no picture, since the phone link's screen would show a real private network address.
**Why:** Those README shots are real captures in today's design, taken hours before this plan. The staged states behind them are no longer in the database, so retaking them would mean rebuilding that staging for identical pictures.
**Assumed.** Alternative: retake every docs picture fresh, as decision 6 first said.
